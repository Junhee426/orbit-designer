import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';

test('service region visibility hides map overlays without changing analysis targets',async({page})=>{
  const errors=[],snapshots=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://cesium.com/downloads/cesiumjs/releases/1.144/Build/Cesium/**',async route=>{
    const relative=route.request().url().split('/Build/Cesium/')[1].split('?')[0];
    await route.fulfill({path:fileURLToPath(new URL('../standalone/vendor/cesium/'+relative,import.meta.url))});
  });
  await page.route('**/ne_50m_admin_0_countries.geojson',route=>route.fulfill({path:fileURLToPath(new URL('../app/static/service_boundaries_fallback.geojson',import.meta.url))}));
  await page.route('**/api/snapshot',async route=>{
    snapshots.push(route.request().postDataJSON());
    await page.evaluate(()=>{
      if(window.serviceMarkers)return;
      window.serviceMarkers=[];
      const add=Cesium.EntityCollection.prototype.add;
      Cesium.EntityCollection.prototype.add=function(options){const entity=add.call(this,options);if(options.point&&options.label&&!options.model)window.serviceMarkers.push(entity);return entity;};
      const addData=Cesium.DataSourceCollection.prototype.add;
      Cesium.DataSourceCollection.prototype.add=function(ds){window.serviceDataSources=this;return addData.call(this,ds);};
    });
    await route.continue();
  });
  await page.goto('/');await expect(page.locator('#previewBtn')).toBeEnabled({timeout:45000});
  const controls=page.locator('details').filter({has:page.locator('#showServiceAreas')});
  await controls.locator('summary').click();
  await page.locator('#accessOn').check();
  await expect.poll(()=>page.evaluate(()=>window.serviceMarkers.length)).toBeGreaterThan(0);
  await page.locator('#boundaryMode').selectOption('auto');
  await expect.poll(()=>page.evaluate(()=>window.serviceDataSources?.length)).toBe(1);
  const targetInputs=JSON.stringify(snapshots.at(-1).stations),requestCount=snapshots.length;
  const countries=await page.locator('.service-country:checked').evaluateAll(nodes=>nodes.map(n=>n.value));
  await page.locator('#showServiceAreas').uncheck();
  await expect(page.locator('#boundaryMode')).toBeDisabled();
  await expect(page.locator('#boundaryMode')).toHaveValue('auto');
  await expect(page.locator('#accessOn')).toBeChecked();
  await expect.poll(()=>page.evaluate(()=>window.serviceMarkers.every(e=>!e.show))).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.serviceDataSources.length)).toBe(0);
  expect(snapshots.length).toBe(requestCount);
  for(const mode of ['2d','3d']){
    await page.locator('#sceneMode').selectOption(mode);
    await expect.poll(()=>page.evaluate(()=>window.serviceMarkers.every(e=>!e.show))).toBe(true);
  }
  await page.evaluate(()=>{
    window.cityLabels=[];const fillText=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(text==='Seoul')window.cityLabels.push(text);return fillText.call(this,text,...args);};
  });
  for(const mode of ['2d-map','2d-globe']){
    await page.evaluate(()=>{window.cityLabels=[];});await page.locator('#sceneMode').selectOption(mode);
    expect(await page.evaluate(()=>window.cityLabels)).toEqual([]);
    await page.locator('#showServiceAreas').check();
    await expect.poll(()=>page.evaluate(()=>window.cityLabels.length)).toBeGreaterThan(0);
    await page.evaluate(()=>{window.cityLabels=[];});await page.locator('#showServiceAreas').uncheck();
    expect(await page.evaluate(()=>window.cityLabels)).toEqual([]);
  }
  expect(await page.locator('.service-country:checked').evaluateAll(nodes=>nodes.map(n=>n.value))).toEqual(countries);
  await page.locator('#previewBtn').click();
  await expect.poll(()=>snapshots.length).toBeGreaterThan(requestCount);
  expect(JSON.stringify(snapshots.at(-1).stations)).toBe(targetInputs);
  await page.locator('#sceneMode').selectOption('3d');
  await controls.screenshot({path:'outputs/legacy-service-regions-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  if(await page.locator('#settingsToggle').getAttribute('aria-expanded')==='false')await page.locator('#settingsToggle').click();
  await controls.screenshot({path:'outputs/legacy-service-regions-mobile.png'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.reload();await expect(page.locator('#previewBtn')).toBeEnabled({timeout:45000});
  await expect(page.locator('#showServiceAreas')).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('Docker frontend preserves satellite styling, independent labels and empty selection',async({page})=>{
  test.setTimeout(120000);
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
  await expect(page.locator('#showSatelliteLabels')).toBeChecked();
  await expect(page.locator('#clearSatelliteSelection')).toBeDisabled();
  const geometry=page.waitForResponse(response=>response.url().endsWith('/api/orbital-geometry'));
  await page.locator('#nextServiceSatellite').click();await geometry;
  await expect(page.locator('#satDetails .sat-title')).toBeVisible();
  await expect(page.locator('#clearSatelliteSelection')).toBeEnabled();
  const selectedName=await page.locator('#satDetails .sat-title').textContent();
  const visibleLabels=()=>page.evaluate(()=>window.satelliteEntities.filter(e=>e.label.show.getValue()).length);
  await expect.poll(visibleLabels).toBe(1);
  await page.locator('#showSatelliteLabels').uncheck();
  for(const [sceneMode,render]of [['3d','point'],['3d','model'],['2d',null]]){
    await page.locator('#sceneMode').selectOption(sceneMode);
    if(render)await page.locator('#satRender').selectOption(render);
    await expect.poll(visibleLabels).toBe(0);
    await expect(page.locator('#satDetails .sat-title')).toHaveText(selectedName);
  }
  await page.evaluate(name=>{
    window.satelliteLabelDraws=[];
    const fillText=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){
      if(String(text).startsWith(name+' · '))window.satelliteLabelDraws.push(text);
      return fillText.call(this,text,...args);
    };
  },selectedName);
  for(const sceneMode of ['2d-map','2d-globe']){
    await page.evaluate(()=>{window.satelliteLabelDraws=[];});
    await page.locator('#sceneMode').selectOption(sceneMode);
    expect(await page.evaluate(()=>window.satelliteLabelDraws)).toEqual([]);
    await page.locator('#showSatelliteLabels').check();
    await expect.poll(()=>page.evaluate(()=>window.satelliteLabelDraws.length)).toBeGreaterThan(0);
    await page.evaluate(()=>{window.satelliteLabelDraws=[];});
    await page.locator('#showSatelliteLabels').uncheck();
    expect(await page.evaluate(()=>window.satelliteLabelDraws)).toEqual([]);
  }
  await page.locator('#sceneMode').selectOption('3d');
  await page.locator('.satellite-selection-actions').scrollIntoViewIfNeeded();
  await page.screenshot({path:'outputs/legacy-satellite-selection-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.locator('#settingsToggle').click();
  await page.locator('.satellite-selection-actions').scrollIntoViewIfNeeded();
  expect(await page.locator('.satellite-selection-actions').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'outputs/legacy-satellite-selection-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  // An old geometry response must not restore overlays after clearing selection.
  let releaseGeometry,geometryRequested;
  const heldGeometry=new Promise(resolve=>{releaseGeometry=resolve;}),requestedGeometry=new Promise(resolve=>{geometryRequested=resolve;});
  await page.route('**/api/orbital-geometry',async route=>{
    const response=await route.fetch();geometryRequested();await heldGeometry;await route.fulfill({response});
  });
  await page.locator('#nextServiceSatellite').click();await requestedGeometry;
  try{
    await page.locator('#clearSatelliteSelection').click();
    await expect(page.locator('#satDetails')).toHaveClass('empty-details');
    await expect(page.locator('#clearSatelliteSelection')).toBeDisabled();
    await expect(page.locator('#statTrack')).toHaveText('0');
    await expect(page.locator('#statFootprint')).toHaveText('0 km');
    await expect.poll(visibleLabels).toBe(0);
  }finally{releaseGeometry();}
  await expect.poll(()=>page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.endsWith('/api/orbital-geometry')).length)).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#statTrack')).toHaveText('0');
  await expect(page.locator('#statFootprint')).toHaveText('0 km');
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'outputs/render-site-uniform-satellites.png',fullPage:true});
  await page.locator('#highlightVisible').uncheck();
  await page.reload();await expect(page.locator('#previewBtn')).toBeEnabled({timeout:45000});
  await expect(page.locator('#highlightVisible')).not.toBeChecked();
  await expect(page.locator('#showSatelliteLabels')).not.toBeChecked();
  await expect(page.locator('#satModel')).toHaveValue('telescope');
  expect(errors).toEqual([]);
});
