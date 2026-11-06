const { test, expect } = require('@playwright/test');

test('map failure offers a retry and recovers after the style becomes available', async ({ page }) => {
  test.setTimeout(60000);
  let available = false;
  await page.route('https://tiles.openfreemap.org/styles/liberty', route => available
    ? route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] } })
    : route.fulfill({ status: 503 }));
  await page.route('https://tiles.mapterhorn.com/**', route => route.abort());
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.goto('/');
  await expect(page.getByText('Map data could not be loaded.')).toBeVisible({ timeout: 25000 });
  await expect(page.getByText('The map needs a connection to the map and elevation tile services.')).toBeVisible();
  available = true;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 20000 });
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
});
