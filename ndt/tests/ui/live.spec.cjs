const { test, expect } = require('@playwright/test');

test.skip(!process.env.NDT_LIVE_UI, 'Set NDT_LIVE_UI=1 to test live external map services.');

for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
  test(`live map loads on ${name}`, async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await page.setViewportSize(viewport);
    await page.route('**/app.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({response, body:(await response.text()).replace('const map = new maplibregl.Map', 'const map = window.testMap = new maplibregl.Map')});
    });
    const style = page.waitForResponse(response => response.url().startsWith('https://tiles.openfreemap.org/styles/liberty') && response.ok(), { timeout: 30000 });
    await page.goto('/');
    await style;
    await expect(page.locator('#loading')).toBeHidden({ timeout: 30000 });
    await expect(page.locator('#error')).toBeHidden();
    await expect(page.locator('#network-status')).toContainText('In view:', { timeout: 30000 });
    await expect.poll(() => page.evaluate(() => window.testMap.getSource('project-coverage')._data.features.length), {timeout:30000}).toBe(4);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Harbourfront' }).click();
    await expect(page.locator('#project-status')).toContainText('7 Bell locations', {timeout:15000});
    await expect.poll(() => page.evaluate(() => !window.testMap.isMoving()), {timeout:15000}).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${name}-harbourfront.png`) });
    if (name === 'desktop') {
      const site = await page.evaluate(() => window.testMap.getSource('project-sites')._data.features[0].geometry.coordinates);
      await expect.poll(() => page.evaluate(coordinates=>window.testMap.queryRenderedFeatures(window.testMap.project(coordinates),{layers:['project-site-markers']}).length,site)).toBeGreaterThan(0);
      const point = await page.evaluate(coordinates=>window.testMap.project(coordinates),site);
      await page.mouse.click(point.x,point.y,{button:'right'});
      await expect(page.getByRole('button',{name:'Remove site from project'})).toBeVisible();
      await page.screenshot({path:testInfo.outputPath('desktop-project-site-menu.png')});
      await page.locator('.maplibregl-popup-close-button').click();
      const query = page.getByRole('searchbox', { name: 'Search locations' });
      await query.fill('CN Tower Toronto');
      const response = page.waitForResponse(response => response.url().startsWith('https://photon.komoot.io/api/') && response.ok(), { timeout: 20000 });
      await query.press('Enter');
      await response;
      await expect(page.locator('#search-list button').first()).toBeVisible();
      await page.locator('#search-list button').first().click();
      await expect(page.locator('#search-results')).toBeHidden();
    }
  });
}

test('live New York region loads with Verizon reservations', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.setViewportSize({width:1440,height:900});
  const style = page.waitForResponse(response => response.url().startsWith('https://tiles.openfreemap.org/styles/liberty') && response.ok(), {timeout:30000});
  await page.goto('/?region=new-york');
  await style;
  await expect(page.locator('#loading')).toBeHidden({timeout:30000});
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#nyc-status')).toContainText('701 in the NYC snapshot', {timeout:30000});
  await page.getByRole('button', {name:'Manhattan', exact:true}).click();
  await expect(page.locator('#coordinates')).toContainText('40.7484', {timeout:15000});
  await page.screenshot({path:testInfo.outputPath('new-york-manhattan.png')});
});
