import shutil
import subprocess
from pathlib import Path
import pytest

@pytest.mark.skipif(shutil.which('node') is None, reason='Node.js required for frontend behavioral tests')
def test_frontend_async_playback_invalidation_and_exports():
    result = subprocess.run(['node','tests/frontend_v12.cjs'],capture_output=True,text=True,encoding='utf-8',timeout=20)
    assert result.returncode==0, result.stdout+result.stderr
    assert '7 frontend behavior checks passed' in result.stdout
