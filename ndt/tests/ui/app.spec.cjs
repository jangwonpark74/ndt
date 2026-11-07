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

test('site markers retain indoor locations and require outdoor fans', async ({ page }) => {
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('const map = new maplibregl.Map', 'const map = window.testMap = new maplibregl.Map');
    await route.fulfill({ response, body });
  });
  await page.reload();
  await expect(page.locator('#network-status')).toContainText('In view:', { timeout: 20000 });
  const markers = () => page.evaluate(() => window.testMap.getSource('network-sites')._data.features.map(f=>f.properties));
  const fans = await page.evaluate(() => window.testMap.getSource('network-sector-fans')._data.features.map(f=>f.properties.site_id));
  const initial = await markers();
  expect(initial.some(p=>p.site_class === 'indoor')).toBe(true);
  expect(initial.some(p=>p.site_class === 'bell')).toBe(true);
  expect(initial.filter(p=>p.site_class === 'bell').every(p=>fans.includes(p.site_id))).toBe(true);
  await page.getByLabel('Assumed EIRP (dBm)').fill('100');
  const invalid = await markers();
  expect(invalid.some(p=>p.site_class === 'indoor')).toBe(true);
  expect(invalid.some(p=>p.site_class === 'bell')).toBe(false);
  await page.getByLabel('Assumed EIRP (dBm)').fill('46');
  expect((await markers()).filter(p=>p.site_class === 'bell').length).toBe(initial.filter(p=>p.site_class === 'bell').length);
});

test('switch regions and inspect Verizon reservations without Toronto data', async ({ page }) => {
  await expect(page.locator('#network-status')).toContainText('In view:', { timeout: 20000 });
  await page.getByRole('button', {name:'New York City region'}).click();
  await expect(page.locator('#nyc-status')).toContainText('701 in the NYC snapshot', { timeout: 20000 });
  await expect(page.getByRole('complementary', {name:'Network infrastructure'})).toBeHidden();
  await expect(page.getByRole('complementary', {name:'Verizon pole reservations'})).toBeVisible();
  await expect(page.getByRole('button', {name:'New York City region'})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByLabel('Reset camera to New York City overview')).toBeVisible();
  const accessibility = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByLabel('Find a reservation').fill('24272');
  await expect(page.locator('#nyc-list button')).toHaveCount(1);
  await page.locator('#nyc-list button').click();
  await expect(page.locator('#nyc-detail')).toContainText('Installed');
  await expect(page.locator('#nyc-detail')).toContainText('49 STREET');
  await page.getByRole('button', {name:'Manhattan', exact:true}).click();
  await expect(page.locator('#coordinates')).toContainText('40.7484', {timeout:10000});
  await page.getByRole('button', {name:'Toronto region'}).click();
  await expect(page.locator('#network-status')).toContainText('In view:', { timeout: 20000 });
  await expect(page.getByRole('complementary', {name:'Verizon pole reservations'})).toBeHidden();
});

test('proposed reservations are searchable but do not render as markers', async ({ page }) => {
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('const map = new maplibregl.Map', 'const map = window.testMap = new maplibregl.Map');
    await route.fulfill({response, body});
  });
  await page.goto('/?region=new-york');
  await expect(page.locator('#nyc-status')).toContainText('701 in the NYC snapshot', {timeout:20000});
  await expect.poll(() => page.evaluate(() => [...new Set(window.testMap.queryRenderedFeatures({layers:['nyc-reservations']}).map(f=>f.properties.status))].sort())).toEqual(['Approved','Installed']);
  await page.getByLabel('Find a reservation').fill('Proposed');
  await expect(page.locator('#nyc-list-status')).toContainText('190 matching reservations');
  await expect(page.locator('#nyc-list button').first()).toContainText('Proposed');
});

