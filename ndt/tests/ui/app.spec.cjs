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

test('dismissing a pending location search keeps its results closed', async ({ page }) => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  let started;
  const requestStarted = new Promise(resolve => { started = resolve; });
  await page.route('https://photon.komoot.io/api/**', async route => {
    started();
    await wait;
    await route.fulfill({json:{features:[]}}).catch(() => {});
  });
  const query = page.getByRole('searchbox', {name:'Search locations'});
  await query.fill('Toronto');
  await query.press('Enter');
  await requestStarted;
  await expect(page.locator('#search-status')).toHaveText('Searching…');
  await query.press('Escape');
  await expect(page.locator('#search-results')).toBeHidden();
  await expect(page.locator('#location-search button[type="submit"]')).toBeEnabled();
  release();
  await expect(page.locator('#search-results')).toBeHidden();
});

test('network and map controls expose usable states', async ({ page }) => {
  const network = page.getByRole('region', { name: 'Network infrastructure' });
  await expect(network).toBeVisible();
  await expect(page.locator('#network-status')).toContainText('In view:', { timeout: 20000 });
  await page.getByRole('button', { name: 'Close network view' }).click();
  await expect(network).toBeHidden();
  await page.locator('.network-settings > summary').click();
  const telus = page.getByLabel('TELUS sites');
  await expect(telus).toBeChecked();
  await expect(network).toBeVisible();
  await page.getByText('Map Settings', { exact: true }).click();
  const buildings = page.getByLabel('Buildings');
  await expect(buildings).toBeChecked();
  await buildings.uncheck();
  await expect(buildings).not.toBeChecked();
  await buildings.check();
  await expect(buildings).toBeChecked();
});

test('closing network details preserves visible sites, fans and the selected bearing', async ({page})=>{
  await page.route('**/app.js*',async route=>{
    const response = await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace('const map = new maplibregl.Map','const map = window.testMap = new maplibregl.Map')});
  });
  await page.reload();
  await expect(page.locator('#network-status')).toContainText('In view:',{timeout:20000});
  await page.getByLabel('Find a licensed site').fill('5205 Timberlea Boulevard');
  await page.locator('#network-list button').first().click();
  await expect(page.locator('#network-detail')).toContainText('5205 Timberlea Boulevard');
  await page.locator('#sector-choices button').first().click();
  const snapshot = () => page.evaluate(()=>{
    const map=window.testMap;
    return {markers:map.getSource('network-sites')._data.features.length,
      fans:map.getSource('network-sector-fans')._data.features.length,
      selected:map.getSource('network-site-fans-selected')._data.features,
      bearing:map.getSource('network-sector-selected')._data.features,
      markerVisibility:map.getLayoutProperty('network-sites','visibility'),
      fanVisibility:map.getLayoutProperty('network-sector-fans','visibility')};
  });
  const before=await snapshot();
  expect(before.markers).toBeGreaterThan(0); expect(before.fans).toBeGreaterThan(0);
  expect(before.selected.length).toBeGreaterThan(0); expect(before.bearing).toHaveLength(1);
  await page.getByRole('button',{name:'Close network view'}).click();
  await expect(page.locator('#network-panel')).toBeHidden();
  expect(await snapshot()).toEqual(before);
  await page.evaluate(siteId=>{
    const map=window.testMap, original=map.queryRenderedFeatures;
    map.queryRenderedFeatures=()=>[{properties:{site_id:siteId},layer:{id:'network-sites'}}];
    map.fire('click',{point:{x:100,y:100},lngLat:{lng:-79.4,lat:43.7}});
    map.queryRenderedFeatures=original;
  },before.selected[0].properties.site_id);
  await expect(page.locator('#network-panel')).toBeVisible();
  await expect(page.locator('#network-detail')).toContainText('5205 Timberlea Boulevard');
  await page.getByRole('button',{name:'Close network view'}).click();
  await page.locator('.network-settings > summary').click();
  await expect(page.locator('#network-panel')).toBeVisible();
  await expect(page.getByLabel('TELUS sites')).toBeChecked();
  await expect(page.getByLabel('Bell outdoor')).toBeChecked();
  await page.getByLabel('TELUS sites').uncheck();
  await page.getByLabel('Bell outdoor').uncheck();
  await expect(page.locator('#network-panel')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>window.testMap.getLayoutProperty('network-sites','visibility'))).toBe('none');
});

