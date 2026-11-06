const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

test.beforeEach(async ({ page }) => {
  // Keep UI behavior reproducible without relying on third-party tiles or search.
  await page.route('https://tiles.openfreemap.org/styles/liberty', route => route.fulfill({
    json: { version: 8, sources: { openmaptiles: { type: 'vector', tiles: ['http://127.0.0.1:5189/empty/{z}/{x}/{y}.pbf'] } }, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#d5e1dc' } }] },
  }));
  await page.route('**/empty/**', route => route.fulfill({ status: 204 }));
  await page.route('https://tiles.mapterhorn.com/**', route => route.abort());
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 20000 });
  await expect(page.locator('#error')).toBeHidden();
});

test('location search presents results, handles failures and supports Escape', async ({ page }) => {
  await page.route('https://photon.komoot.io/api/**', route => route.fulfill({
    json: { features: [{ geometry: { type: 'Point', coordinates: [-79.387, 43.643] }, properties: { name: 'CN Tower', city: 'Toronto', country: 'Canada' } }] },
  }));
  const query = page.getByRole('searchbox', { name: 'Search locations' });
  await query.fill('CN Tower');
  await query.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Choose a location' })).toBeVisible();
  await page.getByRole('button', { name: 'CN Tower, Toronto, Canada' }).click();
  await expect(query).toHaveValue('CN Tower, Toronto, Canada');
  await expect(page.locator('#search-results')).toBeHidden();
  await expect(page.locator('#coordinates')).toContainText('43.6430', { timeout: 10000 });
  await page.unroute('https://photon.komoot.io/api/**');
  await page.route('https://photon.komoot.io/api/**', route => route.fulfill({ status: 503 }));
  await query.fill('unavailable');
  await query.press('Enter');
  await expect(page.getByText('Search unavailable. Please try again.')).toBeVisible();
  await query.press('Escape');
  await expect(page.locator('#search-results')).toBeHidden();
  await expect(query).toBeFocused();
});

test('network and map controls expose usable states', async ({ page }) => {
  const network = page.getByRole('complementary', { name: 'Network infrastructure' });
  await expect(network).toBeVisible();
  await expect(page.locator('#network-status')).toContainText('In view:', { timeout: 20000 });
  await page.getByRole('button', { name: 'Close network view' }).click();
  await expect(network).toBeHidden();
  await page.getByText('Network', { exact: true }).click();
  const telus = page.getByLabel('TELUS sites');
  await expect(telus).not.toBeChecked();
  await telus.check();
  await expect(network).toBeVisible();
  await page.getByText('Map Settings', { exact: true }).click();
  const buildings = page.getByLabel('Buildings');
  await expect(buildings).toBeChecked();
  await buildings.uncheck();
  await expect(buildings).not.toBeChecked();
  await buildings.check();
  await expect(buildings).toBeChecked();
});

test('mobile navigation and camera controls remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Close network view' }).click();
  const navigation = page.getByRole('navigation', { name: 'Map navigation' });
  const controls = page.getByRole('navigation', { name: 'Camera controls' });
  await expect(navigation).toBeVisible();
  await expect(controls).toBeVisible();
  const harbourfront = page.getByRole('button', { name: 'Harbourfront' });
  await harbourfront.click();
  await expect(page.locator('#coordinates')).toContainText('43.6394', { timeout: 10000 });
  await page.getByRole('button', { name: 'Reset camera to Toronto overview' }).click();
  await expect(page.locator('#coordinates')).toContainText('43.7000', { timeout: 10000 });
  const box = await controls.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
});

