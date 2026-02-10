/// <reference path="../types/pywebview.d.ts" />

// LoopHole - Frontend Application
// Handles microphone selection, recording, and transcription display

// Types
interface TranscriptionResult {
  text: string;
  new_paragraph: boolean;
  has_speech: boolean;
  captured_at: number;
  transcribed_at: number;
  latency_ms: number;
  error?: string;
}

// State
let audioStream: MediaStream | null = null;
let selectedMicId: string = '';
let isRecording = false;
let pollInterval: number | null = null;

// DOM Elements
const micSelect = document.getElementById('mic-select') as HTMLSelectElement;
const recordBtn = document.getElementById('record-btn') as HTMLButtonElement;
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const transcriptEl = document.getElementById('transcript') as HTMLTextAreaElement;

// ============ Device Enumeration ============

async function populateMicList(): Promise<void> {
  try {
    // Request permission first
    await navigator.mediaDevices.getUserMedia({ audio: true });
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    
    micSelect.innerHTML = '';
    
    if (audioInputs.length === 0) {
      micSelect.innerHTML = '<option value="">No microphones found</option>';
      return;
    }
    
    audioInputs.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Microphone ${index + 1}`;
      micSelect.appendChild(option);
    });
    
    selectedMicId = audioInputs[0].deviceId;
    recordBtn.disabled = false;
    
  } catch (error) {
    console.error('Failed to enumerate devices:', error);
    micSelect.innerHTML = '<option value="">Microphone access denied</option>';
    updateStatus('error');
  }
}

// ============ Recording Control ============

// Audio processing state
let audioContext: AudioContext | null = null;
let workletNode: AudioWorkletNode | null = null;
let audioBuffer: Int16Array[] = [];
let lastChunkTime: number = 0;
const CHUNK_DURATION_MS = 3000;

async function startRecording(): Promise<void> {
  if (isRecording) return;
  
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: selectedMicId ? { exact: selectedMicId } : undefined,
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      }
    });
    
    // Create AudioContext at 16kHz
    audioContext = new AudioContext({ sampleRate: 16000 });
    
    // Create worklet processor inline
    const workletCode = `
      class AudioProcessor extends AudioWorkletProcessor {
        process(inputs, outputs, parameters) {
          const input = inputs[0];
          if (input.length > 0) {
            const channelData = input[0];
            this.port.postMessage(channelData);
          }
          return true;
        }
      }
      registerProcessor('audio-processor', AudioProcessor);
    `;
    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    
    await audioContext.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);
    
    const source = audioContext.createMediaStreamSource(audioStream);
    workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
    
    workletNode.port.onmessage = (event) => {
      const floatData = event.data as Float32Array;
      // Convert float32 to int16
      const int16Data = new Int16Array(floatData.length);
      for (let i = 0; i < floatData.length; i++) {
        const s = Math.max(-1, Math.min(1, floatData[i]));
        int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      audioBuffer.push(int16Data);
      
      // Check if we have enough for a chunk
      const now = Date.now();
      if (now - lastChunkTime >= CHUNK_DURATION_MS) {
        sendAudioChunk();
        lastChunkTime = now;
      }
    };
    
    source.connect(workletNode);
    workletNode.connect(audioContext.destination);
    
    audioBuffer = [];
    lastChunkTime = Date.now();
    isRecording = true;
    
    // Start polling for results
    console.log('[JS] Starting polling interval (500ms)');
    pollInterval = window.setInterval(pollResults, 500);
    
    recordBtn.textContent = 'Stop Recording';
    recordBtn.classList.add('recording');
    updateStatus('recording');
    
  } catch (error) {
    console.error('Failed to start recording:', error);
    updateStatus('error');
  }
}

function sendAudioChunk(): void {
  if (audioBuffer.length === 0) return;
  
  chunkCount++;
  const capturedAt = Date.now() / 1000;
  
  // Calculate total samples
  const totalSamples = audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
  const allSamples = new Int16Array(totalSamples);
  let offset = 0;
  for (const chunk of audioBuffer) {
    allSamples.set(chunk, offset);
    offset += chunk.length;
  }
  audioBuffer = [];
  
  console.log(`[JS] Chunk #${chunkCount}: ${totalSamples} samples (${(totalSamples/16000).toFixed(2)}s), captured_at=${capturedAt}`);
  
  // Create WAV
  const wavBlob = createWavFromInt16(allSamples, 16000);
  
  // Send to backend
  blobToBase64(wavBlob).then(base64 => {
    console.log(`[JS] Chunk #${chunkCount} converted to WAV, base64 len=${base64.length}`);
    if (window.pywebview?.api) {
      window.pywebview.api.transcribe_chunk(base64, capturedAt);
      console.log(`[JS] Chunk #${chunkCount} sent to backend`);
    }
  }).catch(err => {
    console.error(`[JS] Chunk #${chunkCount} error:`, err);
  });
}

function createWavFromInt16(samples: Int16Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = samples.length * 2;
  const headerSize = 44;
  
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);
  
  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  
  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  
  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  
  // Write samples
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, samples[i], true);
  }
  
  return new Blob([buffer], { type: 'audio/wav' });
}

function stopRecording(): void {
  if (!isRecording) return;
  
  // Send any remaining audio
  sendAudioChunk();
  
  // Stop polling
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  
  // Reset backend buffer
  if (window.pywebview?.api) {
    window.pywebview.api.reset_buffer();
  }
  
  // Cleanup audio
  if (workletNode) {
    workletNode.disconnect();
    workletNode = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
    audioStream = null;
  }
  
  audioBuffer = [];
  isRecording = false;
  
  recordBtn.textContent = 'Start Recording';
  recordBtn.classList.remove('recording');
  updateStatus('idle');
}

