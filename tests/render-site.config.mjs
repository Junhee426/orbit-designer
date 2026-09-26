import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  testDir:'.',outputDir:'../test-results-render',testMatch:'render-site.spec.mjs',timeout:90000,workers:1,
  use:{baseURL:'http://127.0.0.1:8082',viewport:{width:1440,height:1000},
    launchOptions:{channel:process.platform==='win32'?'msedge':undefined,args:['--enable-webgl','--ignore-gpu-blocklist']}},
  webServer:{command:(process.env.KLEO_TEST_PYTHON||'python')+' -m uvicorn app.main:app --host 127.0.0.1 --port 8082',
    cwd:fileURLToPath(new URL('../',import.meta.url)),url:'http://127.0.0.1:8082/health',reuseExistingServer:true,timeout:30000}
});
