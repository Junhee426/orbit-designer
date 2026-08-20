"""Backward-compatible launcher.

Preferred command for V1.2+:
    uv run kleo
"""

from app.cli import main


if __name__ == "__main__":
    main()
