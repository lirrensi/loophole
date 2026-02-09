# 🕳️ LoopHole

> *Your words, your machine, your business.*

**LoopHole** is a local dictation app that actually respects your privacy. No cloud, no subscriptions, no "we use your data to improve our services" nonsense. Just you, your microphone, and NVIDIA's Parakeet v3 running entirely on your machine.

## ✨ What it does

- 🎤 **Real-time transcription** — speak and watch your words appear
- 🧠 **Smart segmentation** — pauses of 2s+ trigger sentence completion, 4s+ creates paragraphs
- 🔒 **100% local** — your voice never leaves your computer
- ⚡ **Fast** — typically <3s latency from speech to text
- 🎛️ **Works with any mic** — built-in, USB, whatever

## 🚀 Quick Start

```bash
# Get the code
git clone https://github.com/yourusername/loophole.git
cd loophole

# Install dependencies
uv sync

# Build the frontend
cd src/loophole/static && npm install && npx tsc && cd ../../..

# Run it
uv run python main.py
```

**First run?** It'll download the Parakeet model (~1GB). Grab a coffee. ☕

## 🎮 How to use

1. Pick your microphone from the dropdown
2. Hit **Start Recording** (or press `Space`)
3. Talk. Pause. Talk more.
4. Hit **Stop Recording** (or press `Space` again)
5. Copy your transcript wherever you need it

### The magic of pauses

LoopHole doesn't just chop up your speech into arbitrary chunks. It listens for natural silence:

| Silence duration | What happens |
|------------------|--------------|
| < 2 seconds | Keep accumulating... |
| 2-4 seconds | ✅ Transcribe that segment! |
| 4+ seconds | ✅ Transcribe + start new paragraph |

This means no more mid-sentence cutoffs. Your thoughts stay intact.

## 🛠️ Requirements

- Python 3.10+
- ~2GB RAM (for the model)
- A microphone (obviously)
- Works on Windows / macOS / Linux

## 🏗️ Under the hood

```
┌──────────────────────────────────────────────────────┐
│                    YOUR COMPUTER                     │
│                                                      │
│   ┌──────────────┐         ┌──────────────────┐     │
│   │   Browser    │  WAV    │    Python        │     │
│   │   (PyWebView) │ ──────► │    Backend       │     │
│   │              │  16kHz  │                  │     │
│   │  AudioWorklet│         │  ┌────────────┐  │     │
│   │  (3s chunks) │ ◄────── │  │ Silero VAD │  │     │
│   │              │  text   │  │ (silence   │  │     │
│   └──────────────┘         │  │  detector) │  │     │
│                            │  └─────┬──────┘  │     │
│                            │        │         │     │
│                            │  ┌─────▼──────┐  │     │
│                            │  │ Parakeet   │  │     │
│                            │  │ v3 (ASR)   │  │     │
│                            │  └────────────┘  │     │
│                            └──────────────────┘     │
│                                                      │
│              🔒 Nothing leaves this box 🔒           │
└──────────────────────────────────────────────────────┘
```

## 📁 Project structure

```
loophole/
├── main.py                 # Entry point
├── pyproject.toml          # Dependencies
└── src/loophole/
    ├── api.py              # PyWebView bridge
    ├── transcriber.py      # VAD + Parakeet magic
    └── static/
        ├── index.html      # UI
        ├── style.css       # Dark mode goodness
        └── src/app.ts      # Frontend logic
```

## 🔧 Troubleshooting

**"No microphones found"**
- Check mic is plugged in (yes, really)
- Grant browser permission when prompted
- Restart the app

**"Model loading failed"**
- First run needs internet to download the model
- Make sure you have ~2GB free space
- Check `~/.cache/huggingface/` if downloads seem stuck

**"It's slow"**
- First transcription is always slower (model warmup)
- GPU helps a lot, but CPU works fine
- Close other heavy apps if RAM is tight

**"Sentences get cut off"**
- This was fixed! Make sure you have the latest version
- The VAD now waits for 2s silence before transcribing

## 🧪 Tech stack

| Layer | Technology |
|-------|------------|
| UI | HTML + CSS + TypeScript |
| Desktop wrapper | PyWebView |
| Speech-to-text | NVIDIA Parakeet TDT 0.6B v3 |
| Voice activity detection | Silero VAD |
| Audio processing | PyAudio, SoundFile |

## 📜 License

MIT — do whatever you want, just don't blame us if it breaks.

---

*Made with 🎙️ for people who type too slow.*
