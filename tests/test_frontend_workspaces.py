import shutil
import subprocess

import pytest


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js required for frontend behavioral tests")
def test_frontend_workspace_navigation_and_preview():
    result = subprocess.run(
        ["node", "tests/frontend_workspaces.cjs"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=20,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "workspace behavior checks passed" in result.stdout
