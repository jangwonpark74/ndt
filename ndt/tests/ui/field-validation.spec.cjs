const {test,expect,maps}=require('./drive-fixture.cjs');
const {execFileSync}=require('node:child_process');
const {fixturePython}=require('./fixture-python.cjs');
const fs=require('node:fs/promises'),path=require('node:path');
const AxeBuilder=require('@axe-core/playwright').default;
test.use({fieldData:true});
function contract(rat,large=false){
 const code="import importlib.util,json;from pathlib import Path;p=Path('tests/fixtures/field-inputs.py');s=importlib.util.spec_from_file_location('field_browser_inputs',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);a,b,d,o="+(large?'m.large_inputs()':"m.multisite_inputs('"+rat+"')")+";print(json.dumps(dict(descriptor=d,options=o)))";
 return JSON.parse(execFileSync(fixturePython(),['-X','utf8','-B','-c',code],{cwd:path.join(__dirname,'../..'),encoding:'utf8'}));
}
async function enter(page,origin,rat='NR'){
 await maps(page);await page.goto(origin+'/drive-test/?region=toronto&project=field-software-test&task=fixture-'+rat+'&test=FIELD-FIXTURE-'+rat);
 await expect(page.locator('#test-id')).toHaveText('FIELD-FIXTURE-'+rat);await page.getByRole('button',{name:'Field validation',exact:true}).click();
 await page.getByRole('combobox',{name:'Operator capture',exact:true}).selectOption('FIELD-FIXTURE-'+rat);await page.getByRole('combobox',{name:'Frozen source-cell run',exact:true}).selectOption('FIELD-MODEL-'+rat);
 await expect(page.getByRole('button',{name:'Download measurement template',exact:true})).toBeEnabled();
}
async function upload(page,descriptor,name='declared-software-contract.json'){
 await page.getByLabel('Measurement descriptor JSON',{exact:true}).setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(descriptor))});
 await page.getByRole('button',{name:'Check compatibility',exact:true}).click();
}
async function split(page,options){
 await page.getByLabel('Split cutoff (UTC ISO 8601)',{exact:true}).fill(new Date(options.cutoffT).toISOString());
 await page.getByLabel('Time gap on each side (s)',{exact:true}).fill('0');
 for(const id of options.heldoutSites){const checkbox=page.locator('#field-sites input[value="'+id+'"]');await checkbox.focus();await checkbox.press('Space');await expect(checkbox).toBeChecked();await expect(checkbox).toBeFocused();}
}
for(const rat of ['NR','LTE'])test(`${rat} declared measurements run a frozen holdout study and export traceable results`,async({page,driveOrigin,browserName})=>{
 test.setTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));const data=contract(rat);await enter(page,driveOrigin,rat);
 await page.locator('.skip-link').focus();await page.locator('.skip-link').press('Enter');await expect(page.locator('#field-heading')).toBeFocused();
 await expect(page.locator('#execution-panel')).toBeHidden();await expect(page.locator('#run-heading')).toBeHidden();await expect(page.locator('#field-scope')).toContainText('Software field-workflow fixture');
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download measurement template',exact:true}).click();const draft=JSON.parse(await fs.readFile(await(await pending).path(),'utf8'));
 expect(draft.provenance.origin).toBe('unknown');expect(draft.configuration.matched).toBe(false);expect(draft.instrument.calibrationRecordId).toBe('');
 await upload(page,data.descriptor);await expect(page.locator('#field-compatibility')).toContainText('Declared inputs are compatible');await expect(page.locator('#field-file-state')).toContainText('Declared compatible');await split(page,data.options);
 if(browserName==='chromium'&&rat==='NR'){for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.locator('#field-validation > .field-panel').nth(0).screenshot({path:`test-results/field-evidence-${width}.png`});await page.locator('#field-validation > .field-panel').nth(1).screenshot({path:`test-results/field-split-${width}.png`});}await page.setViewportSize({width:1440,height:900});}
 await expect(page.getByRole('button',{name:'Run field study',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Run field study',exact:true}).click();await expect(page.locator('#field-result-status')).toHaveText('Holdout diagnostic complete',{timeout:20000});
 await expect(page.locator('#field-cards')).toContainText('+3.00 dB');await expect(page.locator('#field-metrics')).toContainText('6.00');await expect(page.locator('#field-metrics')).toContainText('3.00');await expect(page.locator('#field-records tbody tr')).toHaveCount(50);
 await page.getByRole('button',{name:'Next study rows',exact:true}).click();await expect(page.locator('#field-page')).toContainText('51–100');
 await page.getByRole('combobox',{name:'Saved study records',exact:true}).selectOption('observations');await expect(page.locator('#field-records')).toContainText('Eligible');
 const exported=page.waitForEvent('download');await page.getByRole('button',{name:'Export field study',exact:true}).click();const result=JSON.parse(await fs.readFile(await(await exported).path(),'utf8'));
 expect(result.result.independentlyVerified).toBe(false);expect(result.result.observations).toHaveLength(128);expect(result.snapshot.descriptorRaw).toBe(JSON.stringify(data.descriptor));expect(result.result.calibration.offsetDb).toBeCloseTo(3,8);expect(result.result.replay.maxAbsoluteError).toBeLessThan(1e-7);
 await page.getByLabel('Time gap on each side (s)',{exact:true}).fill('1');await expect(page.locator('#field-stale')).toBeVisible();
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect.poll(()=>page.locator('#field-metrics .table-wrap').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);if(width===320){const region=page.locator('#field-records .table-wrap');await region.focus();await region.press('ArrowRight');await expect.poll(()=>region.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);expect(await page.locator('.skip-link').evaluate(e=>e.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);}if(browserName==='chromium'&&rat==='NR'&&[390,1440].includes(width)){await page.locator('#field-records .table-wrap').evaluate(e=>e.scrollLeft=0);await page.locator('#field-output').evaluate(e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:`test-results/field-output-${width}.png`});await page.locator('.field-records').evaluate(e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:`test-results/field-records-${width}.png`});}}
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);expect(errors).toEqual([]);
 const studyId=result.id;await page.reload();await expect(page.locator('#test-id')).toHaveText('FIELD-FIXTURE-'+rat);await page.getByRole('button',{name:'Field validation',exact:true}).click();await page.getByText('Saved field studies',{exact:true}).click();await expect(page.locator('#field-history')).toContainText(studyId);await page.locator('[data-study="'+studyId+'"]').click();await expect(page.locator('#field-result-status')).toHaveText('Holdout diagnostic complete');
});
test('RSRP, incomplete declarations and invalid descriptors explain why fitting is unavailable',async({page,driveOrigin})=>{
 const data=contract('NR');await enter(page,driveOrigin);
 await upload(page,{...data.descriptor,measurement:{...data.descriptor.measurement,quantity:'nr-ss-rsrp',column:'rsrp_dbm'}});
 await expect(page.locator('#field-issues')).toContainText('not LTE/NR reference-element RSRP');await split(page,data.options);await expect(page.getByRole('button',{name:'Run field study',exact:true})).toBeDisabled();
 await upload(page,{...data.descriptor,configuration:{...data.descriptor.configuration,matched:false},provenance:{...data.descriptor.provenance,origin:'unknown'}});
 await expect(page.locator('#field-issues')).toContainText('Explicitly attest');await expect(page.getByRole('button',{name:'Run field study',exact:true})).toBeDisabled();
 await page.getByLabel('Measurement descriptor JSON',{exact:true}).setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{')});await page.getByRole('button',{name:'Check compatibility',exact:true}).click();await expect(page.locator('#field-error')).toContainText('not valid');
 await page.getByLabel('Measurement descriptor JSON',{exact:true}).setInputFiles({name:'large.json',mimeType:'application/json',buffer:Buffer.alloc(131073,32)});await expect(page.locator('#field-error')).toContainText('128 KiB');
 await page.getByRole('button',{name:'Replay',exact:true}).click();await expect(page.locator('#sample-details .metric-pair span').first()).toHaveText('Measured carrier power');await page.getByRole('combobox',{name:'Metric',exact:true}).selectOption('rsrq_db');await expect(page.locator('#sample-details .metric-pair span').first()).toHaveText('RSRQ');await expect(page.locator('#sample-details')).toContainText('Measurement quality');
});
test('late compatibility responses cannot mark a newly uploaded descriptor as compatible',async({page,driveOrigin})=>{
 const data=contract('NR');await enter(page,driveOrigin);let release,entered;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 await page.route('**/api/dm/field-studies/check',async route=>{const response=await route.fetch();entered();await held;await route.fulfill({response}).catch(()=>{});});
 await page.getByLabel('Measurement descriptor JSON',{exact:true}).setInputFiles({name:'first.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data.descriptor))});await page.getByRole('button',{name:'Check compatibility',exact:true}).click();await started;
 await page.getByLabel('Measurement descriptor JSON',{exact:true}).setInputFiles({name:'replacement.json',mimeType:'application/json',buffer:Buffer.from('{')});release();
 await expect(page.locator('#field-file-state')).toContainText('replacement.json');await expect(page.locator('#field-compatibility')).not.toContainText('Declared inputs are compatible');await expect(page.getByRole('button',{name:'Run field study',exact:true})).toBeDisabled();
});

test('field job cancellation is explicit and service failures remain retryable',async({page,driveOrigin})=>{
 const data=contract('NR');await enter(page,driveOrigin);await upload(page,data.descriptor);await expect(page.locator('#field-compatibility')).toContainText('Declared inputs are compatible');await split(page,data.options);
 let submitted,cancelled=false;
 await page.route('**/api/dm/field-studies',async route=>{if(route.request().method()!=='POST')return route.continue();submitted=route.request().postDataJSON();await route.fulfill({json:{id:'FIELD-MOCK-CANCEL',status:'queued',progress:0,spec:submitted.spec,result:null,error:''}});});
 await page.route('**/api/dm/field-studies/FIELD-MOCK-CANCEL',route=>route.fulfill({json:{id:'FIELD-MOCK-CANCEL',status:cancelled?'cancelled':'running',progress:25,spec:submitted.spec,result:null,error:''}}));
 await page.route('**/api/dm/field-studies/FIELD-MOCK-CANCEL/cancel',route=>{cancelled=true;return route.fulfill({json:{id:'FIELD-MOCK-CANCEL',status:'cancelled',progress:25,spec:submitted.spec,result:null,error:''}});});
 await page.getByRole('button',{name:'Run field study',exact:true}).click();await expect(page.getByRole('button',{name:'Cancel field study',exact:true})).toBeVisible();await page.getByRole('button',{name:'Cancel field study',exact:true}).click();await expect(page.locator('#field-progress')).toContainText('cancelled');await expect(page.locator('#field-output')).toBeHidden();expect(cancelled).toBe(true);expect(submitted.spec.options.heldoutSites).toEqual(['SITE-2','SITE-3']);
 await page.route('**/api/dm/field-studies/check',route=>route.fulfill({status:503,json:{error:'Controlled unavailable field storage'}}));await page.getByRole('button',{name:'Check compatibility',exact:true}).click();await expect(page.locator('#field-error')).toContainText('Controlled unavailable');await expect(page.getByRole('button',{name:'Run field study',exact:true})).toBeDisabled();await page.unroute('**/api/dm/field-studies/check');await page.getByRole('button',{name:'Check compatibility',exact:true}).click();await expect(page.locator('#field-compatibility')).toContainText('Declared inputs are compatible');
 await page.unroute('**/api/dm/field-studies');let rowRequests=0;
 await page.route('**/api/dm/field-studies/*/records?*',route=>{rowRequests++;return rowRequests===1?route.fulfill({status:503,json:{error:'Controlled field rows unavailable'}}):route.continue();});
 await page.getByRole('button',{name:'Run field study',exact:true}).click();await expect(page.locator('#field-result-status')).toHaveText('Holdout diagnostic complete',{timeout:20000});await expect(page.locator('#field-error')).toContainText('Controlled field rows unavailable');
 await page.getByRole('button',{name:'Replay',exact:true}).click();await page.getByRole('button',{name:'Field validation',exact:true}).click();await expect(page.locator('#field-error')).toContainText('Controlled field rows unavailable');expect(rowRequests).toBe(1);
 await page.getByRole('button',{name:'Reload study rows',exact:true}).click();await expect(page.locator('#field-records tbody tr')).toHaveCount(50);await expect(page.locator('#field-error')).toBeHidden();expect(rowRequests).toBe(2);
});

test.describe('maximum field capture',()=>{
 test.use({fieldData:'large'});
 test('100000 observations stay responsive with bounded page reads and complete export',async({page,driveOrigin})=>{
  test.setTimeout(150000);const data=contract('NR',true);await enter(page,driveOrigin);await page.getByRole('combobox',{name:'Operator capture',exact:true}).selectOption('FIELD-FIXTURE-LARGE');await expect(page.getByRole('button',{name:'Download measurement template',exact:true})).toBeEnabled();await upload(page,data.descriptor);await expect(page.locator('#field-compatibility')).toContainText('Declared inputs are compatible');await split(page,data.options);
  const summaries=[];page.on('response',async response=>{if(/\/api\/dm\/field-studies\/FIELD-[^/?]+$/.test(response.url()))summaries.push(await response.text());});
  await page.evaluate(()=>{globalThis.fieldTicks=0;globalThis.fieldTimer=setInterval(()=>globalThis.fieldTicks++,20);});await page.getByRole('button',{name:'Run field study',exact:true}).click();await expect(page.locator('#field-result-status')).toHaveText('Holdout diagnostic complete',{timeout:60000});expect(await page.evaluate(()=>globalThis.fieldTicks)).toBeGreaterThan(10);await page.evaluate(()=>clearInterval(globalThis.fieldTimer));
  await page.getByRole('combobox',{name:'Saved study records',exact:true}).selectOption('observations');await expect(page.locator('#field-page')).toContainText('of 100,000');await expect(page.locator('#field-records tbody tr')).toHaveCount(50);
  expect(summaries.length).toBeGreaterThan(0);expect(summaries.every(s=>Buffer.byteLength(s)<20000&&!s.includes('"observations":['))).toBe(true);
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export field study',exact:true}).click();const result=JSON.parse(await fs.readFile(await(await pending).path(),'utf8'));expect(result.result.observations).toHaveLength(100000);expect(result.snapshot.capture.rows).toHaveLength(100000);expect(result.result.calibration.bins).toHaveLength(128);expect(result.result.calibration.offsetDb).toBeCloseTo(3,8);expect(result.result.calibration.holdout.adjusted.rmseDb).toBeCloseTo(3,8);
 });
});
