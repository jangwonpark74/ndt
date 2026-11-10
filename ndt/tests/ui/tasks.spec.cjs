const {test,expect} = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const endpoint='/api/regions/toronto/projects/northyork/tasks';
test.beforeEach(async({page})=>{
  await page.route('**/api/road-route',route=>{const points=route.request().postDataJSON(); return route.fulfill({json:{coordinates:points}});});
  await page.route('https://tiles.openfreemap.org/styles/liberty',route=>route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#d5e1dc'}}]}}));
  await page.route('https://tiles.mapterhorn.com/**',route=>route.abort());
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('**/app.js*',async route=>{const response=await route.fetch(); await route.fulfill({response,body:(await response.text()).replace('const map = new maplibregl.Map','const map = window.testMap = new maplibregl.Map')});});
  await page.goto('/'); await expect(page.locator('#loading')).toBeHidden({timeout:20000});
});
async function select(page,name){
  if (await page.getByRole('button',{name:'Open map navigation'}).isVisible()) await page.getByRole('button',{name:'Open map navigation'}).click();
  await page.getByRole('combobox',{name:'Project',exact:true}).selectOption({label:name});
  await expect(page.locator('#task-new')).toBeEnabled();
}
const geojson={type:'FeatureCollection',features:[{type:'Feature',properties:{name:'Yonge Street'},geometry:{type:'LineString',coordinates:[[-79.412,43.761],[-79.414,43.77],[-79.416,43.78]]}}]};
async function upload(page,data=geojson){await page.locator('#route-import').setInputFiles({name:'route.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(data))});}

test('multiple tasks support drawing, import, connected endpoints, save recovery and reload',async({page})=>{
  const original=await (await page.request.get(endpoint)).json();
  try {
    await page.request.put(endpoint,{data:[]}); await select(page,'North York');
    await page.getByRole('button',{name:'New task',exact:true}).click();
    await page.getByLabel('Task ID',{exact:true}).fill('DT-101'); await page.getByLabel('Task name',{exact:true}).fill('Morning drive');
    await upload(page); await expect(page.locator('#task-routes')).toContainText('Yonge Street');
    await upload(page,{type:'Point',coordinates:[1,2]}); await expect(page.locator('#task-error')).toContainText('LineString'); await expect(page.locator('.route-card')).toHaveCount(1);
    await page.getByLabel('New route name').fill('Connector'); await page.getByRole('button',{name:'Draw on map'}).click();
    await page.mouse.click(550,450); await page.mouse.click(650,500);
    await expect(page.locator('#route-draw-status')).toContainText('2 waypoints');
    await page.getByRole('button',{name:'Finish route'}).click(); await expect(page.locator('.route-card')).toHaveCount(2);
    await page.getByRole('button',{name:'Save task',exact:true}).click(); await expect(page.locator('#task-save-state')).toHaveText('Saved');
    const features=await page.evaluate(()=>window.testMap.getSource('task-routes')._data.features);
    for (let i=0;i<features.length;i+=3) {expect(features[i+1].geometry.coordinates).toEqual(features[i].geometry.coordinates[0]); expect(features[i+2].geometry.coordinates).toEqual(features[i].geometry.coordinates.at(-1));}
    await page.getByRole('button',{name:'New task',exact:true}).click(); await page.getByLabel('Task ID',{exact:true}).fill('DT-102'); await page.getByLabel('Task name',{exact:true}).fill('Evening drive');
    await upload(page); await page.getByRole('button',{name:'Save task',exact:true}).click(); await expect(page.locator('#task-save-state')).toHaveText('Saved'); await expect(page.locator('#task-list button')).toHaveCount(2);
    await page.getByLabel('Task ID',{exact:true}).fill('DT-202');
    await page.route('**/projects/northyork/tasks',route=>route.request().method()==='PUT'?route.fulfill({status:503}):route.continue());
    await page.getByRole('button',{name:'Save task',exact:true}).click(); await expect(page.locator('#task-error')).toContainText('draft is still available');
    await page.unroute('**/projects/northyork/tasks'); await page.getByRole('button',{name:'Save task',exact:true}).click(); await expect(page.locator('#task-save-state')).toHaveText('Saved');
    await page.getByRole('button',{name:'Open project overview'}).click(); await expect(page.locator('#project-overview')).toBeVisible(); await expect(page.locator('#context-panel')).toBeHidden();
    await expect(page.locator('#overview-task-list')).toContainText('DT-202');
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:'/private/tmp/ndt-task-overview-desktop.png'});
    await page.getByRole('button',{name:'Back to map'}).click();
    await select(page,'Etobicoke'); await expect(page.locator('#task-list')).not.toContainText('DT-101');
    await page.reload(); await expect(page.locator('#loading')).toBeHidden(); await select(page,'North York'); await expect(page.locator('#task-list button')).toHaveCount(2);
    await page.getByRole('button',{name:'DT-101 · Morning drive',exact:true}).click(); await expect(page.locator('.route-card')).toHaveCount(2);
    await page.getByRole('button',{name:'Draw on map'}).click(); await page.mouse.click(600,450); await page.keyboard.press('Escape'); await expect(page.locator('#route-drawing')).toBeHidden(); await expect(page.locator('.route-card')).toHaveCount(2);
    page.once('dialog',dialog=>dialog.accept()); await page.getByRole('button',{name:'Delete task',exact:true}).click(); await expect(page.locator('#task-list button')).toHaveCount(1);
  } finally {await page.request.put(endpoint,{data:original});}
});

for (const viewport of [{width:390,height:844},{width:320,height:568}]) test(`task editor and full-page overview work at ${viewport.width}px`,async({page})=>{
  await page.setViewportSize(viewport); await select(page,'North York');
  await page.getByRole('button',{name:'New task',exact:true}).click(); await page.getByLabel('Task ID',{exact:true}).fill('PHONE'); await page.getByLabel('Task name',{exact:true}).fill('Phone route'); await upload(page);
  await page.getByRole('button',{name:'View route',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>!window.testMap.isMoving())).toBe(true);
  const geometry=await page.evaluate(()=>{
    const map=window.testMap, panel=document.querySelector('#context-panel').getBoundingClientRect(),controls=document.querySelector('.map-controls').getBoundingClientRect();
    return {panelBottom:panel.bottom,controlsTop:controls.top,points:map.getSource('task-routes')._data.features.find(f=>f.geometry.type==='LineString').geometry.coordinates.map(p=>map.project(p))};
  });
  expect(geometry.points.every(p=>p.y>geometry.panelBottom && p.y<geometry.controlsTop)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:`/private/tmp/ndt-task-editor-${viewport.width}.png`});
  await page.getByRole('button',{name:'Open project overview'}).click(); await expect(page.locator('#project-overview')).toBeFocused(); await expect(page.locator('#overview-task-status')).toContainText('Unsaved draft');
  await expect(page.locator('#project-status')).toContainText('Bell locations');
  const rect=await page.locator('#project-overview').boundingBox(); expect(rect.width).toBe(viewport.width); expect(rect.y+rect.height).toBe(viewport.height);
  await page.screenshot({path:`/private/tmp/ndt-task-overview-${viewport.width}.png`});
  await page.getByRole('button',{name:'Map task editor',exact:true}).click(); await expect(page.getByLabel('Task name',{exact:true})).toHaveValue('Phone route');
  await page.getByRole('button',{name:'Discard changes',exact:true}).click();
});

test('failed task loading cannot overwrite saved tasks and offers retry',async({page})=>{
  await page.route('**/projects/northyork/tasks',route=>route.fulfill({status:503})); await selectWithFailure();
  async function selectWithFailure(){await page.getByRole('combobox',{name:'Project',exact:true}).selectOption({label:'North York'}); await expect(page.locator('#tasks-retry')).toBeVisible();}
  await expect(page.locator('#task-new')).toBeDisabled(); await page.unroute('**/projects/northyork/tasks'); await page.getByRole('button',{name:'Retry loading tasks'}).click(); await expect(page.locator('#task-new')).toBeEnabled();
});

test('New York projects save task routes while keeping the RF limitation explicit',async({page})=>{
  const path='/api/regions/new-york/projects/manhattan/tasks';
  const original=await(await page.request.get(path)).json();
  try {
    await page.request.put(path,{data:[]});await page.goto('/?region=new-york');await expect(page.locator('#loading')).toBeHidden({timeout:20000});await select(page,'Manhattan');
    await page.getByRole('button',{name:'New task',exact:true}).click();await page.getByLabel('Task ID',{exact:true}).fill('NY-001');await page.getByLabel('Task name',{exact:true}).fill('Manhattan drive');
    await upload(page,{type:'MultiLineString',coordinates:[[[-73.99,40.75],[-73.98,40.76]],[[-73.98,40.76],[-73.97,40.77]]]});await expect(page.locator('.route-card')).toHaveCount(2);
    await expect(page.locator('.route-endpoint').filter({hasText:'Start / End'})).toHaveCount(1);
    await page.getByRole('button',{name:'Save task',exact:true}).click();await expect(page.locator('#task-save-state')).toHaveText('Saved');
    await page.getByRole('button',{name:'Open project overview'}).click();await expect(page.locator('#project-title')).toHaveText('Manhattan');await expect(page.locator('#project-status')).toContainText('Coverage boundary unavailable');await expect(page.locator('#overview-task-list')).toContainText('NY-001');
    expect((await(await page.request.get(path)).json())[0].routes).toHaveLength(2);
  } finally {await page.request.put(path,{data:original});}
});

test('road fitting updates geometry and connected endpoints, then preserves the original on service failure',async({page})=>{
  let unavailable=false;
  const fitted=[[-79.4121,43.7611],[-79.4122,43.765],[-79.4142,43.77],[-79.4161,43.7801]];
  await page.route('**/api/road-route',route=>unavailable ? route.fulfill({status:503,json:{error:'No connected driving route was found.'}}) : route.fulfill({json:{coordinates:fitted}}));
  await select(page,'North York');await page.getByRole('button',{name:'New task',exact:true}).click();await page.getByLabel('Task name',{exact:true}).fill('Road test');await upload(page);
  await expect(page.locator('.route-fit-status')).toContainText('Road fitted');
  const data=await page.evaluate(()=>window.testMap.getSource('task-routes')._data.features);
  expect(data[0].geometry.coordinates).toEqual(fitted);expect(data[0].properties.road_fitted).toBe(true);expect(data[1].geometry.coordinates).toEqual(fitted[0]);expect(data[2].geometry.coordinates).toEqual(fitted.at(-1));
  unavailable=true;await page.getByRole('button',{name:'Fit to roads',exact:true}).click();await expect(page.locator('.route-fit-status')).toContainText('previous fitted path is kept');
  expect(await page.evaluate(()=>window.testMap.getSource('task-routes')._data.features[0].geometry.coordinates)).toEqual(fitted);
  await upload(page);await expect(page.locator('.route-fit-status').last()).toContainText('Not fitted');
  const lines=await page.evaluate(()=>window.testMap.getSource('task-routes')._data.features.filter(f=>f.geometry.type==='LineString'));
  expect(lines[1].geometry.coordinates).toEqual(geojson.features[0].geometry.coordinates);expect(lines[1].properties.road_fitted).toBe(false);
  await page.getByRole('button',{name:'Discard changes',exact:true}).click();
});

test('canceling road fitting prevents a late response from changing the draft',async({page})=>{
  let release;const wait=new Promise(resolve=>release=resolve);
  await page.route('**/api/road-route',async route=>{await wait;await route.fulfill({json:{coordinates:[[-79.4,43.7],[-79.41,43.71]]}}).catch(()=>{});});
  await select(page,'North York');await page.getByRole('button',{name:'New task',exact:true}).click();await page.getByLabel('Task name',{exact:true}).fill('Cancel fitting');await upload(page);
  await expect(page.getByRole('button',{name:'Stop road fitting'})).toBeVisible();await expect(page.getByRole('button',{name:'Save task',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Stop road fitting'}).click();release();await expect(page.locator('#road-fit-progress')).toBeHidden();
  expect(await page.evaluate(()=>window.testMap.getSource('task-routes')._data.features[0].geometry.coordinates)).toEqual(geojson.features[0].geometry.coordinates);
  await expect(page.getByRole('button',{name:'Save task',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Discard changes',exact:true}).click();
});

test('task speed recalculates distance and duration, persists and shows WGS84 endpoints in Overview',async({page})=>{
  const original=await(await page.request.get(endpoint)).json();
  try {
    await page.request.put(endpoint,{data:[]});await select(page,'North York');await page.getByRole('button',{name:'New task',exact:true}).click();
    await page.getByLabel('Task ID',{exact:true}).fill('QA-SPEED');await page.getByLabel('Task name',{exact:true}).fill('Speed plan');
    const metrics=page.locator('#task-drive-metrics');
    await expect(metrics.locator('[data-metric=duration]')).toHaveText('Add a route');
    await upload(page,{type:'LineString',coordinates:[[0,0],[0.01,0]]});await expect(page.locator('.route-fit-status')).toContainText('Road fitted');
    await expect(metrics.locator('[data-metric=duration]')).toHaveText('Set drive speeds');
    const speed=page.getByRole('textbox',{name:'Drive speeds (km/h)',exact:true});
    await speed.fill('30');await expect(metrics.locator('[data-metric=distance]')).toHaveText('1.112 km');await expect(metrics.locator('[data-metric=duration]')).toHaveText('2 min 13 s');
    await expect(metrics.locator('[data-metric=start]')).toHaveText('Lat 0.000000°, Lon 0.000000°');await expect(metrics.locator('[data-metric=end]')).toHaveText('Lat 0.000000°, Lon 0.010000°');
    await speed.fill('60');await expect(metrics.locator('[data-metric=duration]')).toHaveText('1 min 7 s');
    await speed.fill('0');expect(await speed.evaluate(input=>input.validity.valid)).toBe(false);await expect(metrics.locator('[data-metric=duration]')).toHaveText('Set drive speeds');
    await speed.fill('60');await page.getByRole('button',{name:'Save task',exact:true}).click();await expect(page.locator('#task-save-state')).toHaveText('Saved');
    const stored=await(await page.request.get(endpoint)).json();expect(stored[0].driveSpeedKmh).toBe(60);expect(stored[0].routes[0].coordinates).toEqual([[0,0],[0.01,0]]);
    const bad=await page.request.put(endpoint,{data:[{...stored[0],driveSpeedKmh:0}]});expect(bad.status()).toBe(400);
    await page.getByRole('button',{name:'Open project overview'}).click();
    const card=page.locator('#overview-task-list .overview-task');await expect(card).toContainText('60 km/h');await expect(card.locator('[data-metric=duration]')).toHaveText('1 min 7 s');await expect(card.locator('[data-metric=end]')).toContainText('Lon 0.010000°');
    await page.reload();await expect(page.locator('#loading')).toBeHidden();await select(page,'North York');await page.getByRole('button',{name:'QA-SPEED · Speed plan',exact:true}).click();await expect(speed).toHaveValue('60');await expect(metrics.locator('[data-metric=duration]')).toHaveText('1 min 7 s');
    await speed.fill('');await expect(metrics.locator('[data-metric=duration]')).toHaveText('Set drive speeds');await page.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(speed).toHaveValue('60');
  } finally {await page.request.put(endpoint,{data:original});}
});

test('Overview manages tasks in a lower table and persists canonical database route details',async({page})=>{
 const original=await(await page.request.get(endpoint)).json();
 try {
  await page.request.put(endpoint,{data:[]});await select(page,'North York');await page.getByRole('button',{name:'Open project overview'}).click();
  const overview=page.locator('#project-overview'),table=page.locator('#overview-task-rows');
  const contextBox=await page.locator('.project-context-card').boundingBox(),tableBox=await page.locator('.overview-tasks-card').boundingBox();expect(tableBox.y).toBeGreaterThan(contextBox.y+contextBox.height);
  await overview.getByRole('button',{name:'New task',exact:true}).click();
  await page.getByRole('textbox',{name:'Task ID for new task',exact:true}).fill('TABLE-1');await page.getByRole('textbox',{name:'Task name for new task',exact:true}).fill('Table drive');await page.getByRole('textbox',{name:'Drive speeds (km/h) for new task',exact:true}).fill('30');
  await table.getByRole('button',{name:'Save',exact:true}).click();await expect(table.getByRole('button',{name:'Edit task',exact:true})).toBeVisible();
  let saved=await(await page.request.get(endpoint)).json();expect(saved[0].driveSpeedKmh).toBe(30);expect(saved[0].driveMetrics.distanceKm).toBeNull();
  await table.getByRole('button',{name:'0 routes',exact:true}).click();await table.getByRole('button',{name:'Edit routes on map',exact:true}).click();await expect(page.locator('#task-panel')).toBeVisible();await expect(page.getByLabel('Task name',{exact:true})).toHaveValue('Table drive');
  await upload(page);await page.getByRole('button',{name:'Save task',exact:true}).click();await expect(page.locator('#task-save-state')).toHaveText('Saved');await page.getByRole('button',{name:'Open project overview'}).click();
  saved=await(await page.request.get(endpoint)).json();const seconds=saved[0].driveMetrics.durationSeconds;expect(seconds).toBeGreaterThan(0);expect(saved[0].driveMetrics.routes).toHaveLength(1);
  await table.getByRole('button',{name:'Edit task',exact:true}).click();const speed=page.getByRole('textbox',{name:'Drive speeds (km/h) for TABLE-1',exact:true});await speed.fill('60');await table.getByRole('button',{name:'Save',exact:true}).click();await expect(table.getByRole('button',{name:'Edit task',exact:true})).toBeVisible();
  saved=await(await page.request.get(endpoint)).json();expect(saved[0].driveMetrics.durationSeconds).toBeCloseTo(seconds/2,6);
  await table.getByRole('button',{name:'1 route',exact:true}).click();await expect(table.locator('.task-route-data')).toContainText('Yonge Street');await expect(table.locator('.task-route-data')).toContainText('Start Lat');
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:'/private/tmp/ndt-overview-table-desktop.png'});
  for(const viewport of [{width:390,height:844},{width:320,height:568}]) {
   await page.setViewportSize(viewport);const region=page.getByRole('region',{name:'Drive-task data table',exact:true});await region.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await region.focus();await page.keyboard.press('ArrowRight');await expect.poll(()=>region.evaluate(element=>element.scrollLeft)).toBeGreaterThan(0);
   await page.screenshot({path:`/private/tmp/ndt-overview-table-${viewport.width}.png`});
  }
  await page.setViewportSize({width:1440,height:900});
  await table.getByRole('button',{name:'Edit task',exact:true}).click();const name=page.getByRole('textbox',{name:'Task name for TABLE-1',exact:true});await name.fill('Retain failed draft');
  await page.route('**/projects/northyork/tasks',route=>route.request().method()==='PUT'?route.fulfill({status:503}):route.continue());await table.getByRole('button',{name:'Save',exact:true}).click();await expect(page.locator('#overview-task-error')).toContainText('draft is still available');await expect(name).toHaveValue('Retain failed draft');
  await page.unroute('**/projects/northyork/tasks');await table.getByRole('button',{name:'Cancel',exact:true}).click();await expect(table).toContainText('Table drive');
  page.once('dialog',dialog=>dialog.accept());await table.getByRole('button',{name:'Delete task',exact:true}).click();await expect(page.locator('#overview-task-empty')).toBeVisible();
  await page.reload();await expect(page.locator('#loading')).toBeHidden();await select(page,'North York');await expect(page.locator('#task-list button')).toHaveCount(0);
 } finally {await page.request.put(endpoint,{data:original});}
});

test('multiple speed cases compare the same saved route without copying or rerouting it',async({page})=>{
 const original=await(await page.request.get(endpoint)).json(),coordinates=[[0,0],[.01,0]];
 let reroutes=0;page.on('request',request=>{if(request.url().includes('/api/road-route'))reroutes++;});
 try {
  const cases=[20,40,60].map((speed,index)=>({id:`CASE-00${index+1}`,name:`${speed} km/h`,speedKmh:speed}));
  await page.request.put(endpoint,{data:[{id:'MULTI',name:'Same route comparison',driveSpeedKmh:20,speedCases:cases,routes:[{id:'r1',name:'Shared route',coordinates,roadFit:'fitted'}]}]});
  await select(page,'North York');await page.getByRole('button',{name:'MULTI · Same route comparison',exact:true}).click();const input=page.getByRole('textbox',{name:'Drive speeds (km/h)',exact:true});await expect(input).toHaveValue('20, 40, 60');
  await expect(page.locator('#task-speed-results [data-speed-case]')).toHaveCount(3);await expect(page.locator('#task-speed-results')).toContainText('3 min 20 s');await expect(page.locator('#task-speed-results')).toContainText('1 min 7 s');await expect(page.locator('.route-card')).toHaveCount(1);
  await page.getByRole('button',{name:'Open project overview'}).click();const table=page.locator('#overview-task-rows');await table.getByRole('button',{name:'1 route',exact:true}).click();await expect(table.locator('.task-route-data')).toContainText('Speed cases · shared routes');await expect(table.locator('.task-route-data')).toContainText('20 km/h: 3 min 20 s');
  await table.getByRole('button',{name:'Edit task',exact:true}).click();const speeds=page.getByRole('textbox',{name:'Drive speeds (km/h) for MULTI',exact:true});await speeds.fill('30, 60, 90');await table.getByRole('button',{name:'Save',exact:true}).click();await expect(table.getByRole('button',{name:'Edit task',exact:true})).toBeVisible();
  let stored=(await(await page.request.get(endpoint)).json())[0];expect(stored.speedCases.map(item=>item.speedKmh)).toEqual([30,60,90]);expect(stored.routes).toHaveLength(1);expect(stored.routes[0].coordinates).toEqual(coordinates);expect(stored.driveMetrics.speedCases[0].durationSeconds/3).toBeCloseTo(stored.driveMetrics.speedCases[2].durationSeconds,6);expect(reroutes).toBe(0);
  await table.getByRole('button',{name:'Edit task',exact:true}).click();await speeds.fill('30, 30');expect(await speeds.evaluate(element=>element.validity.valid)).toBe(false);await table.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.reload();await expect(page.locator('#loading')).toBeHidden();await select(page,'North York');await page.getByRole('button',{name:'MULTI · Same route comparison',exact:true}).click();await expect(input).toHaveValue('30, 60, 90');
 } finally {await page.request.put(endpoint,{data:original});}
});