test('site search, selection, bearing details and planning validation', async ({ page }) => {
  await expect(page.locator('#network-status')).toContainText('In view:', { timeout: 20000 });
  const search = page.getByLabel('Find a licensed site');
  await search.fill('no-such-site-123456789');
  await expect(page.locator('#network-list-status')).toHaveText('0 matching locations');
  await expect(page.locator('#network-list button')).toHaveCount(0);
  await search.fill('5205 Timberlea Boulevard');
  await expect(page.locator('#network-list button')).toHaveCount(1);
  await page.locator('#network-list button').first().click();
  await expect(page.locator('#network-detail')).toContainText('Bell Mobility');
  await expect(page.locator('#network-detail')).toContainText('5205 Timberlea Boulevard');
  await expect(page.locator('#network-detail')).toContainText('not confirmed');
  await page.getByText(/Reported directional bearings \(/).click();
  await expect(page.locator('.cell-record').first()).toBeVisible();
  const choices = page.locator('#sector-choices button');
  await expect(choices.first()).toBeVisible();
  await choices.first().click();
  await expect(page.locator('#sector-choices button[aria-pressed="true"]')).toHaveCount(1);
  await expect(page.locator('#sector-info')).toContainText('calculated');
  await page.getByLabel('Assumed EIRP (dBm)').fill('100');
  await expect(page.locator('#coverage-status')).toContainText('Enter EIRP 0–90');
  await page.getByLabel('Assumed EIRP (dBm)').fill('46');
  await expect(page.locator('#coverage-status')).toContainText('bearing estimates');
  await page.getByLabel('Fan intensity (relative)').fill('75');
  await expect(page.locator('#fan-intensity-value')).toHaveText('75%');
});

test('keyboard can open settings and change a layer', async ({ page }) => {
  await page.getByRole('button', { name: 'Close network view' }).click();
  const summary = page.locator('summary').filter({ hasText: 'Map Settings' });
  await summary.focus();
  await page.keyboard.press('Enter');
  const terrain = page.locator('#terrain-toggle');
  await expect(terrain).toBeChecked();
  await terrain.focus();
  await page.keyboard.press('Space');
  await expect(terrain).not.toBeChecked();
  await expect(terrain).toBeFocused();
});

test('network data failure gives a retry path', async ({ page }) => {
  await page.route('**/bell-outdoor-sites.geojson*', route => route.fulfill({ status: 503 }));
  await page.reload();
  await expect(page.locator('#network-status')).toContainText('Network data unavailable', { timeout: 20000 });
  await page.unroute('**/bell-outdoor-sites.geojson*');
  await page.getByText('Network', { exact: true }).click();
  await page.getByLabel('Bell outdoor').uncheck();
  await page.getByLabel('Bell outdoor').check();
  await expect(page.locator('#network-status')).toContainText('In view:', { timeout: 20000 });
});

test('search results remain clickable above the network panel on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.route('https://photon.komoot.io/api/**', route => route.fulfill({
    json: { features: [{ geometry: { type: 'Point', coordinates: [-79.387, 43.643] }, properties: { name: 'CN Tower' } }] },
  }));
  const query = page.getByRole('searchbox', { name: 'Search locations' });
  await query.fill('CN Tower');
  await query.press('Enter');
  await page.getByRole('button', { name: 'CN Tower', exact: true }).click();
  await expect(query).toHaveValue('CN Tower');
  await expect(page.locator('#search-results')).toBeHidden();
});

test('open controls pass automated WCAG A and AA checks', async ({ page }) => {
  await expect(page.locator('#network-status')).toContainText('In view:', { timeout: 20000 });
  await page.getByText('Network', { exact: true }).click();
  await page.getByText('Map Settings', { exact: true }).click();
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(node => node.target) }))).toEqual([]);
});

for (const width of [320, 390, 768, 1440]) {
  test(`network panel and camera controls do not overlap at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('#network-status')).toContainText('In view:', { timeout: 20000 });
    const panel = page.locator('#network-panel');
    const controls = page.getByRole('navigation', { name: 'Camera controls' });
    const a = await panel.boundingBox(), b = await controls.boundingBox();
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBeTruthy();
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(width);
    await page.getByLabel('Find a licensed site').fill('5205 Timberlea Boulevard');
    await page.locator('#network-list button').first().click();
    await expect(page.locator('#network-detail')).toContainText('Bell Mobility');
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  });
}

for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`controls remain in view at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await expect(page.locator('#network-status')).toContainText('In view:', { timeout: 20000 });
    const controls = page.getByRole('navigation', { name: 'Camera controls' });
    const box = await controls.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.getByLabel('Find a licensed site').fill('5205 Timberlea Boulevard');
    await page.locator('#network-list button').first().click();
    await expect(page.locator('#network-detail')).toContainText('Bell Mobility');
  });
}
