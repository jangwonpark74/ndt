const {test, expect} = require('@playwright/test');

test('region dropdown switches regions and is keyboard focusable', async ({page}) => {
  await page.route('https://tiles.openfreemap.org/styles/liberty', route => route.fulfill({json:{version:8,sources:{openmaptiles:{type:'vector',tiles:['http://127.0.0.1:5189/empty/{z}/{x}/{y}.pbf']}},layers:[{id:'background',type:'background',paint:{'background-color':'#d5e1dc'}}]}}));
  await page.route('**/empty/**', route => route.fulfill({status:204}));
  await page.route('https://tiles.mapterhorn.com/**', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({timeout:20000});
  const region = page.getByLabel('REGION');
  await expect(region.locator('option').nth(0)).toHaveText('Toronto');
  await expect(region.locator('option').nth(1)).toHaveText('New York City');
  await expect(region).toHaveValue('toronto');
  await region.selectOption('new-york');
  await expect(page).toHaveURL(/region=new-york/);
  await expect(page.locator('#nyc-status')).toContainText('701 in the NYC snapshot', {timeout:20000});
  await expect(region).toHaveValue('new-york');
  await page.getByRole('button', {name:'Search locations'}).focus();
  await page.keyboard.press('Tab');
  await expect(region).toBeFocused();
  await region.selectOption('toronto');
  await expect(page).toHaveURL(/region=toronto/);
  await expect(page.locator('#network-status')).toContainText('In view:', {timeout:20000});
});
