// PyWebView API type declarations

export interface TranscriptionResult {
  text: string;
  new_paragraph: boolean;
  has_speech: boolean;
  captured_at: number;
  transcribed_at: number;
  latency_ms: number;
  error?: string;
}

export interface PyWebViewAPI {
  transcribe_chunk(audioBase64: string, capturedAt: number): Promise<{ status: string }>;
  get_pending_results(): Promise<TranscriptionResult[]>;
  get_status(): Promise<{ model_loaded: boolean }>;
}

declare global {
  interface Window {
    pywebview: {
      api: PyWebViewAPI;
    };
    handleTranscriptionResult: (result: TranscriptionResult) => void;
    handleTranscriptionError: (errorMsg: string) => void;
  }
}

export {};
