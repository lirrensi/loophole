"""Transcription engine with Silero VAD for smart segmentation."""

from threading import Lock
from typing import TypedDict

import numpy as np
import torch


class _SegmentInternal(TypedDict):
    """Internal segment with position info."""

    audio: np.ndarray
    new_paragraph: bool
    end_position: int  # Sample index for buffer trimming


class SegmentToTranscribe(TypedDict):
    """A complete segment ready for transcription (returned to API)."""

    audio: np.ndarray
    new_paragraph: bool


class TranscriptionResult(TypedDict):
    """Result from transcription."""

    text: str
    new_paragraph: bool


class TranscriberWithVAD:
    """
    Parakeet v3 transcription with Silero VAD for smart segmentation.

    Instead of transcribing fixed chunks, we:
    1. Accumulate audio in a rolling buffer
    2. Use VAD to find "complete" segments (speech + 2s silence)
    3. Only transcribe complete segments
    4. Mark paragraph breaks for 4s+ silence
    """

    SAMPLE_RATE = 16000
    SENTENCE_SILENCE_SEC = 2.0  # 2s silence = sentence complete
    PARAGRAPH_SILENCE_SEC = 4.0  # 4s silence = paragraph break
    MAX_BUFFER_SEC = 30.0  # Safety limit

    def __init__(self) -> None:
        """Load Parakeet v3 model and Silero VAD."""
        self._loaded = False
        self._transcribe_lock = Lock()  # NeMo model is not thread-safe
        self._buffer_lock = Lock()  # Protect audio buffer

        # Rolling audio buffer
        self._audio_buffer: list[float] = []

        # Load Parakeet v3 via NeMo
        import nemo.collections.asr as nemo_asr

        self.model = nemo_asr.models.ASRModel.from_pretrained(
            model_name="nvidia/parakeet-tdt-0.6b-v3"
        )
        self.model.eval()

        # Load Silero VAD
        self.vad_model, utils = torch.hub.load(
            repo_or_dir="snakers4/silero-vad",
            model="silero_vad",
            force_reload=False,
            onnx=False,
        )
        self.vad_model.eval()
        self.get_speech_timestamps = utils[0]

        self._loaded = True

    def is_loaded(self) -> bool:
        """Check if model is ready."""
        return self._loaded

    def add_chunk(self, audio_array: np.ndarray) -> list[SegmentToTranscribe]:
        """
        Add audio chunk to buffer, return complete segments ready to transcribe.

        Args:
            audio_array: Audio samples (float32 or int16, mono, 16kHz)

        Returns:
            List of segments with audio and new_paragraph flag
        """
        if not self._loaded:
            return []

        # Normalize to float32 in [-1, 1] range
        audio_float = self._normalize_audio(audio_array)

        with self._buffer_lock:
            # Add to rolling buffer
            self._audio_buffer.extend(audio_float.tolist())

            # Trim buffer if too long (safety)
            max_samples = int(self.MAX_BUFFER_SEC * self.SAMPLE_RATE)
            if len(self._audio_buffer) > max_samples:
                self._audio_buffer = self._audio_buffer[-max_samples:]

            # Find complete segments using VAD
            segments = self._find_complete_segments()

            # Remove processed audio from buffer
            if segments:
                last_end = segments[-1]["end_position"]
                self._audio_buffer = self._audio_buffer[last_end:]

            return segments

    def transcribe_segment(self, audio_array: np.ndarray) -> str:
        """
        Transcribe a single audio segment.

        Args:
            audio_array: Audio samples (float32, mono, 16kHz)

        Returns:
            Transcribed text
        """
        if not self._loaded:
            return ""

        audio_tensor = torch.from_numpy(audio_array).float()

        with self._transcribe_lock:
            with torch.no_grad():
                results = self.model.transcribe([audio_tensor.numpy()], batch_size=1)

        if results:
            return results[0].text if hasattr(results[0], "text") else str(results[0])
        return ""

    def reset_buffer(self) -> None:
        """Clear the audio buffer (call when stopping recording)."""
        with self._buffer_lock:
            self._audio_buffer = []

    def _normalize_audio(self, audio_array: np.ndarray) -> np.ndarray:
        """Normalize audio to float32 in [-1, 1] range."""
        audio = audio_array.astype(np.float32)
        max_val = np.abs(audio).max()
        if max_val > 1.0:
            audio = audio / 32768.0
        return audio

    def _find_complete_segments(self) -> list[_SegmentInternal]:
        """
        Find speech segments that are "complete" (followed by 2s+ silence).

        Returns segments with:
        - audio: numpy array of the segment
        - new_paragraph: True if 4s+ silence follows
        - end_position: sample index where segment ends (for buffer trimming)
        """
        if len(self._audio_buffer) < self.SAMPLE_RATE * 0.5:
            # Less than 0.5s, not worth processing
            return []

        buffer_tensor = torch.FloatTensor(self._audio_buffer)
        buffer_duration = len(buffer_tensor) / self.SAMPLE_RATE

        # Run VAD on entire buffer
        speech_timestamps = self.get_speech_timestamps(
            buffer_tensor,
            self.vad_model,
            sampling_rate=self.SAMPLE_RATE,
            threshold=0.5,
            min_silence_duration_ms=2000,  # 2s minimum to detect boundaries
            min_speech_duration_ms=250,
        )

        if not speech_timestamps:
            print(f"[VAD] No speech in {buffer_duration:.1f}s buffer")
            return []

        print(
            f"[VAD] Found {len(speech_timestamps)} speech segments in {buffer_duration:.1f}s"
        )

        # Find segments that are "complete" (followed by 2s+ silence)
        complete_segments: list[SegmentToTranscribe] = []

        for i, segment in enumerate(speech_timestamps):
            # Calculate silence AFTER this segment
            if i < len(speech_timestamps) - 1:
                # Silence until next segment starts
                silence_samples = speech_timestamps[i + 1]["start"] - segment["end"]
            else:
                # Silence from segment end to buffer end
                silence_samples = len(buffer_tensor) - segment["end"]

            silence_duration = silence_samples / self.SAMPLE_RATE

            # Is this segment complete? (2s+ silence after it)
            if silence_duration >= self.SENTENCE_SILENCE_SEC:
                # Extract audio for this segment
                start = segment["start"]
                end = segment["end"]
                audio_segment = buffer_tensor[start:end].numpy()

                # Determine if it's a paragraph break (4s+ silence)
                is_paragraph = silence_duration >= self.PARAGRAPH_SILENCE_SEC

                segment_duration = (end - start) / self.SAMPLE_RATE
                print(
                    f"[VAD] Complete segment: {segment_duration:.1f}s, "
                    f"silence after: {silence_duration:.1f}s, "
                    f"paragraph={is_paragraph}"
                )

                complete_segments.append(
                    {
                        "audio": audio_segment,
                        "new_paragraph": is_paragraph,
                        "end_position": end,
                    }
                )

        return complete_segments
