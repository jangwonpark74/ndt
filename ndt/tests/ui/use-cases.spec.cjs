const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
test.beforeEach(async({page})=>{
  await page.route('https://tiles.openfreemap.org/styles/liberty',route=>route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#d5e1dc'}}]}}));
  await page.route('https://tiles.mapterhorn.com/**',route=>route.abort());
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
});
async function navigate(page){
  await page.goto('/'); await expect(page.locator('#loading')).toBeHidden({timeout:20000});
  if (await page.getByRole('button',{name:'Open map navigation'}).isVisible()) await page.getByRole('button',{name:'Open map navigation'}).click();
}
for (const width of [1440,390]) test(`project use case dropdown saves, recovers and synchronizes at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:1000});
  const endpoint='/api/regions/toronto/projects/northyork/use-case';
  const original=(await (await page.request.get('/api/regions/toronto/project-use-cases')).json()).northyork ?? null;
  try {
    await page.request.put(endpoint,{data:{useCase:null}});
    await navigate(page);
    await expect(page.locator('#project-use-case')).toBeDisabled();
    await page.locator('#project-picker').selectOption('northyork');
    if(width===390) await page.getByRole('button',{name:'Open map navigation'}).click();
    const dropdown=page.locator('#project-use-case');
    await expect(dropdown).toBeEnabled();
    await expect(dropdown.locator('option')).toHaveText(['Uncategorized','Virtual Drive Test','Parameter A/B Test','AI-RAN Algo. Benchmark']);
    await dropdown.selectOption('virtual-drive-test');
    await expect(page.locator('#project-use-case-status')).toHaveText('Use case saved.');
    await expect(page.locator('#project-picker')).toHaveValue('northyork');
    await page.screenshot({path:`/private/tmp/ndt-use-cases-navigation-${width}.png`});
    await page.locator('#overview-open').click();
    const overview=page.locator('#overview-use-case');
    await expect(overview).toHaveValue('virtual-drive-test');
    await overview.selectOption('parameter-ab-test');
    await expect(page.locator('#overview-use-case-status')).toHaveText('Use case saved.');
    await page.route('**/projects/northyork/use-case',route=>route.fulfill({status:503}));
    await overview.selectOption('ai-ran-benchmark');
    await expect(page.locator('#overview-use-case-status')).toContainText('Could not save');
    await expect(overview).toHaveValue('parameter-ab-test');
    await page.unroute('**/projects/northyork/use-case');
    await overview.selectOption('ai-ran-benchmark');
    await expect(page.locator('#overview-use-case-status')).toHaveText('Use case saved.');
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:`/private/tmp/ndt-use-cases-overview-${width}.png`});
    await navigate(page); await page.locator('#project-picker').selectOption('northyork');
    await expect(dropdown).toHaveValue('ai-ran-benchmark');
    if(width===390) await page.getByRole('button',{name:'Open map navigation'}).click();
    await page.locator('#project-picker').selectOption('etobicoke');
    if(width===390) await page.getByRole('button',{name:'Open map navigation'}).click();
    await page.locator('#project-picker').selectOption('northyork');
    if(width===390) await page.getByRole('button',{name:'Open map navigation'}).click();
    await dropdown.selectOption('');
    await expect(page.locator('#project-use-case-status')).toHaveText('Use case saved.');
    expect((await (await page.request.get('/api/regions/toronto/project-use-cases')).json()).northyork).toBeUndefined();
  } finally {await page.request.put(endpoint,{data:{useCase:original}});}
});
test('use case loading retries and New York saves independently of radio site data',async({page})=>{
  await page.route('**/api/regions/toronto/project-use-cases',route=>route.fulfill({status:503}));
  await navigate(page); await page.locator('#project-picker').selectOption('northyork');
  await expect(page.locator('#project-use-case')).toBeDisabled();
  await expect(page.locator('#project-use-case-status')).toContainText('Retry loading');
  await page.unroute('**/api/regions/toronto/project-use-cases');
  await page.locator('#project-use-case-retry').click();
  await expect(page.locator('#project-use-case')).toBeEnabled();
  await page.getByRole('button',{name:'New York City region',exact:true}).click();
  await expect(page.locator('#loading')).toBeHidden({timeout:20000});
  await page.locator('#project-picker').selectOption('manhattan');
  const endpoint='/api/regions/new-york/projects/manhattan/use-case';
  const original=(await (await page.request.get('/api/regions/new-york/project-use-cases')).json()).manhattan ?? null;
  try {
    await page.locator('#project-use-case').selectOption('parameter-ab-test');
    await expect(page.locator('#project-use-case-status')).toHaveText('Use case saved.');
    await page.locator('#overview-open').click();
    await expect(page.locator('#overview-use-case')).toHaveValue('parameter-ab-test');
    await expect(page.locator('#project-status')).toContainText('Coverage boundary unavailable');
  } finally {await page.request.put(endpoint,{data:{useCase:original}});}
});
