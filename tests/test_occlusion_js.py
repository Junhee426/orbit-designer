import json
import shutil
import subprocess
from pathlib import Path

import pytest


HTML_PATH = Path("app/static/index.html")


def test_wgs84_horizon_occlusion_function_in_node():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js is not available")
    html_path = json.dumps(str(HTML_PATH.resolve()))
    script = f"""
const fs=require('fs');
const html=fs.readFileSync({html_path},'utf8');
const start=html.indexOf('function isEarthOccluded(camera,sat)');
const end=html.indexOf('function updatePointOcclusion()', start);
if(start<0||end<0) throw new Error('occlusion function not found');
let earthOn=true;
function $(id){{ if(id==='earthOn') return {{checked:earthOn}}; throw new Error(id); }}
eval(html.slice(start,end));
const R=6378137.0;
const camera={{x:3*R,y:0,z:0}};
const front={{x:1.14*R,y:0,z:0}};
const back={{x:-1.14*R,y:0,z:0}};
if(isEarthOccluded(camera,front)!==false) throw new Error('front satellite incorrectly occluded');
if(isEarthOccluded(camera,back)!==true) throw new Error('back satellite not occluded');
earthOn=false;
if(isEarthOccluded(camera,back)!==false) throw new Error('Earth-off should disable horizon occlusion');
console.log('ok');
"""
    r = subprocess.run([node, "-e", script], capture_output=True, text=True, check=False)
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "ok"
