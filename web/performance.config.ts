import {defineConfig,devices} from '@playwright/test';

const port=Number(process.env.NUTRITION_PERFORMANCE_PORT??5188);
const outDir=process.env.NUTRITION_PERFORMANCE_DIST;
if(outDir&&!/^[a-z0-9/_-]+$/i.test(outDir))throw new Error('Use a relative benchmark bundle path.');
export default defineConfig({
  testDir:'./performance',fullyParallel:false,workers:1,timeout:600000,
  use:{...devices['Pixel 7'],channel:process.env.NUTRITION_TEST_BROWSER_CHANNEL,baseURL:`http://127.0.0.1:${port}`,serviceWorkers:'block'},
  webServer:{command:`npm run preview -- --port ${port}${outDir?` --outDir ${outDir}`:''}`,url:`http://127.0.0.1:${port}`,reuseExistingServer:false},
  reporter:[['list']]
});
