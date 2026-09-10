"""Use the installed Electron Node runtime for this local verification only."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
NODE=r'C:\Users\cjuny\AppData\Local\Programs\Microsoft VS Code\Code.exe'
os.environ['ELECTRON_RUN_AS_NODE']='1'
which=shutil.which
shutil.which=lambda name,*args,**kwargs: NODE if name=='node' else which(name,*args,**kwargs)
run=subprocess.run
def run_node(command,*args,**kwargs):
    if isinstance(command,list) and command[0]=='node':
        command=[NODE,*command[1:]]
    return run(command,*args,**kwargs)
subprocess.run=run_node

from scripts.check_frontend import main
main()
import pytest
raise SystemExit(pytest.main(['-q']))
