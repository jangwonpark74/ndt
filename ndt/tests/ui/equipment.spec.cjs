const {test,expect}=require('@playwright/test');
const {maps}=require('./drive-fixture.cjs');
const fs=require('node:fs');
const path=require('node:path');
const AxeBuilder=require('@axe-core/playwright').default;

test('operator equipment import previews, persists, traces ports and rejects broken replacements',async({page,request})=>{
  await maps(page);await page.goto('/');await expect(page.locator('#network-list button').first()).toBeVisible({timeout:20000});
  await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('harbourfront');await page.locator('#network-tab').click();
  await page.getByText('Equipment inventory imports',{exact:true}).click();
  const endpoint='/api/regions/toronto/projects/harbourfront/equipment-inventory';
  const sites=await (await request.get('/api/regions/toronto/assets/bell-outdoor-sites.geojson')).json();
  const site=sites.features.find(s=>s.properties.ised_site_ids?.includes('W2539'));
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../fixtures/equipment-example.json'),'utf8'));
  data.sites[0].inventorySiteId=site.properties.site_id;
  const raw=Buffer.concat([Buffer.from([239,187,191]),Buffer.from(JSON.stringify(data))]);
  await expect(page.getByLabel('Equipment JSON file',{exact:true})).toBeEnabled();
  await page.getByLabel('Equipment JSON file',{exact:true}).setInputFiles({name:'operator.json',mimeType:'application/json',buffer:raw});
  await expect(page.locator('#equipment-preview')).toContainText('1 cells');
  expect(await (await request.get(endpoint)).json()).toBeNull();
  await page.getByRole('button',{name:'Import previewed inventory',exact:true}).click();
  await expect(page.locator('#equipment-status')).toContainText('Revision 1');
  const saved=await (await request.get(endpoint)).json();
  expect(saved.sha256).toBe(require('node:crypto').createHash('sha256').update(raw).digest('hex'));
  await page.getByLabel('Find a licensed site').fill('5205 Timberlea Boulevard');await page.locator('#network-list button').first().click();
  await page.getByText('Imported equipment topology',{exact:true}).click();
  await expect(page.locator('#imported-equipment')).toContainText('test-nci-1');
  await page.locator('#imported-equipment summary').filter({hasText:'NR'}).first().click();
  await expect(page.locator('#imported-equipment')).toContainText('radio-port-1');
  await expect(page.locator('#imported-equipment')).toContainText('antenna-port-1');
  await expect(page.locator('#imported-equipment')).toContainText('link-row-1');
  await expect(page.locator('#imported-equipment')).toContainText('operator');
  await page.getByText('Pattern cuts: Synthetic reference cuts',{exact:true}).click();
  await expect(page.getByRole('img',{name:'horizontal relative antenna attenuation, 0 to 30 dB'})).toBeVisible();
  await page.screenshot({path:'.cache/planning-docs/equipment-topology.png'});
  await page.reload();await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('harbourfront');await page.locator('#network-tab').click();
  await page.getByText('Equipment inventory imports',{exact:true}).click();await expect(page.locator('#equipment-status')).toContainText('Revision 1');
  data.links[0].antennaPortId='missing-port';
  await page.getByLabel('Equipment JSON file',{exact:true}).setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await expect(page.locator('#equipment-error')).toContainText('missing-port');await expect(page.locator('#equipment-import')).toBeDisabled();
  expect((await (await request.get(endpoint)).json()).revision).toBe(1);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await page.setViewportSize({width:390,height:844});await page.locator('#equipment-error').scrollIntoViewIfNeeded();await expect(page.locator('#equipment-error')).toBeInViewport();await page.screenshot({path:'.cache/planning-docs/equipment-phone.png'});
});

test('New York imports attach explicit equipment to a reservation without assuming live service',async({page,request})=>{
  await maps(page);await page.goto('/?region=new-york');await expect(page.locator('#nyc-status')).toContainText('701 in the NYC snapshot',{timeout:20000});
  await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('manhattan');await page.locator('#network-tab').click();await page.getByText('Equipment inventory imports',{exact:true}).click();
  const records=await (await request.get('/api/regions/new-york/assets/verizon-poles.geojson')).json();
  const site=records.features.find(f=>f.properties.status==='Installed');
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../fixtures/equipment-example.json'),'utf8'));data.sites[0].inventorySiteId=String(site.properties.id);
  const input=page.getByLabel('Equipment JSON file',{exact:true});await expect(input).toBeEnabled();await input.setInputFiles({name:'nyc-operator.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await expect(page.locator('#equipment-preview')).toContainText('1 cells');await page.locator('#equipment-import').click();await expect(page.locator('#equipment-status')).toContainText('Revision 1');
  await page.getByLabel('Find a reservation').fill(String(site.properties.id));await page.locator('#nyc-list button').first().click();
  await page.getByText('Imported equipment topology',{exact:true}).click();await expect(page.locator('#imported-equipment')).toContainText('test-nci-1');
  await expect(page.locator('#imported-equipment')).toContainText('has not been independently verified');
});
