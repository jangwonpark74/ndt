const {test,expect,installTask,maps}=require('./drive-fixture.cjs');
const fs=require('node:fs/promises');
const path=require('node:path');
const AxeBuilder=require('@axe-core/playwright').default;
test('an applied qualified scenario drives frozen directional pairs, reports and exports',async({page,request,driveOrigin,browserName})=>{
 test.setTimeout(60000);
 await installTask(request,driveOrigin);
 const task=(await(await request.get(driveOrigin+'/api/dm/catalog')).json()).tasks.find(t=>t.task_id==='MERGE-TEST');
 const scope='/api/regions/toronto/projects/northyork';
 const inventory=JSON.parse(await fs.readFile(path.join(__dirname,'../fixtures/equipment-example.json'),'utf8'));inventory.sites[0].inventorySiteId=task.transmitters[0].site_id;
 const raw='\ufeff'+JSON.stringify(inventory),preview=await(await request.post(driveOrigin+scope+'/equipment-inventory',{data:{raw}})).json();
 expect((await request.put(driveOrigin+scope+'/equipment-inventory',{data:{raw,expectedRevision:0,sourceFingerprint:preview.sourceFingerprint}})).ok()).toBe(true);
 const template={rat:'NR',frequencyMHz:3600,bandwidthMHz:100,powerDbm:40,gainDbi:8,lossDb:2,azimuthDeg:0,tiltDeg:6,pattern:'element',mode:'NLOS',carrier:{standard:'3gpp-rel18-carrier-subset-v1',band:'n78',channel:640000,scsKHz:30}};
 for(const [action,expectedRevision]of [['save',0],['apply',1]])expect((await request.put(driveOrigin+scope+'/radio-scenarios',{data:{id:'route-study',name:'Route scenario',action,expectedRevision,template,overrides:{}}})).ok()).toBe(true);
 await maps(page);await page.goto(driveOrigin+'/drive-test/?region=toronto&project=northyork&task=MERGE-TEST');
 await page.getByRole('combobox',{name:'Radio scenario',exact:true}).selectOption('route-study');
 await expect(page.locator('#execution-scenario-status')).toContainText('Applied revision 1');await expect(page.locator('#execution-power-a')).toBeDisabled();await expect(page.locator('#execution-mode')).toBeDisabled();await expect(page.locator('#execution-power-b')).toHaveValue('46');
 await page.locator('#execution-submit').click();await expect(page.locator('#execution-progress')).toContainText('completed',{timeout:20000});
 const history=await(await request.get(driveOrigin+'/api/dm/experiments')).json(),result=await(await request.get(driveOrigin+'/api/dm/experiments/'+history[0].id)).json();
 expect(result.snapshot.radioScenario.revision).toBe(1);expect(result.snapshot.inventorySnapshot.operatorEquipment.raw).toBe(raw);expect(result.comparisons).toHaveLength(3);expect(result.comparisons.every(c=>Number.isFinite(c.median_delta_db) && Math.abs(c.median_delta_db)<1e-9)).toBe(true);
 await expect(page.locator('#execution-results')).toContainText('Route scenario');await expect(page.locator('#execution-results')).toContainText('revision 1');
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export experiment JSON',exact:true}).click();const exported=JSON.parse(await fs.readFile(await(await downloading).path(),'utf8'));expect(exported.snapshot.inventorySnapshot.operatorEquipment.raw).toBe(raw);
 await page.locator('#setup-open').click();await page.locator('#execution-power-b').fill('49');await page.locator('#execution-interval').focus();await expect(page.locator('#execution-results-state')).toContainText('Setup differs');
 await page.getByRole('button',{name:'Test report',exact:true}).click();await expect(page.locator('#report')).toContainText('Frozen directional templates');await expect(page.locator('#report')).toContainText('Route scenario / revision 1');
 if(browserName==='chromium')await page.pdf({path:'.cache/planning-docs/scenario-run-report.pdf',printBackground:true,preferCSSPageSize:true});
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.setViewportSize({width:390,height:844});await page.locator('#execution-scenario-status').scrollIntoViewIfNeeded();await page.screenshot({path:'.cache/planning-docs/scenario-run-phone.png'});
});
