const {test,expect} = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const base = '/api/regions/toronto/projects/northyork/virtual-ues';

test.beforeEach(async ({page})=>{
  await page.route('https://tiles.openfreemap.org/styles/liberty',route=>route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#d5e1dc'}}]}}));
  await page.route('https://tiles.mapterhorn.com/**',route=>route.abort());
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('**/app.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('const map = new maplibregl.Map','const map = window.testMap = new maplibregl.Map')});});
  await page.goto('/');await expect(page.locator('#loading')).toBeHidden({timeout:20000});
});

test('virtual UEs can be placed, saved, retried, reloaded, edited and deleted',async({page})=>{
  const original=await(await page.request.get(base)).json();
  let created;
  try {
    await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('northyork');
    await page.getByRole('button',{name:'Virtual UEs',exact:true}).click();
    await expect(page.getByRole('region',{name:'Virtual UE editor'})).toBeVisible();
    await expect(page.getByRole('button',{name:'New virtual UE'})).toBeEnabled();
    await page.getByRole('button',{name:'New virtual UE'}).click();
    await page.getByLabel('UE name').fill('Browser virtual UE');
    await page.getByRole('button',{name:'Place on map'}).click();
    await page.keyboard.press('Escape');await expect(page.locator('#ue-place-status')).toBeHidden();
    await page.getByRole('button',{name:'Place on map'}).click();
    await page.mouse.click(550,450);
    await expect(page.locator('#ue-place-status')).toBeHidden();
    await expect(page.locator('#ue-latitude')).not.toHaveValue('');
    expect(await page.evaluate(()=>window.testMap.getSource('virtual-ues')._data.features.length)).toBe(original.length+1);
    await page.route('**/virtual-ues/*',async route=>{if(route.request().method()==='PUT'){await route.fetch();return route.fulfill({status:503});}return route.continue();});
    await page.getByRole('button',{name:'Save UE'}).click();await expect(page.locator('#ue-error')).toContainText('draft is still available');
    await page.unroute('**/virtual-ues/*');await page.getByRole('button',{name:'Save UE'}).click();
    await expect(page.locator('#ue-save-state')).toHaveText('Saved');
    const data=await(await page.request.get(base)).json();created=data.find(item=>item.name==='Browser virtual UE');expect(created).toBeTruthy();expect(data.filter(item=>item.name==='Browser virtual UE')).toHaveLength(1);
    await page.screenshot({path:'/private/tmp/ndt-virtual-ue-editor.png'});
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
    await page.reload();await expect(page.locator('#loading')).toBeHidden({timeout:20000});
    await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('northyork');await page.getByRole('button',{name:'Virtual UEs',exact:true}).click();
    await page.getByRole('button',{name:'Browser virtual UE',exact:true}).click();
    await expect(page.getByLabel('Latitude (WGS84)')).toHaveValue(String(created.latitude));
    await page.getByLabel('UE name').fill('Edited virtual UE');await page.getByRole('button',{name:'Save UE'}).click();await expect(page.locator('#ue-save-state')).toHaveText('Saved');
    expect((await(await page.request.get(base)).json()).find(item=>item.id===created.id).name).toBe('Edited virtual UE');
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete UE'}).click();await expect(page.locator('#ue-form')).toBeHidden();
    expect((await(await page.request.get(base)).json()).some(item=>item.id===created.id)).toBe(false);
  } finally {
    const now=await(await page.request.get(base)).json();
    for (const item of now) if(!original.some(prior=>prior.id===item.id)) await page.request.delete(`${base}/${item.id}`);
  }
});

test('load retry and project switches preserve an unsaved UE draft',async({page})=>{
  await page.route('**/projects/northyork/virtual-ues',route=>route.fulfill({status:503}));
  await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('northyork');
  await page.getByRole('button',{name:'Virtual UEs',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry loading virtual UEs'})).toBeVisible();
  await expect(page.getByRole('button',{name:'New virtual UE'})).toBeDisabled();
  await page.unroute('**/projects/northyork/virtual-ues');
  await page.getByRole('button',{name:'Retry loading virtual UEs'}).click();
  await expect(page.getByRole('button',{name:'New virtual UE'})).toBeEnabled();
  await page.getByRole('button',{name:'New virtual UE'}).click();
  await page.getByLabel('UE name').fill('Retained draft');await page.getByLabel('Latitude (WGS84)').fill('43.7');await page.getByLabel('Longitude (WGS84)').fill('-79.4');
  await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('etobicoke');
  await page.getByRole('button',{name:'Virtual UEs',exact:true}).click();
  await expect(page.getByLabel('UE name')).toBeHidden();
  await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('northyork');
  await page.getByRole('button',{name:'Virtual UEs',exact:true}).click();
  await expect(page.getByLabel('UE name')).toHaveValue('Retained draft');
  await expect(page.getByLabel('Latitude (WGS84)')).toHaveValue('43.7');
  await page.getByRole('button',{name:'Discard changes'}).click();
});

for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568}]) test(`the Virtual UEs section follows tasks in Project Overview at ${viewport.width}px`,async({page})=>{
  await page.setViewportSize(viewport);
  if (viewport.width <= 700) await page.getByRole('button',{name:'Open map navigation'}).click();
  await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('northyork');
  await page.getByRole('button',{name:'Open project overview'}).click();
  const section=page.getByRole('region',{name:'Virtual UEs',exact:true});
  const editor=section.getByRole('button',{name:'Virtual UE editor',exact:true});
  await expect(section).toBeVisible();
  expect(await page.evaluate(()=>document.querySelector('.overview-ue-card').getBoundingClientRect().top >= document.querySelector('.overview-tasks-card').getBoundingClientRect().bottom)).toBe(true);
  await section.scrollIntoViewIfNeeded();await expect(editor).toBeInViewport();
  await page.screenshot({path:`/private/tmp/ndt-overview-virtual-ues-${viewport.width}.png`});
  await editor.click();
  await expect(page.getByRole('region',{name:'Virtual UE editor'})).toBeVisible();
  await expect(page.getByRole('button',{name:'New virtual UE'})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('New York projects can store virtual UEs independently of Toronto',async({page})=>{
  const ny='/api/regions/new-york/projects/manhattan/virtual-ues';
  const original=await(await page.request.get(ny)).json();
  try {
    await page.goto('/?region=new-york');await expect(page.locator('#loading')).toBeHidden({timeout:20000});
    await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('manhattan');
    await page.getByRole('button',{name:'Virtual UEs',exact:true}).click();
    await expect(page.getByRole('button',{name:'New virtual UE'})).toBeEnabled();
    await page.getByRole('button',{name:'New virtual UE'}).click();
    await page.getByLabel('UE name').fill('Manhattan UE');
    await page.getByLabel('Latitude (WGS84)').fill('40.75');await page.getByLabel('Longitude (WGS84)').fill('-73.98');
    await page.getByRole('button',{name:'Save UE'}).click();await expect(page.locator('#ue-save-state')).toHaveText('Saved');
    const added=(await(await page.request.get(ny)).json()).find(item=>item.name==='Manhattan UE');expect(added).toBeTruthy();
    expect((await(await page.request.get(base)).json()).some(item=>item.id===added.id)).toBe(false);
  } finally {
    for(const item of await(await page.request.get(ny)).json()) if(!original.some(prior=>prior.id===item.id)) await page.request.delete(`${ny}/${item.id}`);
  }
});