function toggleRecording(): void {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

// ============ Helpers ============

let chunkCount = 0;

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Remove data URL prefix to get pure base64
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ============ Result Handling (via polling) ============

let pollCount = 0;

async function pollResults(): Promise<void> {
  pollCount++;
  const pollId = pollCount;
  console.log(`[JS] Poll #${pollId}: starting...`);
  
  if (!window.pywebview?.api) {
    console.warn(`[JS] Poll #${pollId}: pywebview API not available`);
    return;
  }
  
  try {
    console.log(`[JS] Poll #${pollId}: calling get_pending_results...`);
    const results = await window.pywebview.api.get_pending_results();
    console.log(`[JS] Poll #${pollId}: got ${results?.length ?? 'null'} results`, results);
    
    if (!results || !Array.isArray(results)) {
      console.warn(`[JS] Poll #${pollId}: invalid results`, results);
      return;
    }
    
    for (let i = 0; i < results.length; i++) {
      console.log(`[JS] Poll #${pollId}: processing result ${i + 1}/${results.length}`);
      try {
        handleTranscriptionResult(results[i]);
      } catch (e) {
        console.error(`[JS] Poll #${pollId}: error handling result ${i}:`, e);
      }
    }
    console.log(`[JS] Poll #${pollId}: done`);
  } catch (error) {
    console.error(`[JS] Poll #${pollId} error:`, error);
  }
}

function handleTranscriptionResult(result: TranscriptionResult): void {
  console.log('[JS] handleTranscriptionResult START:', JSON.stringify(result));
  
  try {
    if (result.error) {
      console.error('[JS] Transcription error:', result.error);
      updateStatus('error');
      return;
    }
    
    const { text, new_paragraph, has_speech, latency_ms } = result;
    
    if (!has_speech || !text?.trim()) {
      console.log('[JS] Skipping: no speech or empty text');
      return;
    }
    
    console.log(`[JS] Appending text: "${text}" (latency: ${latency_ms}ms)`);
    appendTranscript(text.trim(), new_paragraph);
    console.log('[JS] handleTranscriptionResult DONE');
  } catch (e) {
    console.error('[JS] handleTranscriptionResult ERROR:', e);
  }
}

// Legacy callback (kept for compatibility, but polling is primary)
function handleTranscriptionError(errorMsg: string): void {
  console.error('[JS] Transcription error:', errorMsg);
  updateStatus('error');
}

// Make functions globally available for Python callbacks (legacy)
window.handleTranscriptionResult = handleTranscriptionResult;
window.handleTranscriptionError = handleTranscriptionError;
console.log('[JS] Callbacks registered on window');

// ============ UI Updates ============

type StatusState = 'idle' | 'recording' | 'processing' | 'ready' | 'error';

function updateStatus(state: StatusState): void {
  statusEl.className = `status status-${state}`;
  
  const messages: Record<StatusState, string> = {
    idle: 'Ready',
    recording: 'Recording...',
    processing: 'Processing...',
    ready: 'Model loaded',
    error: 'Error occurred'
  };
  
  statusEl.textContent = messages[state];
}

function appendTranscript(text: string, newParagraph: boolean): void {
  console.log(`[JS] appendTranscript: "${text}", newParagraph=${newParagraph}`);
  const currentText = transcriptEl.value;
  
  if (newParagraph && currentText.length > 0) {
    transcriptEl.value += '\n\n';
  } else if (currentText.length > 0 && !currentText.endsWith(' ') && !currentText.endsWith('\n')) {
    transcriptEl.value += ' ';
  }
  
  transcriptEl.value += text;
  
  // Auto-scroll to bottom
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  console.log(`[JS] appendTranscript DONE, total length: ${transcriptEl.value.length}`);
}

function clearTranscript(): void {
  transcriptEl.value = '';
}

function copyTranscript(): void {
  const text = transcriptEl.value;
  if (!text) return;

  // Try pywebview API first (works in pywebview context)
  if (window.pywebview?.api) {
    window.pywebview.api.copy_to_clipboard(text).then((result) => {
      if (result.status === 'ok') {
        // Visual feedback
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = originalText;
        }, 1000);
      } else {
        console.error('Failed to copy via API:', result.error);
        fallbackCopy(text);
      }
    }).catch((err) => {
      console.error('Copy API error:', err);
      fallbackCopy(text);
    });
  } else {
    // Fallback to navigator.clipboard for regular browser
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string): void {
  navigator.clipboard.writeText(text).then(() => {
    // Visual feedback
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 1000);
  }).catch((err) => {
    console.error('Failed to copy:', err);
    // Last resort: select and copy
    transcriptEl.select();
    document.execCommand('copy');
  });
}

// ============ Event Listeners ============

micSelect.addEventListener('change', () => {
  selectedMicId = micSelect.value;
});

recordBtn.addEventListener('click', toggleRecording);

clearBtn.addEventListener('click', clearTranscript);

copyBtn.addEventListener('click', copyTranscript);

// Keyboard shortcut: Space to toggle recording
document.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && event.target === document.body) {
    event.preventDefault();
    toggleRecording();
  }
});

// ============ Initialization ============

async function init(): Promise<void> {
  await populateMicList();
  
  // Check if model is loaded
  if (window.pywebview?.api) {
    try {
      const status = await window.pywebview.api.get_status();
      if (status.model_loaded) {
        updateStatus('ready');
      }
    } catch (error) {
      console.error('Failed to check model status:', error);
    }
  } else {
    // PyWebView not ready yet, wait for it
    updateStatus('idle');
  }
}

// Start app
init();
