const {test,expect} = require('@playwright/test');

test.beforeEach(async ({page})=>{
  await page.route('https://tiles.openfreemap.org/styles/liberty',route=>route.fulfill({
    json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#d5e1dc'}}]},
  }));
  await page.route('https://tiles.mapterhorn.com/**',route=>route.abort());
});

test('a stalled optional font service does not block startup', async ({page})=>{
  let release;
  await page.route('https://fonts.googleapis.com/**',route=>new Promise(resolve=>{
    release=()=>route.abort().catch(()=>{}).finally(resolve);
  }));
  try {
    await page.goto('/',{waitUntil:'domcontentloaded',timeout:10000});
    await expect(page.locator('#loading')).toBeHidden({timeout:15000});
    await expect(page.locator('#region-choices option')).toHaveCount(2);
    await expect(page.locator('#error')).toBeHidden();
    expect(release).toBeDefined();
  } finally { release?.(); }
});

for (const [label,url] of [['application module','**/app.js*'],['map library','**/vendor/maplibre-gl.js']]) test(`a stalled ${label} eventually exposes a retry`, async ({page})=>{
  let release;
  await page.clock.install();
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route(url,route=>new Promise(resolve=>{
    release=()=>route.abort().catch(()=>{}).finally(resolve);
  }));
  try {
    await page.goto('/',{waitUntil:'commit'});
    await page.locator('#retry').waitFor({state:'attached'});
    await expect.poll(()=>Boolean(release)).toBe(true);
    await page.clock.fastForward(35000);
    await expect(page.locator('#error')).toContainText('viewer could not start');
    await expect(page.locator('#loading')).toBeHidden();
  } finally { release?.(); }
});

test('a stalled region catalog reports a retry instead of loading indefinitely', async ({page})=>{
  let release;
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('**/api/regions',route=>new Promise(resolve=>{
    release=()=>route.abort().catch(()=>{}).finally(resolve);
  }));
  try {
    await page.goto('/',{waitUntil:'domcontentloaded'});
    await expect(page.locator('#error')).toContainText('regional data service is unavailable',{timeout:12000});
    await expect(page.locator('#loading')).toBeHidden();
    release?.();
    await page.unroute('**/api/regions');
    await page.locator('#retry').click();
    await expect(page.locator('#error')).toBeHidden({timeout:15000});
    await expect(page.locator('#region-choices option')).toHaveCount(2);
  } finally { release?.(); }
});

test('a missing application module reports a retry', async ({page})=>{
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('**/navigation-view.mjs',route=>route.fulfill({status:503,body:'Unavailable'}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#error')).toContainText('viewer could not start');
  await expect(page.locator('#loading')).toBeHidden();
  await page.unroute('**/navigation-view.mjs');
  await page.locator('#retry').click();
  await expect(page.locator('#error')).toBeHidden({timeout:15000});
  await expect(page.locator('#region-choices option')).toHaveCount(2);
});