test('region catalog failure exposes reload recovery', async ({ page }) => {
  await page.route('**/api/regions', route => route.fulfill({status:503}));
  await page.reload();
  await expect(page.locator('#error')).toContainText('regional data service is unavailable');
  await page.unroute('**/api/regions');
  await page.locator('#retry').click();
  await expect(page.locator('#error')).toBeHidden({timeout:20000});
  await expect(page.locator('#network-status')).toContainText('In view:', {timeout:20000});
});

test('map feature selection presents the building marker and clears it', async ({ page }) => {
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace('const map = new maplibregl.Map','const map = window.testMap = new maplibregl.Map')});
  });
  await page.route('**/map-scene-view.mjs', async route => {
    const response = await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace('markerLayer = createMarkerLayer();','markerLayer = window.testMarker = createMarkerLayer();')});
  });
  await page.reload();
  await expect(page.locator('#network-status')).toContainText('In view:', {timeout:20000});
  await page.getByRole('button',{name:'Close network view'}).click();
  const calls = await page.evaluate(() => {
    const map = window.testMap, layer = window.testMarker, originalSet = layer.setLocation, originalQuery = map.queryRenderedFeatures;
    const calls = [];
    layer.setLocation = function(location,height) {calls.push({location,height}); return originalSet.call(this,location,height);};
    map.queryRenderedFeatures = () => [
      {source:'openmaptiles',sourceLayer:'transportation',properties:{}},
      {source:'openmaptiles',sourceLayer:'building',properties:{render_height:42}},
    ];
    map.fire('click',{point:{x:100,y:100},lngLat:{lng:-79.4,lat:43.7}});
    map.queryRenderedFeatures = () => [];
    map.fire('click',{point:{x:100,y:100},lngLat:{lng:-79.4,lat:43.7}});
    map.queryRenderedFeatures = originalQuery; layer.setLocation = originalSet;
    return calls;
  });
  expect(calls).toEqual([{location:{lng:-79.4,lat:43.7},height:42},{location:null,height:0}]);
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
  await page.getByLabel('REGION').selectOption('new-york');
  await expect(page.locator('#nyc-status')).toContainText('701 in the NYC snapshot', { timeout: 20000 });
  await expect(page.getByRole('region', {name:'Network infrastructure'})).toBeHidden();
  await expect(page.getByRole('region', {name:'Verizon pole reservations'})).toBeVisible();
  await expect(page.getByLabel('REGION')).toHaveValue('new-york');
  await expect(page.getByLabel('Reset camera to New York City overview')).toBeVisible();
  const accessibility = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByLabel('Find a reservation').fill('24272');
  await expect(page.locator('#nyc-list button')).toHaveCount(1);
  await page.locator('#nyc-list button').click();
  await expect(page.locator('#nyc-detail')).toContainText('Installed');
  await expect(page.locator('#nyc-detail')).toContainText('49 STREET');
  await page.getByRole('combobox',{name:'Project',exact:true}).selectOption({label:'Manhattan'});
  await expect(page.locator('#coordinates')).toContainText('40.7484', {timeout:10000});
  await page.getByLabel('REGION').selectOption('toronto');
  await expect(page.locator('#network-status')).toContainText('In view:', { timeout: 20000 });
  await expect(page.getByRole('region', {name:'Verizon pole reservations'})).toBeHidden();
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

test('New York reservation data failure can be retried', async ({ page }) => {
  await page.route('**/verizon-poles.geojson', route => route.fulfill({status:503}));
  await page.goto('/?region=new-york');
  await expect(page.locator('#nyc-status')).toContainText('Reservation data unavailable', {timeout:20000});
  await page.unroute('**/verizon-poles.geojson');
  await page.getByText('Verizon reservations', {exact:true}).first().click();
  const toggle = page.getByRole('checkbox', {name:'Pole reservations'});
  await toggle.uncheck();
  await toggle.check();
  await expect(page.locator('#nyc-status')).toContainText('701 in the NYC snapshot', {timeout:20000});
});

