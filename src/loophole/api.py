"""PyWebView API bridge for transcription."""

import base64
import io
import time
from collections import deque
from threading import Lock, Thread
from typing import TYPE_CHECKING, Optional

import numpy as np
import soundfile as sf
from scipy import signal

if TYPE_CHECKING:
    import webview

    from .transcriber import TranscriberWithVAD


class API:
    """PyWebView API for handling transcription requests."""

    def __init__(self, transcriber: "TranscriberWithVAD") -> None:
        self._transcriber = transcriber
        self._window: Optional["webview.Window"] = None
        self._results_queue: deque[dict] = deque()
        self._queue_lock = Lock()

    def set_window(self, window: "webview.Window") -> None:
        """Set window reference for JS callbacks."""
        self._window = window

    def get_status(self) -> dict:
        """Return model loading status."""
        return {"model_loaded": self._transcriber.is_loaded()}

    def transcribe_chunk(self, audio_base64: str, captured_at: float) -> dict:
        """
        Process audio chunk in background thread.
        Returns immediately; result available via get_pending_results().
        """
        print(
            f"[API] Received chunk, size={len(audio_base64)} chars, captured_at={captured_at}"
        )
        Thread(
            target=self._process_audio_async,
            args=(audio_base64, captured_at),
            daemon=True,
        ).start()
        return {"status": "processing"}

    def get_pending_results(self) -> list[dict]:
        """Return all pending transcription results (called from JS polling)."""
        with self._queue_lock:
            results = list(self._results_queue)
            self._results_queue.clear()
        print(f"[API] get_pending_results: returning {len(results)} results")
        return results

    def _process_audio_async(self, audio_base64: str, captured_at: float) -> None:
        """Background thread: decode, resample, transcribe, queue result."""
        print("[API] Thread started")
        try:
            # Decode base64 to audio array
            audio_array, sample_rate = self._decode_audio(audio_base64)
            print(f"[API] Decoded: {len(audio_array)} samples at {sample_rate}Hz")

            # Resample to 16kHz if needed
            if sample_rate != 16000:
                audio_array = self._resample(audio_array, sample_rate, 16000)
                print(f"[API] Resampled to 16kHz")

            # Transcribe
            transcription = self._transcriber.process_chunk(
                audio_array, sample_rate=16000
            )
            transcribed_at = time.time()

            # Build result with timestamps for duplex tracking
            result: dict = {
                "text": transcription["text"],
                "new_paragraph": transcription["new_paragraph"],
                "has_speech": transcription["has_speech"],
                "captured_at": captured_at,
                "transcribed_at": transcribed_at,
                "latency_ms": round((transcribed_at - captured_at) * 1000),
            }

            # Queue result for JS polling
            with self._queue_lock:
                self._results_queue.append(result)
            print(
                f"[API] Queued result: {result.get('text', '')[:50]}... latency={result['latency_ms']}ms"
            )

        except Exception as e:
            print(f"Transcription error: {e}")
            import traceback

            traceback.print_exc()
            with self._queue_lock:
                self._results_queue.append(
                    {
                        "error": str(e),
                        "captured_at": captured_at,
                        "transcribed_at": time.time(),
                    }
                )

    def _decode_audio(self, audio_base64: str) -> tuple[np.ndarray, int]:
        """Decode base64 audio to numpy array."""
        audio_bytes = base64.b64decode(audio_base64)
        audio_array, sample_rate = sf.read(io.BytesIO(audio_bytes))

        # Convert to mono if stereo
        if len(audio_array.shape) > 1:
            audio_array = audio_array.mean(axis=1)

        # Ensure float32
        audio_array = audio_array.astype(np.float32)

        return audio_array, sample_rate

    def _resample(self, audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
        """Resample audio to target sample rate."""
        num_samples = int(len(audio) * target_sr / orig_sr)
        resampled = signal.resample(audio, num_samples)
        return np.asarray(resampled)
