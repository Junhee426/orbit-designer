import {test,expect} from '@playwright/test';
test('standalone flow: local assets, J2, countries, analysis, exports, stale results and restored custom observer',async({page})=>{
  const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if((/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:8080'))||r.url().includes('/api/'))external.push(r.url());});
  await page.goto('/');await expect(page.locator('#status')).toContainText('준비 완료');
  await expect(page.locator('#workspace-title')).toHaveText('통신·항법 통합 궤도 배치');await expect(page.locator('#snapshot-metrics')).toContainText('최선 링크 처리량');expect(await page.locator('#nav-performance').evaluate(el=>el.open)).toBe(true);await expect(page.locator('#globe')).toHaveAttribute('data-navigation','visible');await page.locator('#nav-performance > summary').click();await expect(page.locator('#globe')).toHaveAttribute('data-navigation','visible');await page.locator('#nav-performance > summary').click();await page.locator('[data-tab="analysis"]').click();await expect(page.locator('#sidebar-title')).toHaveText('분석 조건');
  expect(await page.locator('#nav-settings').evaluate(el=>el.open)).toBe(true);await expect(page.locator('[data-config="leoNav"]')).toBeVisible();await expect(page.locator('[data-config="leoNav"]')).toBeChecked();
  await expect(page.locator('[data-country]:checked')).toHaveCount(1);await expect(page.locator('[data-country="KOR"]')).toBeChecked();await page.locator('[data-tab="design"]').click();await expect(page.locator('[data-config="j2"]')).toBeChecked();await page.locator('[data-tab="analysis"]').click();
  await page.locator('#duration').fill('20');await page.locator('#step').fill('60');await page.locator('#run').click();await expect(page.locator('#status')).toHaveText('분석 완료');
  await expect(page.locator('#station-table tbody tr')).toHaveCount(3);await expect(page.locator('#period-metrics')).toContainText('통신 목표 충족률');await expect(page.locator('#period-metrics')).toContainText('처리량 중앙값');expect(await page.locator('#analysis-nav-performance').evaluate(el=>el.open)).toBe(true);await expect(page.locator('#nav-period-metrics')).toContainText('항법 목표 충족률');await expect(page.locator('#nav-comparison tbody tr')).toHaveCount(3);
  const downloaded=page.waitForEvent('download');await page.locator('#export-json').click();const download=await downloaded;const stream=await download.createReadStream();const chunks=[];for await(const c of stream)chunks.push(c);const data=JSON.parse(Buffer.concat(chunks).toString());expect(data.observers[0].samples).toHaveLength(21);expect(data.metadata.input_sha256).toHaveLength(64);
  await page.locator('[data-tab="design"]').click();await page.locator('[data-config="altitude"]').fill('888');await page.locator('[data-config="altitude"]').blur();await page.locator('[data-tab="analysis"]').click();await expect(page.locator('#analysis-note')).toContainText('이전 설정');
  await page.locator('#add-observer').click();await page.locator('.custom-observer [data-key="name"]').fill('Custom test');await page.locator('.custom-observer [data-key="lat"]').fill('-25.5');await page.locator('.custom-observer [data-key="lon"]').fill('179.9');await page.locator('.custom-observer [data-key="lon"]').blur();
  const saved=page.waitForEvent('download');await page.locator('#save-scenario').click();const savedFile=await saved;const savedStream=await savedFile.createReadStream();const savedChunks=[];for await(const c of savedStream)savedChunks.push(c);const json=Buffer.concat(savedChunks);
  await page.locator('#scenario-file').setInputFiles({name:'scenario.json',mimeType:'application/json',buffer:json});await expect(page.locator('.custom-observer [data-key="lat"]')).toHaveValue('-25.5');
  await page.locator('[data-tab="design"]').click();await page.locator('#earth-style').selectOption('outline');await expect(page.locator('#globe')).toHaveAttribute('data-earth-style','outline');await page.locator('#earth-style').selectOption('image');await expect(page.locator('#globe')).toHaveAttribute('data-earth-style','image');await page.locator('#earth-style').selectOption('outline');await page.locator('#map-mode').selectOption('2d');await page.locator('#map-mode').selectOption('2d-globe');await page.locator('#map-mode').selectOption('2d-map');await page.locator('#map-mode').selectOption('3d');await page.locator('#show-heatmap').check();await page.locator('#show-footprint').check();await page.locator('#route').click();await expect(page.locator('#route-result')).toContainText('ms');
  await page.evaluate(()=>{scrollTo(0,0);document.querySelector('.sidebar').scrollTop=0;});await page.screenshot({path:'outputs/standalone-desktop.png',fullPage:true});
  expect(errors).toEqual([]);expect(external).toEqual([]);
});
test('multi-shell, TLE and cancellation stay usable',async({page})=>{
  await page.goto('/');await expect(page.locator('#status')).toContainText('준비 완료');await page.locator('[data-config="mode"]').selectOption('multi_shell');await page.locator('#add-shell').click();await expect(page.locator('#orbit-note')).toContainText('2개 층');
  await page.locator('[data-config="mode"]').selectOption('tle');await page.locator('#example-tle').click();await expect(page.locator('#orbit-note')).toContainText('SGP4');await expect(page.locator('#error')).toBeHidden();await page.locator('[data-tab="analysis"]').click();
  await page.locator('#duration').fill('10');await page.locator('#step').fill('60');await page.locator('#run').click();await expect(page.locator('#status')).toHaveText('분석 완료');
  await page.locator('[data-tab="design"]').click();await page.locator('[data-config="mode"]').selectOption('walker');await page.locator('[data-tab="analysis"]').click();await page.locator('#duration').fill('1440');await page.locator('#step').fill('60');await page.locator('#run').click();await page.locator('#cancel').click();await expect(page.locator('#status')).toHaveText('계산을 취소했습니다.');await expect(page.locator('#run')).toBeEnabled();
  await page.locator('#duration').fill('10');await page.locator('[data-tab="trade"]').click();await page.locator('#run-trade').click();await expect(page.locator('#status')).toHaveText('분석 완료');await expect(page.locator('#trade-table tbody tr')).toHaveCount(6);
  await page.locator('#sweep-axis').selectOption('altitude');await page.locator('#sweep').click();await expect(page.locator('#sweep-note')).toContainText('순간 성능');await expect(page.locator('#sweep-rate svg')).toHaveCount(1);
});
test('comm-only domain hides nav UI and narrows tables; satellite style controls and canvas-mode layers work',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('#status')).toContainText('준비 완료');
  await page.locator('[data-tab="analysis"]').click();await page.locator('#duration').fill('5');await page.locator('#run').click();await expect(page.locator('#status')).toHaveText('분석 완료');
  const navCols=await page.locator('#station-table thead th').count();
  await page.locator('[data-tab="trade"]').click();await page.locator('#duration').fill('5');await page.locator('#run-trade').click();await expect(page.locator('#status')).toHaveText('분석 완료');
  const navTradeHeaders=await page.locator('#trade-table thead th').allTextContents();
  await page.locator('button[data-domain="comm"]').click();
  await expect(page.locator('#nav-settings')).toBeHidden();
  await page.locator('[data-tab="design"]').click();await expect(page.locator('#nav-performance')).toBeHidden();await expect(page.locator('#workspace-title')).toHaveText('통신망 궤도 배치');
  await page.locator('[data-tab="analysis"]').click();await expect(page.locator('#analysis-nav-performance')).toBeHidden();
  const commCols=await page.locator('#station-table thead th').count();expect(commCols).toBeLessThan(navCols);
  await page.locator('[data-tab="trade"]').click();
  const commTradeHeaders=await page.locator('#trade-table thead th').allTextContents();
  expect(commTradeHeaders.length).toBeLessThan(navTradeHeaders.length);expect(commTradeHeaders.join(' ')).not.toContain('항법');
  await page.locator('button[data-domain="commNav"]').click();await expect(page.locator('#nav-settings')).toBeVisible();
  // satellite style controls persist across a view-mode switch
  await page.locator('[data-tab="design"]').click();
  await page.locator('#sat-shape').selectOption('diamond');await page.locator('#sat-size').fill('2');await page.locator('#orbit-width').fill('2.5');
  await expect(page.locator('#sat-size-value')).toHaveText('2.00×');await expect(page.locator('#orbit-width-value')).toHaveText('2.5×');
  await page.locator('#map-mode').selectOption('2d-map');await expect(page.locator('#sat-shape')).toHaveValue('diamond');
  // canvas-mode layers: ISL/heatmap toggles and satellite selection shouldn't error in the lightweight renderer
  await page.locator('#show-isl').check();await page.locator('#show-heatmap').check();
  await page.locator('#satellite').selectOption({index:1});
  await page.waitForTimeout(200);
  await page.locator('#map-mode').selectOption('2d-globe');await page.waitForTimeout(200);
  expect(errors).toEqual([]);
});
test('mobile layout runs with locally served assets',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('#status')).toContainText('준비 완료');await page.locator('#toggle-settings').click();await page.locator('[data-tab="analysis"]').click();await page.locator('#duration').fill('5');await page.locator('#run').click();await expect(page.locator('#status')).toHaveText('분석 완료');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);expect(overflow).toBe(false);await page.screenshot({path:'outputs/standalone-mobile.png',fullPage:true});
});

