import shutil
import subprocess

import pytest


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js required for frontend behavioral tests")
def test_frontend_ui_behaviors():
    result = subprocess.run(
        ["node", "tests/frontend_ui.cjs"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=20,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "UI behavior checks passed" in result.stdout