test('New York controls remain reachable on a phone', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button', {name:'New York City region'}).click();
  await expect(page.locator('#nyc-status')).toContainText('701 in the NYC snapshot', {timeout:20000});
  const panel = await page.locator('#nyc-panel').boundingBox();
  const controls = await page.getByRole('navigation', {name:'Camera controls'}).boundingBox();
  expect(panel.y + panel.height).toBeLessThanOrEqual(controls.y);
  await page.getByRole('button', {name:'Close Verizon reservations'}).click();
  await expect(page.locator('#nyc-panel')).toBeHidden();
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

test('tree manifest failure can be retried by toggling trees', async ({ page }) => {
  let requests = 0;
  await page.route('**/trees/manifest.json', route => {
    requests++;
    return requests === 1 ? route.fulfill({ status: 503 }) : route.continue();
  });
  await page.getByRole('button', { name: 'Harbourfront' }).click();
  await expect(page.locator('#tree-status')).toContainText('Tree data unavailable.', { timeout: 20000 });
  await page.getByText('Map Settings', { exact: true }).click();
  await expect(page.locator('#tree-status')).toBeVisible();
  await expect(page.locator('#tree-status')).toContainText('Turn Trees off and on to retry.');
  const trees = page.locator('#trees-toggle');
  await trees.uncheck();
  await trees.check();
  await expect.poll(() => requests).toBe(2);
  await expect(page.locator('#tree-status')).toContainText('mapped and row trees in view.', { timeout: 20000 });
  await expect(page.locator('#tree-status')).toBeHidden();
});

test('roof data failure can be retried by toggling buildings', async ({ page }) => {
  let requests = 0;
  await page.route('**/toronto-roofs.json', route => {
    requests++;
    return requests === 1 ? route.fulfill({ status: 503 }) : route.continue();
  });
  await page.getByRole('button', { name: 'Harbourfront' }).click();
  await expect(page.locator('#roof-status')).toContainText('Roof data unavailable', { timeout: 20000 });
  await page.getByText('Map Settings', { exact: true }).click();
  await expect(page.locator('#roof-status')).toBeVisible();
  await expect(page.locator('#roof-status')).toContainText('Turn Buildings off and on to retry.');
  const buildings = page.locator('#buildings-toggle');
  await buildings.uncheck();
  await buildings.check();
  await expect.poll(() => requests).toBe(2);
  await expect(page.locator('#roof-status')).toContainText('mapped roofs in this view.', { timeout: 20000 });
  await expect(page.locator('#roof-status')).toBeHidden();
});

test('unavailable terrain is reported and cleared when terrain is disabled', async ({ page }) => {
  test.setTimeout(70000);
  await page.getByText('Map Settings', { exact: true }).click();
  const status = page.locator('#terrain-status');
  await page.evaluate(() => {
    const fire = maplibregl.Map.prototype.fire;
    maplibregl.Map.prototype.fire = function(event, ...args) {
      return event.type === 'error' && event.sourceId === 'terrain-dem' ? this : fire.call(this, event, ...args);
    };
    maplibregl.Map.prototype.queryTerrainElevation = () => null;
  });
  await page.locator('#terrain-toggle').uncheck();
  await page.locator('#terrain-toggle').check();
  await expect(status).toContainText('Terrain tiles are unavailable or still loading.', { timeout: 25000 });
  await expect(status).toBeVisible();
  await page.evaluate(() => { maplibregl.Map.prototype.queryTerrainElevation = () => 100; });
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(status).toContainText('Terrain elevation near map center: 100 m.');
  await expect(status).toBeHidden();
  await page.evaluate(() => { maplibregl.Map.prototype.queryTerrainElevation = () => null; });
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(status).toBeVisible({ timeout: 25000 });
  await page.locator('#terrain-toggle').uncheck();
  await expect(status).toBeHidden();
});

test('failed terrain tile requests are reported even when the map returns zero elevation', async ({ page }) => {
  await page.getByText('Map Settings', { exact: true }).click();
  const status = page.locator('#terrain-status');
  await expect(status).toContainText('Some terrain tiles could not be loaded.', { timeout: 15000 });
  await expect(status).toBeVisible();
  await page.locator('#terrain-toggle').uncheck();
  await expect(status).toBeHidden();
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
