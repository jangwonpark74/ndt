const {test,expect,task,endpoint,installTask,maps}=require('./drive-fixture.cjs');
const {AxeBuilder}=require('@axe-core/playwright');
const {readFile,mkdir}=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

test('a Task route link preserves the exact route selection through planning refresh',async({page,request,driveOrigin})=>{
  await installTask(request,driveOrigin,{...task,routes:[task.routes[0],{id:'second',name:'Alternative street',coordinates:[[-79.412,43.762],[-79.410,43.762]]}]});
  await maps(page);await page.goto(driveOrigin+'/?region=toronto&project=northyork&task=MERGE-TEST');
  await expect(page.locator('#task-save-state')).toHaveText('Saved');
  await page.locator('.route-card').filter({hasText:'Alternative street'}).getByRole('button',{name:'Open drive tests'}).click();
  await expect(page.locator('#execution-route')).toHaveValue('second');
  await page.getByRole('button',{name:'Refresh planning inputs'}).click();
  await expect(page.locator('#execution-route')).toHaveValue('second');
});

test('saved Task route opens an integrated six-run A/B journey with reproducible results',async({page,request,driveOrigin,browserName})=>{
  test.setTimeout(60000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await maps(page);
  await installTask(request,driveOrigin);
  await page.goto(driveOrigin+'/?region=toronto&project=northyork&task=MERGE-TEST');
  await expect(page.locator('#task-save-state')).toHaveText('Saved');
  await page.getByRole('button',{name:'Open drive tests',exact:true}).click();
  await expect(page).toHaveURL(/\/drive-test\/\?region=toronto&project=northyork&task=MERGE-TEST&route=r/);
  await expect(page.getByRole('combobox',{name:'Planning Task',exact:true})).toHaveValue('toronto/northyork/MERGE-TEST');
  await expect(page.locator('#execution-context')).toContainText('6 runs');
  await expect(page.getByRole('button',{name:'Run A/B experiment'})).toBeEnabled();
  await page.getByRole('button',{name:'Run A/B experiment'}).click();
  await expect(page.locator('#execution-progress')).toContainText('completed',{timeout:20000});
  await expect(page.locator('#source-badge')).toHaveText('Simulated planning power');
  await expect(page.locator('#metric')).toHaveValue('predicted_rx_dbm');
  await expect(page.locator('#route-context-status')).toContainText('North York route');
  await expect(page.locator('#execution-results').getByRole('button',{name:/Open [AB]/})).toHaveCount(6);
  const evidence=process.env.NDT_DM_EVIDENCE_DIR||'/private/tmp/ndt-dm-evidence';await mkdir(evidence,{recursive:true});
  await page.screenshot({path:path.join(evidence,'virtual-replay-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'KPI analytics',exact:true}).click();
  await expect(page.locator('#route-aligned-comparison')).toContainText('controlled-model-ab');
  await page.screenshot({path:path.join(evidence,'parameter-ab-desktop.png'),fullPage:true});
  await expect(page.getByLabel('Inspect route position')).toBeVisible();
  await page.getByLabel('Inspect route position').selectOption({index:2});
  await expect(page.locator('#replay')).toBeVisible();
  const savedId=await page.locator('#test-id').innerText();
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Export experiment JSON'}).click();
  const exported=JSON.parse(await readFile(await(await downloadEvent).path(),'utf8'));
  expect(exported.runs).toHaveLength(6);expect(exported.comparisons).toHaveLength(3);
  expect(exported.snapshot.route.coordinates).toEqual(task.routes[0].coordinates);
  expect(exported.comparisons[0].a_observations[0]).toHaveProperty('predicted_rx_dbm');
  expect(exported.comparisons[0].a_observations[0]).not.toHaveProperty('rsrp_dbm');
  await page.getByRole('button',{name:'Test report',exact:true}).click();
  await expect(page.locator('#report')).toContainText('Frozen route context');
  await expect(page.locator('#report')).toContainText('Saved route comparison');
  if(browserName==='chromium')await page.pdf({path:path.join(evidence,'virtual-ab-report.pdf'),printBackground:true,preferCSSPageSize:true});
  await page.reload();await expect(page.locator('#test-id')).toHaveText(savedId);
  await page.getByRole('link',{name:'Back to planning',exact:false}).click();
  await expect(page.locator('#task-id')).toHaveValue('MERGE-TEST');
  expect(errors).toEqual([]);
});

test('a running experiment can be cancelled without publishing a completed A/B result',async({page,request,driveOrigin})=>{
  await installTask(request,driveOrigin,{...task,speedCases:[{id:'slow',name:'Slow controlled drive',speedKmh:.1}]});
  await page.goto(`${driveOrigin}/drive-test/?region=toronto&project=northyork&task=${task.id}`);
  await expect(page.getByRole('button',{name:'Run A/B experiment'})).toBeEnabled();
  await page.getByLabel('Sampling interval (s)').fill('0.1');
  await page.getByLabel('Sampling interval (s)').press('Tab');
  await page.getByRole('button',{name:'Run A/B experiment'}).click();
  await page.getByRole('button',{name:'Cancel experiment',exact:true}).click();
  await expect(page.locator('#execution-progress')).toContainText('cancelled');
  await expect(page.getByRole('button',{name:'Export experiment JSON'})).toHaveCount(0);
});

test('measured captures retain raw GPS, associate to the Task route and compare aligned bins',async({page,request,driveOrigin})=>{
  await installTask(request,driveOrigin);await maps(page);const captures=[];
  for(const [variant,power] of [['A',-100],['B',-97]]){
    const lines=['timestamp,latitude,longitude,rat,rsrp_dbm'];
    for(let i=0;i<=40;i++)lines.push(`${new Date(Date.UTC(2026,10,12,0,0,i)).toISOString()},43.761,${-79.412+i*.002/40},NR,${power}`);
    const response=await request.post(driveOrigin+'/api/dm/tests',{data:lines.join('\n'),headers:{'Content-Type':'text/csv','X-DM-Request':randomUUID(),
      'X-DM-Region':'toronto','X-DM-Project':'northyork','X-DM-Task':task.id,'X-DM-Label':'Capture '+variant,'X-DM-Source':variant+'.csv'}});
    expect(response.status()).toBe(201);captures.push(await response.json());
  }
  await page.goto(`${driveOrigin}/drive-test/?region=toronto&project=northyork&task=${task.id}&test=${captures[1].id}`);
  await expect(page.locator('#run-title')).toHaveText('Capture B');
  await page.getByRole('button',{name:'Associate selected Task route'}).click();
  await expect(page.locator('#route-context-status')).toContainText('100.0% continuous route coverage');
  await page.locator(`[data-id="${captures[0].id}"]`).click();
  await page.getByRole('button',{name:'Associate selected Task route'}).click();
  await expect(page.locator('#route-context-status')).toContainText('41 matched');
  await page.locator(`[data-id="${captures[1].id}"]`).click();
  await page.getByRole('button',{name:'KPI analytics',exact:true}).click();
  await page.getByLabel('Baseline Test ID').selectOption(captures[0].id);
  await page.getByRole('button',{name:'Compare aligned route'}).click();
  await expect(page.locator('#route-aligned-comparison')).toContainText('observational-route-comparison');
  await expect(page.locator('#route-aligned-comparison')).toContainText('3.0 dB');
  const response=await request.get(driveOrigin+'/api/dm/tests/'+captures[1].id),saved=await response.json();
  expect(saved.count).toBe(41);expect(saved.sha256).toBe(captures[1].sha256);
});

test('stale planning inputs fail closed and the UI recovers without losing the selected Task',async({page,request,driveOrigin})=>{
  await installTask(request,driveOrigin);await page.goto(`${driveOrigin}/drive-test/?region=toronto&project=northyork&task=${task.id}`);
  await expect(page.getByRole('button',{name:'Run A/B experiment'})).toBeEnabled();
  await installTask(request,driveOrigin,{...task,name:'Updated saved Task'});
  await page.getByRole('button',{name:'Run A/B experiment'}).click();
  await expect(page.locator('#execution-error')).toContainText('Planning inputs changed');
  await page.getByRole('button',{name:'Refresh planning inputs'}).click();
  await expect(page.getByRole('combobox',{name:'Planning Task',exact:true})).toContainText('Updated saved Task');
  await page.getByRole('button',{name:'Run A/B experiment'}).click();
  await expect(page.locator('#execution-progress')).toContainText('completed',{timeout:15000});
});

test('workspace hierarchy is accessible and stays inside desktop, tablet and phone viewports',async({page,request,driveOrigin})=>{
  await installTask(request,driveOrigin);await maps(page);
  await page.goto(`${driveOrigin}/drive-test/?region=toronto&project=northyork&task=${task.id}`);
  await expect(page.getByRole('button',{name:'Run A/B experiment'})).toBeEnabled();
  for(const width of [1440,1280,768,390,320]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
  }
  await page.setViewportSize({width:1280,height:900});
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);
  const output=process.env.NDT_DM_EVIDENCE_DIR||'/private/tmp/ndt-dm-evidence';await mkdir(output,{recursive:true});
  await page.screenshot({path:path.join(output,'setup-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(output,'setup-mobile.png'),fullPage:true});
});