test('Toronto projects outline seven full-radius sites and react to invalid assumptions', async ({ page }) => {
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('const map = new maplibregl.Map', 'const map = window.testMap = new maplibregl.Map');
    await route.fulfill({response, body});
  });
  await page.reload();
  await expect(page.locator('#network-status')).toContainText('In view:', {timeout:20000});
  const snapshot = () => page.evaluate(() => ({boundary:window.testMap.getSource('project-coverage')._data, sites:window.testMap.getSource('project-sites')._data}));
  await expect.poll(async () => (await snapshot()).boundary.features.length).toBe(4);
  expect((await snapshot()).boundary.features.map(f=>f.properties.project_id).sort()).toEqual(['etobicoke','harbourfront','northyork','scarborough']);
  await page.getByRole('combobox',{name:'Project',exact:true}).selectOption({label:'Harbourfront'});
  await expect(page.locator('#project-status')).toContainText('7 Bell locations');
  await expect(page.locator('#project-sites li')).toHaveCount(7);
  await expect.poll(async () => (await snapshot()).sites.features.length).toBe(7);
  await expect.poll(() => page.evaluate(() => !window.testMap.isMoving()),{timeout:15000}).toBe(true);
  const initial = await snapshot();
  expect(initial.boundary.features).toHaveLength(4);
  expect(initial.boundary.features.every(f=>f.geometry.type === 'Polygon' && f.geometry.coordinates.length === 1)).toBe(true);
  expect(await page.evaluate(() => window.testMap.getPaintProperty('project-boundary','line-width'))).toBe(4);
  expect(await page.evaluate(() => window.testMap.getPaintProperty('project-boundary','line-dasharray'))).toEqual([2,2]);
  expect(await page.evaluate(() => window.testMap.getLayoutProperty('project-boundary','line-cap'))).toBe('round');
  expect(initial.sites.features).toHaveLength(7);
  await page.locator('.network-settings > summary').click();
  await page.getByLabel('Assumed EIRP (dBm)').fill('100');
  await expect(page.locator('#project-status')).toContainText('Boundary unavailable');
  expect((await snapshot()).boundary.features).toHaveLength(0);
  expect((await snapshot()).sites.features).toHaveLength(7);
  await page.getByLabel('Assumed EIRP (dBm)').fill('46');
  await expect(page.locator('#project-status')).toContainText('7 Bell locations');
  expect((await snapshot()).boundary.features).toHaveLength(4);
  expect((await snapshot()).sites.features.map(f=>f.properties.site_id)).toEqual(initial.sites.features.map(f=>f.properties.site_id));
  await page.getByRole('combobox',{name:'Project',exact:true}).selectOption({label:'North York'});
  await expect(page.locator('#project-title')).toHaveText('North York');
  expect((await snapshot()).boundary.features).toHaveLength(4);
});

test('New York projects disclose missing radio parameters', async ({ page }) => {
  await page.goto('/?region=new-york');
  await expect(page.locator('#nyc-status')).toContainText('701 in the NYC snapshot', {timeout:20000});
  await expect(page.locator('#project-picker option')).toHaveText(['Select a project','Manhattan','Brooklyn','Queens','The Bronx','Staten Island']);
  await page.getByRole('combobox',{name:'Project',exact:true}).selectOption({label:'Manhattan'});
  await expect(page.locator('#project-status')).toContainText('Coverage boundary unavailable');
  await expect(page.locator('#project-sites li')).toHaveCount(0);
});

