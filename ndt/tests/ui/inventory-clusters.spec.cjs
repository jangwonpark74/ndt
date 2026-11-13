const {test,expect,maps}=require('./drive-fixture.cjs');
const AxeBuilder=require('@axe-core/playwright').default;
test('named inventory clusters save, filter, label and synchronize site review with the map',async({page,driveOrigin})=>{
 await maps(page);await page.goto(driveOrigin+'/');
 await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('harbourfront');await page.locator('#overview-open').click();
 await expect(page.getByRole('heading',{name:'Site inventory and clusters',exact:true})).toBeVisible();
 await page.getByText('Manage inventory clusters',{exact:true}).click();await page.getByLabel('New inventory cluster name',{exact:true}).fill('Downtown review');await page.getByRole('button',{name:'Create inventory cluster',exact:true}).click();
 await page.getByLabel('Search site inventory',{exact:true}).fill('5205 Timberlea Boulevard');
 await expect(page.locator('#inventory-rows tr')).toHaveCount(1);
 await page.getByRole('button',{name:'Add to selected cluster',exact:true}).click();await page.getByRole('button',{name:'Save inventory groups',exact:true}).click();
 await expect(page.locator('#inventory-group-status')).toContainText('Saved revision 1');
 await page.getByRole('combobox',{name:'Inventory scope',exact:true}).selectOption('cluster');await expect(page.locator('#inventory-count')).toContainText('1 matching');
 await page.locator('#inventory-rows [data-review]').click();await expect(page.locator('#network-detail')).toContainText('Bell W2539');await expect(page.locator('#network-detail')).toContainText('Downtown review');await expect(page.locator('#project-overview')).toBeHidden();
 await expect(page.locator('.inventory-cluster-label')).toContainText('Downtown review');
 await page.locator('#overview-open').click();await expect(page.locator('#inventory-rows tr[aria-current=true]')).toHaveCount(1);
 await page.getByLabel('Selected inventory cluster name',{exact:true}).fill('Renamed review');await page.getByRole('button',{name:'Rename inventory cluster',exact:true}).click();await page.getByRole('button',{name:'Save inventory groups',exact:true}).click();await expect(page.locator('#inventory-group-status')).toContainText('Saved revision 2');
 await page.reload();await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('harbourfront');await page.locator('#overview-open').click();await page.getByRole('combobox',{name:'Inventory cluster',exact:true}).selectOption({label:'Renamed review (1)'});await page.getByRole('combobox',{name:'Inventory scope',exact:true}).selectOption('cluster');await expect(page.locator('#inventory-rows tr')).toHaveCount(1);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.setViewportSize({width:390,height:844});await page.locator('#inventory-review').scrollIntoViewIfNeeded();await page.screenshot({path:'.cache/planning-docs/inventory-cluster-phone.png'});
});
test('inventory membership is usable by touch and conflicts preserve cluster drafts',async({page,request,driveOrigin})=>{
 await maps(page);await page.setViewportSize({width:390,height:844});await page.goto(driveOrigin+'/');await page.getByRole('button',{name:'Open map navigation'}).click();await page.getByRole('combobox',{name:'Project',exact:true}).selectOption('harbourfront');await page.getByRole('button',{name:'Open map navigation'}).click();await page.locator('#overview-open').click();
 await page.getByRole('combobox',{name:'Inventory scope',exact:true}).selectOption('members');const first=page.locator('#inventory-rows tr').first(),label=await first.locator('[data-review]').innerText();await first.getByRole('button',{name:'Remove from planning project',exact:true}).focus();await first.getByRole('button',{name:'Remove from planning project',exact:true}).press('Enter');await expect(page.locator('#inventory-rows [data-review]').filter({hasText:label})).toHaveCount(0);await expect(page.locator('#inventory-rows [data-review]').first()).toBeFocused();
 await page.getByRole('combobox',{name:'Inventory scope',exact:true}).selectOption('all');await page.getByLabel('Search site inventory',{exact:true}).fill(label);await page.getByRole('button',{name:'Add to planning project',exact:true}).click();await page.getByRole('combobox',{name:'Inventory scope',exact:true}).selectOption('members');await expect(page.locator('#inventory-rows tr')).toHaveCount(1);
 await page.getByText('Manage inventory clusters',{exact:true}).click();await page.getByLabel('New inventory cluster name',{exact:true}).fill('Retained draft');await page.getByRole('button',{name:'Create inventory cluster',exact:true}).click();
 const url=driveOrigin+'/api/regions/toronto/projects/harbourfront/inventory-clusters',saved=await(await request.get(url)).json();expect((await request.put(url,{data:{expectedRevision:saved.revision,sourceFingerprint:saved.currentSourceFingerprint,clusters:[{id:'remote',name:'Other planner',siteIds:[]}]}})).ok()).toBe(true);
 await page.getByRole('button',{name:'Save inventory groups',exact:true}).click();await expect(page.locator('#inventory-group-error')).toContainText('changed');await expect(page.getByRole('combobox',{name:'Inventory cluster',exact:true})).toContainText('Retained draft');
 await page.getByRole('button',{name:'Reload saved groups',exact:true}).click();await expect(page.getByRole('combobox',{name:'Inventory cluster',exact:true})).toContainText('Retained draft');await page.getByRole('button',{name:'Use saved groups',exact:true}).click();await expect(page.getByRole('combobox',{name:'Inventory cluster',exact:true})).toContainText('Other planner');
});