test('zoom buttons change every map mode without changing simulation state',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('#status')).toContainText('준비 완료');
  await page.locator('#satellite').selectOption({index:1});
  const selected=await page.locator('#satellite').inputValue();
  await page.evaluate(()=>{
    const original=Cesium.Camera.prototype.zoomIn;
    window.zoomSamples=[];
    Cesium.Camera.prototype.zoomIn=function(amount){
      const before=this.positionCartographic.height;
      original.call(this,amount);
      window.zoomSamples.push([before,this.positionCartographic.height]);
    };
  });
  for(const mode of ['3d','2d']){
    await page.locator('#map-mode').selectOption(mode);
    await page.getByRole('button',{name:'지구 확대',exact:true}).click();
    const closer=await page.evaluate(()=>window.zoomSamples.at(-1));
    expect(closer[1]).toBeLessThan(closer[0]);
    await page.getByRole('button',{name:'지구 축소',exact:true}).click();
    const farther=await page.evaluate(()=>window.zoomSamples.at(-1));
    expect(farther[1]).toBeGreaterThan(farther[0]);
  }
  for(const mode of ['2d-globe','2d-map']){
    await page.locator('#map-mode').selectOption(mode);
    const canvas=page.locator('#globe > canvas');
    const before=await canvas.evaluate(c=>c.toDataURL());
    await page.locator('#zoom-in').click();
    expect(await canvas.evaluate(c=>c.toDataURL())).not.toBe(before);
    await page.locator('#zoom-out').click();
    expect(await canvas.evaluate(c=>c.toDataURL())).toBe(before);
  }
  await expect(page.locator('#satellite')).toHaveValue(selected);
  await expect(page.locator('#time')).toHaveValue('0');
  await expect(page.locator('#error')).toBeHidden();expect(errors).toEqual([]);
});

