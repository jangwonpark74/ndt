const { test, expect } = require('@playwright/test');

test.skip(!process.env.NDT_LIVE_UI, 'Set NDT_LIVE_UI=1 to test live external map services.');

for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
  test(`live map loads on ${name}`, async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await page.setViewportSize(viewport);
    const style = page.waitForResponse(response => response.url().startsWith('https://tiles.openfreemap.org/styles/liberty') && response.ok(), { timeout: 30000 });
    await page.goto('/');
    await style;
    await expect(page.locator('#loading')).toBeHidden({ timeout: 30000 });
    await expect(page.locator('#error')).toBeHidden();
    await expect(page.locator('#network-status')).toContainText('In view:', { timeout: 30000 });
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Harbourfront' }).click();
    await expect(page.locator('#coordinates')).toContainText('43.6394', { timeout: 15000 });
    await page.screenshot({ path: testInfo.outputPath(`${name}-harbourfront.png`) });
    if (name === 'desktop') {
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
