const {test,expect,installTask,maps}=require('./drive-fixture.cjs');
const AxeBuilder=require('@axe-core/playwright').default;
const fs=require('node:fs/promises');
const geometry={rows:4,columns:4,verticalSpacing:.5,horizontalSpacing:.5,steerAzimuthDeg:0,steerDowntiltDeg:0};

test('array geometry validates, survives saved revisions and stays usable on phones',async({page,driveOrigin})=>{
 test.setTimeout(60000);await maps(page);await page.goto(driveOrigin+'/');
 await expect(page.locator('#network-list button').first()).toBeVisible({timeout:20000});
 await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('northyork');
 await page.locator('#network-tab').click();await page.getByText('Radio and antenna study',{exact:true}).click();
 await expect(page.locator('#scenario-new')).toBeEnabled();await page.locator('#scenario-new').click();
 await page.getByLabel('Scenario name',{exact:true}).fill('Explicit array study');
 await page.locator('#template-preset').selectOption('nr');await page.locator('[name=pattern]').selectOption('array');
 await expect(page.locator('#array-controls')).toBeVisible();await expect(page.locator('#template-result')).toContainText('EIRP upper bound');
 await page.getByLabel('Array columns',{exact:true}).fill('4.5');await expect(page.locator('#template-save')).toBeDisabled();
 await page.getByLabel('Array columns',{exact:true}).fill('8');await page.getByLabel('Electrical azimuth offset (degrees)',{exact:true}).fill('20');
 await page.getByRole('button',{name:'Save study',exact:true}).click();await expect(page.locator('#scenario-state')).toContainText('Draft revision 1');
 await page.reload();await expect(page.locator('#loading')).toBeHidden({timeout:20000});
 await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('northyork');await page.locator('#network-tab').click();await page.getByText('Radio and antenna study',{exact:true}).click();
 await page.locator('#scenario-picker').selectOption({label:'Explicit array study'});await expect(page.getByLabel('Array columns',{exact:true})).toHaveValue('8');
 await expect(page.getByLabel('Electrical azimuth offset (degrees)',{exact:true})).toHaveValue('20');
 const pending=page.waitForEvent('download');await page.locator('#template-export').click();const exported=JSON.parse(await fs.readFile(await(await pending).path(),'utf8'));
 expect(exported.template.array.columns).toBe(8);expect(exported.powerConvention).toContain('shared');expect(exported.arrayAssumptions.nullFloorDb).toBe(120);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.setViewportSize({width:390,height:844});await page.locator('#array-controls').scrollIntoViewIfNeeded();await page.screenshot({path:'.cache/planning-docs/array-phone.png'});
 await page.locator('[name=pattern]').selectOption('element');await expect(page.locator('#array-controls')).toBeHidden();await expect(page.locator('#template-save')).toBeEnabled();
});

test('array baseline comparison exports frozen geometry and readable report inputs',async({page,request,driveOrigin,browserName})=>{
 test.setTimeout(60000);await installTask(request,driveOrigin);
 const url=driveOrigin+'/api/regions/toronto/projects/northyork/radio-scenarios';
 const template={rat:'NR',frequencyMHz:3600,bandwidthMHz:100,powerDbm:40,gainDbi:8,lossDb:2,azimuthDeg:180,tiltDeg:6,pattern:'element',mode:'NLOS',carrier:{standard:'3gpp-rel18-carrier-subset-v1',band:'n78',channel:640000,scsKHz:30}};
 for(const [action,expectedRevision,array]of [['save',0,false],['baseline',1,false],['save',1,true],['apply',2,true]])expect((await request.put(url,{data:{id:'array-revisions',name:'Array comparison',action,expectedRevision,template:array?{...template,pattern:'array',array:geometry}:template,overrides:{}}})).ok()).toBe(true);
 await maps(page);await page.goto(driveOrigin+'/drive-test/?region=toronto&project=northyork&task=MERGE-TEST');await page.getByRole('combobox',{name:'Radio scenario',exact:true}).selectOption('array-revisions');
 await expect(page.locator('#execution-scenario-status')).toContainText('58.0 dBm');
 await page.locator('#execution-type').selectOption('scenario-ab');
 await page.getByRole('button',{name:'Run scenario comparison',exact:true}).click();await expect(page.locator('#execution-progress')).toContainText('completed',{timeout:20000});
 const history=await(await request.get(driveOrigin+'/api/dm/experiments')).json(),result=await(await request.get(driveOrigin+'/api/dm/experiments/'+history[0].id)).json();
 expect(result.snapshot.predictionModel).toBe('uma-uniform-panel-fixed-heights-v3');expect(result.snapshot.arrayAssumptions.nullFloorDb).toBe(120);expect(result.snapshot.radioScenario.payload.template.array).toEqual(geometry);expect(result.comparisons).toHaveLength(3);
 await page.getByText('Changed template inputs',{exact:true}).click();await expect(page.locator('#execution-results')).toContainText('Array geometry / steering');await expect(page.locator('#execution-results')).toContainText('4 × 4');await expect(page.locator('#execution-results')).not.toContainText('[object Object]');
 // Completion opens B; verify its identity before reviewing the report.
 await expect(page.locator('#test-id')).toHaveText(result.runs.find(r=>r.variant==='B').test_id);
 await page.getByRole('button',{name:'Test report',exact:true}).click();await expect(page.locator('#report')).toContainText('4 × 4');await expect(page.locator('#report')).toContainText('120 dB');
 await expect(page.locator('#report')).not.toContainText('\uFFFD');
 if(browserName==='chromium')await page.pdf({path:'.cache/planning-docs/array-report.pdf',printBackground:true,preferCSSPageSize:true});
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
});