test('TLE renders and zooms in lightweight modes without WebGL',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/vendor/cesium/Cesium.js',route=>route.abort());
  await page.goto('/');await expect(page.locator('#status')).toContainText('준비 완료');
  await page.locator('[data-config="mode"]').selectOption('tle');
  await page.locator('#example-tle').click();
  for(const mode of ['3d','2d-globe','2d-map']){
    await page.locator('#map-mode').selectOption(mode);
    await page.locator('#zoom-in').click();await page.locator('#zoom-out').click();
    await expect(page.locator('#globe > canvas')).toBeVisible();
    await expect(page.locator('#error')).toBeHidden();
  }
  expect(errors).toEqual([]);
});

test('existing trade results reorder on domain changes and export the displayed order',async({page})=>{
  await page.goto('/');await expect(page.locator('#status')).toContainText('준비 완료');
  await page.locator('[data-tab="trade"]').click();
  await page.locator('[data-config="horizontalTarget"]').fill('0.1');
  await page.locator('#run-trade').click();await expect(page.locator('#status')).toHaveText('분석 완료');
  const first=page.locator('#trade-table tbody tr').first().locator('td').first();
  await expect(first).toHaveText('500');
  await page.locator('button[data-domain="comm"]').click();
  await expect(first).toHaveText('888');
  await expect(page.locator('#trade-note')).toContainText('통신 충족률 높은 순');
  const downloaded=page.waitForEvent('download');await page.locator('#export-trade').click();
  const stream=await (await downloaded).createReadStream(),chunks=[];
  for await(const c of stream)chunks.push(c);
  const data=JSON.parse(Buffer.concat(chunks).toString());
  expect(data.sort_metric).toBe('comm');expect(data.candidates[0].altitude).toBe(888);
  await page.locator('button[data-domain="commNav"]').click();
  await expect(first).toHaveText('500');
  await expect(page.locator('#trade-note')).toContainText('통신·항법 동시 충족률 높은 순');
  await expect(page.locator('#status')).toHaveText('분석 완료');
});

test('flat map recenters after zoom and drag, and follows the selected observer',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('#status')).toContainText('준비 완료');
  await page.locator('#map-mode').selectOption('2d-map');
  await page.locator('#zoom-in').click();await page.locator('#zoom-in').click();
  const canvas=page.locator('#globe > canvas');
  const before=await canvas.evaluate(c=>c.toDataURL());
  await page.locator('#recenter').click();
  expect(await canvas.evaluate(c=>c.toDataURL())).not.toBe(before);
  const centered=()=>canvas.evaluate(c=>Array.from(c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data));
  expect(await centered()).toEqual([255,255,255,255]);
  const box=await canvas.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+70,box.y+box.height/2+25,{steps:5});await page.mouse.up();
  expect(await centered()).not.toEqual([255,255,255,255]);
  await page.locator('#recenter').click();expect(await centered()).toEqual([255,255,255,255]);
  await page.locator('#observer').selectOption({index:1});
  expect(await centered()).toEqual([255,255,255,255]);
  await expect(page.locator('#error')).toBeHidden();expect(errors).toEqual([]);
});
