const {test,expect}=require('@playwright/test');
const coordinates=[[-79.412,43.761],[-79.414,43.77],[-79.416,43.78]];
async function upload(page){await page.locator('#route-import').setInputFiles({name:'route.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify({type:'LineString',coordinates}))});}
async function settings(page){
  const navigation=page.getByRole('button',{name:'Open map navigation'});
  if(await navigation.isVisible())await navigation.click();
  const menu=page.locator('.map-settings').filter({hasText:'Map Settings'});
  if(!await menu.evaluate(el=>el.open))await menu.locator('summary').click();
  return page.getByRole('checkbox',{name:'Road fitting',exact:true});
}
test.beforeEach(async({page})=>{
  await page.route('https://tiles.openfreemap.org/styles/liberty',route=>route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#d5e1dc'}}]}}));
  await page.route('https://tiles.mapterhorn.com/**',route=>route.abort());
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
});
for(const width of [1280,390])test(`Map Settings switches road fitting off and on at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});
  let requests=0;
  await page.route('**/api/road-route',route=>{requests++;return route.fulfill({json:{coordinates}});});
  await page.goto('/');await expect(page.locator('#loading')).toBeHidden({timeout:20000});
  const checkbox=await settings(page);await expect(checkbox).toBeChecked();
  await checkbox.scrollIntoViewIfNeeded();
  await page.locator('#map-navigation').screenshot({path:`.cache/road-fitting/settings-${width}.png`});
  await checkbox.focus();await page.keyboard.press('Space');await expect(checkbox).not.toBeChecked();
  await page.getByRole('combobox',{name:'Project',exact:true}).selectOption({label:'North York'});
  await page.getByRole('button',{name:'New task',exact:true}).click();
  await page.getByLabel('Task name',{exact:true}).fill('Road fitting switch');await upload(page);
  await expect(page.locator('.route-fit-status')).toContainText('original path');
  await expect(page.getByRole('button',{name:'Fit to roads',exact:true})).toBeDisabled();expect(requests).toBe(0);
  await page.getByRole('button',{name:'Draw on map',exact:true}).click();
  await expect(page.locator('#route-draw-status')).toContainText('Road fitting is off');
  await page.keyboard.press('Escape');
  const toggle=await settings(page);await toggle.check();
  if(width<=700)await page.getByRole('button',{name:'Close map navigation'}).click();
  await page.getByRole('button',{name:'Fit to roads',exact:true}).click();
  await expect(page.locator('.route-fit-status')).toContainText('Road fitted');expect(requests).toBe(1);
  await upload(page);await expect(page.locator('.route-fit-status').last()).toContainText('Road fitted');expect(requests).toBe(2);
  await (await settings(page)).uncheck();
  if(width<=700)await page.getByRole('button',{name:'Close map navigation'}).click();
  await expect(page.locator('.route-fit-status').first()).toContainText('Road fitted');
  await page.getByRole('button',{name:'Discard changes',exact:true}).click();
  await page.reload();await expect(page.locator('#loading')).toBeHidden({timeout:20000});await expect(await settings(page)).toBeChecked();
});

test('turning Road fitting off cancels pending fitting and ignores a late response',async({page})=>{
  let release;const pending=new Promise(resolve=>release=resolve);
  await page.route('**/api/road-route',async route=>{await pending;await route.fulfill({json:{coordinates:[[1,2],[3,4]]}}).catch(()=>{});});
  await page.goto('/');await expect(page.locator('#loading')).toBeHidden({timeout:20000});
  await page.getByRole('combobox',{name:'Project',exact:true}).selectOption({label:'North York'});
  await page.getByRole('button',{name:'New task',exact:true}).click();
  await page.getByLabel('Task name',{exact:true}).fill('Cancel fitting');await upload(page);
  await expect(page.getByRole('button',{name:'Stop road fitting'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save task',exact:true})).toBeDisabled();
  await (await settings(page)).uncheck();release();
  await expect(page.locator('#road-fit-progress')).toBeHidden();
  await expect(page.getByRole('button',{name:'Save task',exact:true})).toBeEnabled();
  await expect(page.locator('.route-fit-status')).toContainText('original path');
  await expect(page.getByRole('button',{name:'Fit to roads',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Discard changes',exact:true}).click();
});
