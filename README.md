# LoopHole

A local dictation application using NVIDIA's Parakeet v3 model for continuous, hands-free transcription. Runs entirely locally with a web-based UI wrapped in PyWebView.

## Features

- 🎤 **Real-time transcription** with <5s latency
- 🔇 **Automatic paragraph breaks** using Silero VAD (1.5s+ silence detection)
- 💻 **Fully local** - no cloud, no data leaving your machine
- 🎛️ **Microphone picker** - select any audio input device
- ⌨️ **Keyboard shortcut** - press Space to toggle recording

## Requirements

- Python 3.10+
- Windows / macOS / Linux
- ~2GB RAM for model

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd LoopHole

# Install Python dependencies
uv sync

# Compile TypeScript frontend
cd src/loophole/static && npm install && npx tsc && cd ../../..
```

## Usage

```bash
# Start the app
uv run python main.py
```

**First run** will download the Parakeet v3 model (~1GB) from HuggingFace.

### Controls

1. **Select microphone** from the dropdown
2. Click **Start Recording** (or press `Space`)
3. Speak - transcription appears in real-time
4. Click **Stop Recording** (or press `Space`)
5. Click **Clear** to reset the transcript

### Paragraph Breaks

The app automatically detects pauses in speech:
- Pause for **1.5+ seconds** → new paragraph starts
- Shorter pauses → text continues on same line

## Architecture

```
┌─────────────────────────────────────────┐
│           PyWebView Window              │
│  ┌─────────────────────────────────┐    │
│  │  Frontend (HTML/CSS/TypeScript) │    │
│  │  - MediaRecorder (3s chunks)    │    │
│  │  - Base64 encoding              │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│           Backend (Python)              │
│  ┌─────────────────────────────────┐    │
│  │  API (PyWebView bridge)         │    │
│  │  - Audio decode & resample      │    │
│  └─────────────────────────────────┘    │
│                  │                      │
│                  ▼                      │
│  ┌─────────────────────────────────┐    │
│  │  TranscriberWithVAD             │    │
│  │  - Silero VAD (speech detect)   │    │
│  │  - Parakeet v3 (transcription)  │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

## Project Structure

```
LoopHole/
├── main.py                    # Entry point
├── pyproject.toml             # Dependencies
├── src/loophole/
│   ├── __init__.py
│   ├── api.py                 # PyWebView API bridge
│   ├── transcriber.py         # Parakeet v3 + Silero VAD
│   └── static/
│       ├── index.html         # UI
│       ├── style.css          # Styling
│       ├── src/app.ts         # Frontend logic (TypeScript)
│       └── dist/app.js        # Compiled JavaScript
└── README.md
```

## Troubleshooting

### "No microphones found"
- Check that your microphone is connected
- Grant microphone permission to the app
- Try refreshing the device list

### "Model loading failed"
- Ensure you have internet connection for first run
- Check available disk space (~2GB needed)
- Verify HuggingFace cache: `~/.cache/huggingface/`

### "CUDA not available" warning
- This is normal if running without GPU
- Transcription will use CPU (slower but functional)

### Slow transcription
- First chunk takes longer (model warmup)
- Subsequent chunks should be <2s
- GPU significantly improves speed

## Tech Stack

- **Frontend**: HTML, CSS, TypeScript
- **Backend**: Python, PyWebView
- **ASR Model**: NVIDIA Parakeet TDT 0.6B v3 (via NeMo)
- **VAD**: Silero VAD

## License

MIT
