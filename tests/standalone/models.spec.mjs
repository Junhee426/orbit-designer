import {test,expect} from '@playwright/test';
import {SATELLITE_MODELS} from '../../standalone/satellite-models.js';

test('seven 3D models load, retain uniform styling and restore after 2D and reload',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('#status')).toContainText('준비 완료');
  await page.locator('[data-config="planes"]').fill('2');
  await page.locator('[data-config="satellitesPerPlane"]').fill('4');
  await page.locator('[data-domain="comm"]').click();
  await page.evaluate(()=>{
    const render=Cesium.Scene.prototype.render;
    Cesium.Scene.prototype.render=function(...args){window.modelScene=this;return render.apply(this,args);};
  });
  await page.locator('#sat-render').selectOption('model');await page.locator('#sat-size').fill('3');
  const models=()=>page.evaluate(()=>{
    const out=[];
    const visit=collection=>{for(let i=0;i<(collection?.length??0);i++){const p=collection.get(i);if(p instanceof Cesium.Model)out.push({ready:p.ready,color:p.color.toCssHexString(),alpha:p.color.alpha,size:p.minimumPixelSize,outline:p.silhouetteSize,uri:p._resource?.url});else if(p instanceof Cesium.PrimitiveCollection)visit(p);}};
    visit(window.modelScene?.primitives);return out;
  });
  for(const [key,{file}]of Object.entries(SATELLITE_MODELS)){
    await page.locator('#sat-model').selectOption(key);
    await expect.poll(async()=>{const rows=await models();return rows.length===8&&rows.every(m=>m.ready&&m.uri?.endsWith(file));},{timeout:20000}).toBe(true);
    expect((await models()).every(m=>m.alpha===1&&m.color==='#74b6ff'&&m.size===48)).toBe(true);
  }
  await page.locator('#highlight-visible').uncheck();
  await expect.poll(async()=>(await models()).every(m=>m.outline===0)).toBe(true);
  for(const mode of ['2d','2d-map','2d-globe']){
    await page.locator('#map-mode').selectOption(mode);
    await expect(page.locator('#sat-model')).toBeDisabled();
    await expect(page.locator('#sat-model')).toHaveValue('telescope');
  }
  await page.locator('#map-mode').selectOption('3d');
  await expect.poll(async()=>(await models()).filter(m=>m.ready).length).toBe(8);
  await expect(page.locator('#save-status')).toHaveText('이 기기에 자동 저장됨');
  await page.reload();await expect(page.locator('#status')).toContainText('준비 완료');
  await expect(page.locator('#sat-render')).toHaveValue('model');await expect(page.locator('#sat-model')).toHaveValue('telescope');
  await expect(page.locator('#sat-model')).toBeEnabled();await expect(page.locator('#highlight-visible')).not.toBeChecked();
  await page.locator('.globe-panel').screenshot({path:'outputs/satellite-model-choices.png'});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)).toBe(false);
  expect(errors).toEqual([]);
});
