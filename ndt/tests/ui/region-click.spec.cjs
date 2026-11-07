const {test, expect} = require('@playwright/test');

test('region selector is operable by pointer and keyboard', async ({page}) => {
  await page.route('https://tiles.openfreemap.org/styles/liberty', route => route.fulfill({json:{version:8,sources:{openmaptiles:{type:'vector',tiles:['http://127.0.0.1:5189/empty/{z}/{x}/{y}.pbf']}},layers:[{id:'background',type:'background',paint:{'background-color':'#d5e1dc'}}]}}));
  await page.route('**/empty/**', route => route.fulfill({status:204}));
  await page.route('https://tiles.mapterhorn.com/**', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({timeout:20000});
  await page.getByRole('button', {name:'New York City region'}).click();
  await expect(page).toHaveURL(/region=new-york/);
  await expect(page.locator('#nyc-status')).toContainText('701 in the NYC snapshot', {timeout:20000});
  const toronto = page.getByRole('button', {name:'Toronto region'});
  await toronto.focus();
  await toronto.press('Enter');
  await expect(page).toHaveURL(/region=toronto/);
  await expect(page.locator('#network-status')).toContainText('In view:', {timeout:20000});
});