test('right-click removes and restores a project site, including after reload', async ({ page }) => {
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({response, body:(await response.text()).replace('const map = new maplibregl.Map', 'const map = window.testMap = new maplibregl.Map')});
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.testMap?.getSource('project-coverage')?._data.features.length)).toBe(4);
  await page.getByRole('combobox',{name:'Project',exact:true}).selectOption({label:'Harbourfront'});
  await expect(page.locator('#project-sites li')).toHaveCount(7);
  await expect.poll(() => page.evaluate(() => window.testMap.getSource('project-sites')._data.features.length)).toBe(7);
  const initial = await page.evaluate(() => window.testMap.getSource('project-sites')._data.features.map(f=>({id:f.properties.site_id,coordinates:f.geometry.coordinates})));
  expect(initial).toHaveLength(7);
  const site = await page.evaluate(async ids => {
    const [{projectCoverage}, {RADIO_DEFAULTS}, response] = await Promise.all([
      import('/project-coverage.mjs?v=cluster-2'),import('/radio-model.mjs'),fetch('/api/regions/toronto/assets/bell-outdoor-sites.geojson'),
    ]);
    const sites = (await response.json()).features.filter(f=>ids.includes(f.properties.site_id));
    const original = JSON.stringify(projectCoverage(sites,RADIO_DEFAULTS).geometry);
    const chosen = sites.find(site=>JSON.stringify(projectCoverage(sites.filter(item=>item !== site),RADIO_DEFAULTS).geometry) !== original);
    return {id:chosen.properties.site_id,coordinates:chosen.geometry.coordinates};
  },initial.map(item=>item.id));
  const boundary = () => page.evaluate(() => window.testMap.getSource('project-coverage')._data.features.find(f=>f.properties.project_id === 'harbourfront').geometry);
  const endpoint = '/api/regions/toronto/projects/harbourfront/sites';
  let releaseSave;
  async function rightClickSite() {
    await page.evaluate(coordinates=>window.testMap.jumpTo({center:coordinates,zoom:16,pitch:0,bearing:0}),site.coordinates);
    await expect.poll(() => page.evaluate(id=>window.testMap.queryRenderedFeatures(window.testMap.project(window.testMap.getCenter()),{layers:['project-site-markers','network-sites']}).some(f=>f.properties.site_id === id),site.id)).toBe(true);
    const point = await page.evaluate(coordinates=>window.testMap.project(coordinates),site.coordinates);
    await page.mouse.click(point.x,point.y,{button:'right'});
  }
  try {
    await rightClickSite();
    await page.route(`**${endpoint}`, route=>route.fulfill({status:503}));
    await page.getByRole('button',{name:'Remove site from project'}).click();
    await expect(page.getByRole('button',{name:'Save failed. Try again'})).toBeVisible();
    await expect(page.locator('#project-sites li')).toHaveCount(7);
    const originalBoundary = await boundary();
    await page.unroute(`**${endpoint}`);
    await page.route(`**${endpoint}`, async route => {
      const proceed = await new Promise(resolve=>{ releaseSave = resolve; });
      if (proceed) await route.continue(); else await route.fulfill({status:503});
    });
    await page.getByRole('button',{name:'Save failed. Try again'}).click();
    await expect.poll(() => Boolean(releaseSave)).toBe(true);
    await expect(page.locator('#project-sites li')).toHaveCount(7);
    expect(await boundary()).toEqual(originalBoundary);
    releaseSave(true); releaseSave = null;
    await expect(page.locator('.project-site-menu')).toHaveCount(0);
    await page.unroute(`**${endpoint}`);
    await expect(page.locator('#project-sites li')).toHaveCount(6);
    await expect(page.locator('#project-status')).toContainText('Original planning target: 7 sites');
    await expect.poll(boundary).not.toEqual(originalBoundary);
    let saved = await (await page.request.get('/api/regions/toronto/projects')).json();
    expect(saved.harbourfront).not.toContain(site.id);
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.testMap?.getSource('project-coverage')?._data.features.length)).toBe(4);
    await page.getByRole('combobox',{name:'Project',exact:true}).selectOption({label:'Harbourfront'});
    await expect(page.locator('#project-sites li')).toHaveCount(6);
    await rightClickSite();
    await page.getByRole('button',{name:'Add site to project'}).click();
    await expect(page.locator('#project-sites li')).toHaveCount(7);
    await expect.poll(boundary).toEqual(originalBoundary);
    await expect(page.locator('.project-site-menu')).toHaveCount(0);
    saved = await (await page.request.get('/api/regions/toronto/projects')).json();
    expect(saved.harbourfront).toContain(site.id);
    expect((await page.request.put(endpoint,{data:['not-a-site']})).status()).toBe(400);
    expect((await page.request.put(endpoint,{data:[site.id,site.id]})).status()).toBe(400);
  } finally {
    releaseSave?.(false);
    await page.unroute(`**${endpoint}`);
    await page.request.put(endpoint,{data:initial.map(item=>item.id)});
  }
});

