const {test,expect}=require('@playwright/test');
const {maps}=require('./drive-fixture.cjs');
const fs=require('node:fs/promises');
const AxeBuilder=require('@axe-core/playwright').default;

test('carrier checks guide a valid channel, reject incompatible inputs and retain qualification on reload/export',async({page})=>{
 await maps(page);await page.goto('/');await expect(page.locator('#network-list button').first()).toBeVisible({timeout:20000});
 await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('northyork');await page.locator('#network-tab').click();await page.getByText('Radio and antenna study',{exact:true}).click();
 await expect(page.locator('#scenario-new')).toBeEnabled();await page.locator('#scenario-new').click();await page.getByLabel('Scenario name',{exact:true}).fill('Qualified carrier study');await page.locator('#template-preset').selectOption('nr');
 await page.getByText('Carrier channel checks',{exact:true}).click();await page.getByLabel('Check a supported 3GPP carrier').check();
 await page.getByRole('combobox',{name:'Operating band',exact:true}).selectOption('n78');
 const channel=page.getByLabel('Downlink channel number',{exact:true});await channel.fill('640001');
 await expect(page.locator('#carrier-check-status')).toContainText('channel raster');await expect(page.locator('#template-save')).toBeDisabled();
 await channel.fill('620000');await expect(page.locator('#carrier-check-status')).toContainText('band edge');
 await channel.fill('640000');await expect(page.locator('#carrier-check-status')).toContainText('Channel checks passed');await expect(page.locator('[name=frequencyMHz]')).toHaveValue('3600');
 await page.locator('[name=bandwidthMHz]').fill('35');await expect(page.locator('#carrier-check-status')).toContainText('bandwidth');await expect(page.locator('#template-export')).toBeDisabled();
 await page.locator('[name=bandwidthMHz]').fill('100');await page.locator('#template-save').click();await expect(page.locator('#scenario-state')).toContainText('Draft revision 1');
 const downloading=page.waitForEvent('download');await page.locator('#template-export').click();const exported=JSON.parse(await fs.readFile(await(await downloading).path(),'utf8'));
 expect(exported.template.carrier).toEqual({standard:'3gpp-rel18-carrier-subset-v1',band:'n78',channel:640000,scsKHz:30});expect(exported.carrierQualification).toContain('TS 38.104');
 await page.reload();await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('northyork');await page.locator('#network-tab').click();await page.getByText('Radio and antenna study',{exact:true}).click();await page.locator('#scenario-picker').selectOption({label:'Qualified carrier study'});await page.getByText('Carrier channel checks',{exact:true}).click();
 await expect(page.getByLabel('Check a supported 3GPP carrier')).toBeChecked();await expect(channel).toHaveValue('640000');await expect(page.locator('#carrier-check-status')).toContainText('n78');
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:'.cache/planning-docs/carrier-desktop.png'});
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.setViewportSize({width:390,height:844});await page.locator('#carrier-controls').scrollIntoViewIfNeeded();await page.screenshot({path:'.cache/planning-docs/carrier-phone.png'});
 await channel.fill('640001');await expect(page.locator('#carrier-check-status')).toContainText('channel raster');await page.locator('#carrier-check-status').scrollIntoViewIfNeeded();await page.screenshot({path:'.cache/planning-docs/carrier-error-phone.png'});
 await page.locator('#template-preset').selectOption('lte');await expect(page.getByLabel('Check a supported 3GPP carrier')).not.toBeChecked();await page.getByLabel('Check a supported 3GPP carrier').check();
 await expect(page.locator('[name=frequencyMHz]')).toHaveValue('2140');await expect(page.locator('#carrier-check-status')).toContainText('B4 · FDD');await expect(page.locator('#template-save')).toBeEnabled();
});
