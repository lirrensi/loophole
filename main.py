"""LoopHole - Local Dictation App entry point."""

import webview

from src.loophole.api import API
from src.loophole.transcriber import TranscriberWithVAD


def main() -> None:
    """Initialize and start the dictation application."""
    print("Loading Parakeet v3 model...")
    transcriber = TranscriberWithVAD()
    print(f"Model loaded: {transcriber.is_loaded()}")

    api = API(transcriber)

    window = webview.create_window(
        title="LoopHole",
        url="src/loophole/static/index.html",
        js_api=api,
        width=800,
        height=700,
        resizable=True,
    )

    api.set_window(window)

    print("Starting LoopHole...")
    webview.start(debug=True)


if __name__ == "__main__":
    main()