for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568}]) {
  test(`project selection fits the boundary in the visible map at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/app.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({response, body:(await response.text()).replace('const map = new maplibregl.Map', 'const map = window.testMap = new maplibregl.Map')});
    });
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.testMap?.getSource('project-coverage')?._data.features.length)).toBe(4);
    for (const [name,id] of [['Harbourfront','harbourfront'],['Etobicoke','etobicoke'],['North York','northyork'],['Scarborough','scarborough']]) {
      if (viewport.width <= 700) await page.getByRole('button',{name:'Open map navigation'}).click();
      await page.getByRole('combobox',{name:'Project',exact:true}).selectOption({label:name});
      await expect(page.locator('#project-title')).toHaveText(name);
      await expect(page.locator('#task-panel')).toBeVisible();
      await expect(page.locator('#map-navigation #task-panel')).toHaveCount(0);
      await expect.poll(() => page.evaluate(id => {
        const map = window.testMap, boundary = map.getSource('project-coverage')._data.features.find(feature=>feature.properties.project_id === id);
        if (!boundary || map.isMoving()) return false;
        const sidebar = document.querySelector('.intro').getBoundingClientRect();
        const panel = document.querySelector('#context-panel').getBoundingClientRect();
        const controls = document.querySelector('.map-controls').getBoundingClientRect();
        const mobile = innerWidth <= 700;
        const right = mobile ? innerWidth : Math.min(controls.left,panel.left);
        const top = mobile ? panel.bottom : 76;
        const projected = boundary.geometry.coordinates[0].map(point=>map.project(point));
        const xs = projected.map(p=>p.x), ys = projected.map(p=>p.y);
        return Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)) > 70 && projected.every(p=>
          p.x >= (mobile ? 0 : sidebar.right) && p.x <= right && p.y >= top && p.y <= (mobile ? controls.top : innerHeight));
      },id), {timeout:15000}).toBe(true);
    }
    if (viewport.width <= 700) {
      await expect(page.locator('#network-panel')).toBeHidden();
      await page.getByRole('button',{name:'Open map navigation'}).click();
      await page.locator('.network-settings > summary').click();
      await expect(page.locator('#network-panel')).toBeVisible();
    }
  });
}

test('New York controls remain reachable on a phone', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Open map navigation'}).click();
  await page.getByLabel('REGION').selectOption('new-york');
  await expect(page.locator('#nyc-status')).toContainText('701 in the NYC snapshot', {timeout:20000});
  const panel = await page.locator('#context-panel').boundingBox();
  const controls = await page.getByRole('navigation', {name:'Camera controls'}).boundingBox();
  expect(panel.y + panel.height).toBeLessThanOrEqual(controls.y);
  await page.getByRole('button', {name:'Close Verizon reservations'}).click();
  await expect(page.locator('#nyc-panel')).toBeHidden();
});

test('project tasks and separate overview preserve map state',async ({page})=>{
  await page.route('**/app.js*',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace('const map = new maplibregl.Map','const map = window.testMap = new maplibregl.Map')});
  });
  await page.reload();
  await expect.poll(()=>page.evaluate(()=>window.testMap?.getSource('project-coverage')?._data.features.length)).toBe(4);
  await expect(page.locator('#project-picker option')).toHaveText(['Select a project','Harbourfront','Etobicoke','North York','Scarborough']);
  await expect(page.locator('#project-tab')).toBeDisabled();
  await page.getByRole('combobox',{name:'Project',exact:true}).selectOption({label:'North York'});
  const panel=page.getByRole('region',{name:'Project tasks'});
  await expect(panel).toBeVisible();
  await expect(page.locator('#context-panel .context-close')).toHaveCount(1);
  await expect(page.locator('#project-tab')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#project-status')).toContainText('Bell locations');
  await expect(page.locator('#project-sites li')).toHaveCount(7);
  expect((await panel.boundingBox()).x).toBeGreaterThan(700);
  await expect(page.getByRole('button',{name:'Region overview',exact:true})).toHaveCount(0);
  const accessibility=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  const snapshot=()=>page.evaluate(()=>({boundaries:window.testMap.getSource('project-coverage')._data,sites:window.testMap.getSource('project-sites')._data}));
  const before=await snapshot();
  await page.getByRole('button',{name:'Close project tasks'}).click();
  await expect(panel).toBeHidden();
  expect(await snapshot()).toEqual(before);
  await page.getByRole('button',{name:/Active project North York Overview/}).click();
  await expect(page.locator('#project-overview')).toBeVisible();
  await expect(panel).toBeHidden();
  await page.getByRole('button',{name:'Back to map'}).click();
  await page.locator('.network-settings > summary').click();
  await expect(panel).toBeHidden();
  await expect(page.locator('#network-panel')).toBeVisible();
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await expect(page.locator('#network-panel')).toBeHidden();
  await expect(page.locator('#project-sites li')).toHaveCount(7);
});

test('closing reservation details keeps markers and allows reopening',async ({page})=>{
  await page.route('**/app.js*',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace('const map = new maplibregl.Map','const map = window.testMap = new maplibregl.Map')});
  });
  await page.goto('/?region=new-york');
  await expect(page.locator('#nyc-status')).toContainText('701 in the NYC snapshot',{timeout:20000});
  await page.getByRole('button',{name:'Close Verizon reservations'}).click();
  await expect(page.locator('#nyc-panel')).toBeHidden();
  const visible=await page.evaluate(()=>window.testMap.getLayoutProperty('nyc-reservations','visibility'));
  expect(visible).not.toBe('none');
  await page.evaluate(()=>{
    const map=window.testMap, feature=map.getSource('nyc-reservations')._data.features.find(f=>f.properties.status !== 'Proposed');
    const original=map.queryRenderedFeatures;
    map.queryRenderedFeatures=()=>[{properties:{id:feature.properties.id},layer:{id:'nyc-reservations'}}];
    map.fire('click',{point:{x:100,y:100},lngLat:{lng:-74,lat:40.7}});
    map.queryRenderedFeatures=original;
  });
  await expect(page.locator('#nyc-detail')).toContainText('reservation');
  await expect(page.locator('#nyc-panel')).toBeVisible();
  await page.getByRole('button',{name:'Close Verizon reservations'}).click();
  await page.getByText('Verizon reservations',{exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Pole reservations',exact:true})).toBeChecked();
  await expect(page.locator('#nyc-panel')).toBeVisible();
  await expect(page.locator('#nyc-detail')).toContainText('reservation');
  await page.getByRole('checkbox',{name:'Pole reservations',exact:true}).uncheck();
  await expect(page.locator('#nyc-panel')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>window.testMap.getLayoutProperty('nyc-reservations','visibility'))).toBe('none');
});

test('mobile navigation and camera controls remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Close network view' }).click();
  const navigation = page.locator('#map-navigation');
  const controls = page.getByRole('navigation', { name: 'Camera controls' });
  const toggle = page.locator('#navigation-toggle');
  await expect(navigation).toBeHidden();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(navigation).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await page.keyboard.press('Escape');
  await expect(navigation).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await expect(controls).toBeVisible();
  await page.getByRole('combobox',{name:'Project',exact:true}).selectOption({label:'Harbourfront'});
  await expect(navigation).toBeHidden();
  await expect(page.locator('#project-status')).toContainText('7 Bell locations', { timeout: 10000 });
  await expect(page.locator('#task-panel')).toBeVisible();
  await page.getByRole('button',{name:'Close project tasks'}).click();
  const project = page.getByRole('button',{name:/Active project Harbourfront Overview/});
  await expect(project).toBeVisible();
  await project.click();
  await expect(navigation).toBeHidden();
  await expect(page.locator('#project-overview')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#task-panel')).toBeHidden();
  await expect(page.getByRole('button',{name:'Open map navigation'})).toBeFocused();
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
  await page.locator('.network-settings > summary').click();
  await page.getByLabel('Bell outdoor').uncheck();
  await page.getByLabel('Bell outdoor').check();
  await expect(page.locator('#network-status')).toContainText('In view:', { timeout: 20000 });
});

test('tree manifest failure can be retried by toggling trees', async ({ page }) => {
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({response, body:(await response.text()).replace('const map = new maplibregl.Map', 'const map = window.testMap = new maplibregl.Map')});
  });
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden({timeout:20000});
  let requests = 0;
  await page.route('**/trees/manifest.json', route => {
    requests++;
    return requests === 1 ? route.fulfill({ status: 503 }) : route.continue();
  });
  await page.evaluate(() => { window.testMap.jumpTo({center:[-79.3922155,43.6394193],zoom:17,pitch:58}); window.testMap.fire('idle'); });
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
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({response, body:(await response.text()).replace('const map = new maplibregl.Map', 'const map = window.testMap = new maplibregl.Map')});
  });
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden({timeout:20000});
  let requests = 0;
  await page.route('**/toronto-roofs.json', route => {
    requests++;
    return requests === 1 ? route.fulfill({ status: 503 }) : route.continue();
  });
  await page.evaluate(() => { window.testMap.jumpTo({center:[-79.3922155,43.6394193],zoom:17,pitch:58}); window.testMap.fire('idle'); });
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
  await page.locator('.network-settings > summary').click();
  await page.getByText('Map Settings', { exact: true }).click();
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(node => node.target) }))).toEqual([]);
});

for (const width of [320, 390, 768, 1440]) {
  test(`network panel and camera controls do not overlap at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('#network-status')).toContainText('In view:', { timeout: 20000 });
    const panel = page.locator('#context-panel');
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
