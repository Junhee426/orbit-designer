import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
export default defineConfig({testDir:'.',testMatch:'browser.spec.mjs',timeout:90000,workers:1,
  use:{baseURL:'http://127.0.0.1:8080',viewport:{width:1440,height:1050},launchOptions:{channel:process.platform==='win32'?'msedge':undefined,args:['--enable-webgl','--ignore-gpu-blocklist']},screenshot:'only-on-failure'},
  webServer:{command:'node scripts/serve-standalone.mjs',cwd:fileURLToPath(new URL('../../',import.meta.url)),url:'http://127.0.0.1:8080',reuseExistingServer:true,timeout:30000}
});
