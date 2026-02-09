#!/usr/bin/env python3
"""Build the frontend TypeScript."""

import subprocess
import sys
from pathlib import Path


def main() -> int:
    static_dir = Path(__file__).parent / "src" / "loophole" / "static"

    print("🔨 Building frontend...")

    # Check if npm is available
    try:
        subprocess.run(["npm", "--version"], check=True, capture_output=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("❌ npm not found. Please install Node.js.")
        return 1

    # Install dependencies if needed
    node_modules = static_dir / "node_modules"
    if not node_modules.exists():
        print("📦 Installing dependencies...")
        result = subprocess.run(["npm", "install"], cwd=static_dir)
        if result.returncode != 0:
            print("❌ npm install failed")
            return 1

    # Compile TypeScript
    print("📜 Compiling TypeScript...")
    result = subprocess.run(["npx", "tsc"], cwd=static_dir)
    if result.returncode != 0:
        print("❌ TypeScript compilation failed")
        return 1

    print("✅ Frontend built successfully!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
