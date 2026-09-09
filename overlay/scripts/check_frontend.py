"""Check every inline application script using Node.js (no browser needed)."""
import re
import subprocess
from pathlib import Path

def main():
    html = (Path(__file__).resolve().parents[1] / "app/static/index.html").read_text()
    for script in re.findall(r"<script(?:\s[^>]*)?>([\s\S]*?)</script>", html):
        if script.strip():
            subprocess.run(["node", "--check", "--input-type=commonjs"], input=script, text=True, check=True)

if __name__ == "__main__":
    main()
