const {test,expect,maps}=require('./drive-fixture.cjs');
test('a late file decode failure cannot cancel a new project inventory load',async({page,driveOrigin})=>{
 await page.addInitScript(()=>{const original=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){return this.name==='delayed.json'?new Promise((resolve,reject)=>window.rejectOldEquipmentFile=()=>reject(new TypeError('Invalid UTF-8'))):original.call(this);};});
 await maps(page);await page.goto(driveOrigin+'/');await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('harbourfront');await page.locator('#network-tab').click();await page.getByText('Equipment inventory imports',{exact:true}).click();
 await expect(page.locator('#equipment-file')).toBeEnabled();await page.locator('#equipment-file').setInputFiles({name:'delayed.json',mimeType:'application/json',buffer:Buffer.from('{}')});await expect.poll(()=>page.evaluate(()=>!!window.rejectOldEquipmentFile)).toBe(true);
 await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('northyork');await page.locator('#network-tab').click();await expect(page.locator('#equipment-file')).toBeEnabled();await page.evaluate(()=>window.rejectOldEquipmentFile());await expect(page.locator('#equipment-error')).toBeHidden();await expect(page.locator('#equipment-file')).toBeEnabled();
});
test('an unreadable replacement cannot re-preview the previous file',async({page,driveOrigin})=>{
 await maps(page);await page.goto(driveOrigin+'/');await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('harbourfront');await page.locator('#network-tab').click();await page.getByText('Equipment inventory imports',{exact:true}).click();await expect(page.locator('#equipment-file')).toBeEnabled();
 await page.locator('#equipment-file').setInputFiles({name:'first.json',mimeType:'application/json',buffer:Buffer.from('{}')});await expect(page.locator('#equipment-error')).toBeVisible();await expect(page.locator('#equipment-repreview')).toBeEnabled();
 await page.locator('#equipment-file').setInputFiles({name:'unreadable.json',mimeType:'application/json',buffer:Buffer.from([255])});await expect(page.locator('#equipment-error')).toContainText('UTF-8');await expect(page.locator('#equipment-repreview')).toBeDisabled();
});
