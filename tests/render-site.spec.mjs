import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';

test('Docker frontend uses opaque uniform satellites and preserves the visible outline toggle',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Exercise the actual Docker frontend and API, using the locally built copy of its Cesium release.
  await page.route('https://cesium.com/downloads/cesiumjs/releases/1.144/Build/Cesium/**',async route=>{
    const relative=route.request().url().split('/Build/Cesium/')[1].split('?')[0];
    await route.fulfill({path:fileURLToPath(new URL('../standalone/vendor/cesium/'+relative,import.meta.url))});
  });
  await page.route('**/api/snapshot',async route=>{
    await page.evaluate(()=>{
      if(window.satelliteEntities)return;
      const add=Cesium.EntityCollection.prototype.add;window.satelliteEntities=[];
      Cesium.EntityCollection.prototype.add=function(options){const entity=add.call(this,options);if(options.model&&options.point)window.satelliteEntities.push(entity);return entity;};
    });
    await route.continue();
  });
  await page.goto('/');await expect(page.locator('#previewBtn')).toBeEnabled({timeout:45000});
  await page.locator('#previewBtn').click();
  const markers=()=>page.evaluate(()=>{
    const now=Cesium.JulianDate.now(),read=p=>p?.getValue(now);
    return window.satelliteEntities.map(e=>({active:e._kleoServiceVisible,
      color:read(e.point.color)?.toCssHexString(),alpha:read(e.point.color)?.alpha,
      diameter:read(e.point.pixelSize)+2*read(e.point.outlineWidth),outline:read(e.point.outlineWidth),
      modelAlpha:read(e.model.color)?.alpha,modelColor:read(e.model.color)?.toCssHexString(),blend:read(e.model.colorBlendMode),
      modelSize:read(e.model.minimumPixelSize),silhouette:read(e.model.silhouetteSize)}));
  });
  await expect.poll(async()=>(await markers()).length).toBe(128);
  const first=await markers();expect(first.some(m=>m.active)).toBe(true);expect(first.some(m=>!m.active)).toBe(true);
  expect(first.every(m=>m.alpha===1&&m.modelAlpha===1&&m.color==='#74b6ff'&&m.modelColor==='#74b6ff'&&m.blend===1)).toBe(true);
  expect(new Set(first.map(m=>m.diameter)).size).toBe(1);expect(new Set(first.map(m=>m.modelSize)).size).toBe(1);
  expect(first.every(m=>m.active?m.outline>0:m.outline===0)).toBe(true);
  await page.locator('details').filter({has:page.locator('#highlightVisible')}).locator('summary').click();
  await expect(page.locator('#satModel option')).toHaveCount(7);
  for(const key of ['default','compact','broadband','flatpanel','cubesat','radar','telescope']){
    const file=key==='default'?'kleo_satellite.glb':`kleo_satellite_${key}.glb`;
    expect((await page.request.get('/static/'+file)).ok()).toBe(true);
    await page.locator('#satModel').selectOption(key);
    expect(await page.evaluate(file=>window.satelliteEntities.every(e=>e.model.uri.getValue().endsWith(file)),file)).toBe(true);
    expect((await markers()).every(m=>m.modelAlpha===1&&m.modelColor==='#74b6ff')).toBe(true);
  }
  await page.locator('#highlightVisible').uncheck();
  expect((await markers()).every(m=>m.outline===0&&m.silhouette===0&&m.alpha===1)).toBe(true);
  await page.locator('#highlightVisible').check();
  for(const mode of ['2d','2d-map','2d-globe']){
    await page.locator('#sceneMode').selectOption(mode);
    if(mode==='2d')expect((await markers()).every(m=>m.alpha===1&&m.color==='#74b6ff')).toBe(true);
    else{
      const canvas=page.locator('#flatCanvas'),before=await canvas.evaluate(c=>c.toDataURL());
      await page.locator('#highlightVisible').uncheck();
      expect(await canvas.evaluate(c=>c.toDataURL())).not.toBe(before);
      await page.locator('#highlightVisible').check();
    }
  }
  await page.locator('#sceneMode').selectOption('3d');
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'outputs/render-site-uniform-satellites.png',fullPage:true});
  await page.locator('#highlightVisible').uncheck();
  await page.reload();await expect(page.locator('#previewBtn')).toBeEnabled({timeout:45000});
  await expect(page.locator('#highlightVisible')).not.toBeChecked();
  await expect(page.locator('#satModel')).toHaveValue('telescope');
  expect(errors).toEqual([]);
});
