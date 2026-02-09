"""LoopHole - Local Dictation App entry point."""

import argparse

import webview

from src.loophole.api import API
from src.loophole.transcriber import TranscriberWithVAD


def main() -> None:
    """Initialize and start the dictation application."""
    parser = argparse.ArgumentParser(description="LoopHole - Local Dictation App")
    parser.add_argument("--debug", action="store_true", help="Enable debug tools")
    args = parser.parse_args()

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

    assert window is not None  # pyright always returns Optional
    api.set_window(window)

    print("Starting LoopHole...")
    webview.start(debug=args.debug)


if __name__ == "__main__":
    main()
