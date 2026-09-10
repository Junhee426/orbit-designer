"""Check every application script using Node.js (no browser needed)."""
import re
import subprocess
from pathlib import Path

STATIC = Path(__file__).resolve().parents[1] / "app/static"

def main():
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    for script in re.findall(r"<script(?:\s[^>]*)?>([\s\S]*?)</script>", html):
        if script.strip():
            subprocess.run(["node", "--check", "--input-type=commonjs"], input=script, text=True, encoding="utf-8", check=True)
    subprocess.run(["node", "--check", str(STATIC / "app.js")], check=True)

if __name__ == "__main__":
    main()
