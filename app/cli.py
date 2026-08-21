from __future__ import annotations

import argparse
import threading
import webbrowser

import uvicorn

APP_VERSION = "1.0.0"


def _open_browser(url: str) -> None:
    webbrowser.open(url, new=2)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="kleo",
        description="Run Test Orbit Designer development server.",
    )
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Bind port (default: 8000)")
    parser.add_argument("--reload", action="store_true", help="Enable development auto-reload")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically")
    parser.add_argument("--version", action="version", version=f"Test Orbit Designer {APP_VERSION}")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    display_host = "127.0.0.1" if args.host in {"0.0.0.0", "::"} else args.host
    url = f"http://{display_host}:{args.port}"

    if not args.no_browser:
        timer = threading.Timer(1.0, _open_browser, args=(url,))
        timer.daemon = True
        timer.start()

    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
