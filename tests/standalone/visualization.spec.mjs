import {test,expect} from '@playwright/test';

async function ready(page){
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('준비 완료');
}

test('scene focus and visual presets preserve the selected time and synchronize layers',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await ready(page);
  await page.locator('#map-mode').selectOption('2d-map');
  await page.locator('#time').fill('900');
  await expect(page.locator('#scene-clock')).toContainText('00:15:00');
  await expect(page.locator('#scene-observer')).toContainText('Seoul');
  await page.locator('[data-scene-preset="network"]').click();
  await expect(page.locator('#show-isl')).toBeChecked();
  await expect(page.locator('#show-heatmap')).not.toBeChecked();
  await page.locator('[data-scene-preset="coverage"]').click();
  await expect(page.locator('#show-heatmap')).toBeChecked();
  await expect(page.locator('#show-isl')).not.toBeChecked();
  await page.locator('[data-scene-preset="overview"]').click();
  await expect(page.locator('#show-orbits')).toBeChecked();
  await expect(page.locator('#show-heatmap')).not.toBeChecked();
  await expect(page.locator('#show-isl')).not.toBeChecked();
  await page.locator('#scene-focus').click();
  await expect(page.locator('body')).toHaveClass(/scene-focus/);
  await expect(page.locator('#globe')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/scene-focus/);
  await expect(page.locator('#time')).toHaveValue('900');
  await expect(page.locator('#scene-link-state')).not.toHaveText('');
  await expect(page.locator('#live-link-gauge')).not.toBeEmpty();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)).toBe(false);
  expect(errors).toEqual([]);
});

test('analysis charts expose sample values through keyboard and show gaps without invalid coordinates',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await ready(page);
  await page.locator('[data-config="altitude"]').fill('500');
  await page.locator('[data-config="planes"]').fill('2');
  await page.locator('[data-config="satellitesPerPlane"]').fill('4');
  await page.locator('[data-tab="analysis"]').click();
  await page.locator('#duration').fill('10');
  await page.locator('#step').fill('60');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('분석 완료');
  for(const id of ['rate-chart','margin-chart','visibility-chart','nav-chart']){
    await expect(page.locator(`#${id} svg.time-chart`)).toHaveCount(1);
    await expect(page.locator(`#${id} .chart-legend`)).not.toBeEmpty();
  }
  const graph=page.locator('#rate-chart svg.time-chart');
  await graph.focus();await graph.press('Home');
  await expect(graph).toHaveAttribute('data-active-sample','0');
  const tooltip=page.locator('#rate-chart .chart-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip.locator('[data-series="rate"]')).toContainText('Mbps');
  await graph.press('ArrowRight');
  await expect(graph).toHaveAttribute('data-active-sample','1');
  await expect(tooltip.locator('.chart-tooltip-heading')).toContainText('01:00');
  await graph.press('End');
  await expect(graph).toHaveAttribute('data-active-sample','10');
  await graph.press('Escape');await expect(tooltip).toBeHidden();
  const paths=await page.locator('#analysis-results svg path').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d')||''));
  expect(paths.some(d=>/NaN|Infinity/.test(d))).toBe(false);
  await expect(page.locator('#observer-comparison')).toContainText('Seoul');
  await page.locator('[data-tab="design"]').click();
  await page.locator('[data-config="altitude"]').fill('900');
  await page.locator('[data-config="altitude"]').blur();
  await page.locator('[data-tab="analysis"]').click();
  await expect(page.locator('#analysis-note')).toContainText('이전 설정');
  await expect(page.locator('#contact-table button').first()).toBeDisabled();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)).toBe(false);
  expect(errors).toEqual([]);
});

test('trade scatter points follow the domain and apply the compared conditions with the keyboard',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await ready(page);
  await page.locator('[data-tab="trade"]').click();
  await page.locator('#duration').fill('5');
  await page.locator('#run-trade').click();
  await expect(page.locator('#status')).toHaveText('분석 완료');
  const points=page.locator('#trade-chart .trade-point[role="button"]');
  await expect(points).toHaveCount(6);
  await expect(page.locator('#trade-chart').getByRole('button')).toHaveCount(6);
  await expect(points.first()).toHaveAttribute('tabindex','0');
  await expect(points.first()).toHaveAttribute('aria-label',/동시 충족률/);
  await page.locator('button[data-domain="comm"]').click();
  await expect(points.first()).toHaveAttribute('aria-label',/통신 충족률/);
  await page.locator('#duration').fill('10');await page.locator('#duration').blur();
  await expect(page.locator('#trade-note')).toContainText('이전 설정');
  const candidate=points.first();
  const label=await candidate.getAttribute('aria-label');
  const altitude=label.match(/고도\s*(\d+)\s*km/)[1];
  const satellites=Number(label.match(/위성\s*(\d+)기/)[1]);
  await candidate.focus();await candidate.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-workspace','design');
  await expect(page.locator('[data-config="altitude"]')).toHaveValue(altitude);
  await expect(page.locator('[data-config="planes"]')).toHaveValue(String(satellites/16));
  await expect(page.locator('#duration')).toHaveValue('5');
  expect(errors).toEqual([]);
});
