"""LoopHole - Local Dictation App entry point."""

import argparse
import sys
from pathlib import Path

# Add project root to path for imports when installed
project_root = Path(__file__).parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

import webview

from loophole.api import API
from loophole.transcriber import TranscriberWithVAD


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
