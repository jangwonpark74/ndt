const {fixturePython}=require('./fixture-python.cjs');
const {test: base, expect} = require('@playwright/test');
const {AxeBuilder} = require('@axe-core/playwright');
const {spawn} = require('node:child_process');
const {mkdtemp, rm, readFile, mkdir, writeFile} = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const {stopFixture} = require('./process-cleanup.cjs');

const test = base.extend({
  dmURL: async ({}, use) => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'dm-review-'));
    const server = spawn(fixturePython(), ['-B', 'tests/fixtures/serve-drive-fixture.py', '--port', '0', '--db', path.join(temp, 'planning.sqlite3'), '--dm-db', path.join(temp, 'runs.sqlite3')],
      {cwd: path.join(__dirname, '../..'), stdio: ['ignore', 'pipe', 'inherit']});
    try {
      const url = await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.once('exit', code => reject(new Error(`DM server exited: ${code}`)));
        const lines = readline.createInterface({input: server.stdout});
        lines.once('line', line => { lines.close(); resolve(line.match(/http:\/\/[^ ]+/)[0]+'/drive-test/'); });
      });
      await use(url);
    } finally {
      await stopFixture(server);
      await rm(temp, {recursive: true, force: true});
    }
  },
});

async function capture(page, name) {
  if (!process.env.DM_REVIEW_OUTPUT) return;
  await mkdir(process.env.DM_REVIEW_OUTPUT, {recursive: true});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path: path.join(process.env.DM_REVIEW_OUTPUT, name), fullPage: true});
}

test('saved acceptance profiles, CDF, sample investigations and reproducible export', async ({page, dmURL}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(dmURL);
  await expect(page.locator('#run-title')).toHaveText('Tuning verification');
  await page.getByRole('button', {name: 'Thresholds', exact: true}).click();
  await page.getByLabel('Profile name').fill('Downtown field acceptance');
  await page.locator('#limit-nr').fill('-100');
  await page.getByLabel('Minimum valid observations / RAT').fill('40');
  await page.getByRole('button', {name: 'Apply thresholds'}).click();
  await expect(page.locator('#quality-summary')).toContainText('Saved · revision 1');
  await page.reload();
  await expect(page.locator('#timeline-label')).toContainText('NR -100');
  await expect(page.locator('#quality-summary')).toContainText('Downtown field acceptance');
  await capture(page, 'replay-desktop.png');

  await page.getByRole('button', {name: 'KPI analytics', exact: true}).click();
  await page.getByLabel('Baseline Test ID').selectOption('DT-DEMO-001');
  await expect(page.getByRole('columnheader', {name: 'Current − baseline'})).toBeVisible();
  await expect(page.locator('#cdf-chart')).toBeVisible();
  await capture(page, 'analytics-desktop.png');

  await page.getByRole('button', {name: 'Investigate', exact: true}).click();
  await expect(page.locator('#sample-table tbody tr')).toHaveCount(50);
  await page.getByRole('button', {name: 'Next page', exact: true}).click();
  await expect(page.locator('#sample-page')).toContainText('51–100');
  await page.getByLabel('Selected metric status').selectOption('failed');
  await expect(page.locator('#sample-table')).toContainText('Outside threshold');
  await page.getByLabel('Find observations').fill('no-such-cell');
  await expect(page.locator('#sample-table')).toContainText('No observations match');
  await page.getByLabel('Find observations').fill('N-');
  const sample = page.locator('[data-sample]').first();
  await sample.click();
  await expect(page.locator('#replay')).toBeVisible();
  await page.getByRole('button', {name: 'Flag sample', exact: false}).click();
  await page.getByLabel('Finding', {exact: true}).fill('Coverage drop <script>alert(1)</script>');
  await page.getByLabel('Investigation notes').fill('Repeat at the tunnel exit.\nCompare the next device pass.');
  await page.getByLabel('Severity').selectOption('high');
  await page.getByRole('button', {name: 'Save issue', exact: true}).click();
  await expect(page.locator('#issue-count')).toHaveText('1 open · 0 resolved');
  await expect(page.locator('#issues h3')).toHaveText('Coverage drop <script>alert(1)</script>');
  await expect(page.locator('#issues script')).toHaveCount(0);
  await page.getByRole('button', {name: 'Resolve', exact: true}).click();
  await expect(page.locator('#issue-count')).toHaveText('0 open · 1 resolved');
  await page.getByRole('button', {name: 'Reopen', exact: true}).click();
  await expect(page.locator('#issue-count')).toHaveText('1 open · 0 resolved');
  await page.locator('#investigate summary').click();
  await expect(page.locator('#audit-log')).toContainText('Issue resolved');
  await capture(page, 'investigate-desktop.png');
  const audit = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map(v => ({id: v.id, targets: v.nodes.map(n => n.target)}))).toEqual([]);

  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export analysis', exact: true}).click();
  const download = await downloadEvent;
  const result = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(result.schema).toBe('drive-test-dm.analysis.v1');
  expect(result.analysis.profile.thresholds.rsrp_dbm.NR).toBe(-100);
  expect(result.analysis.profile.minSamples).toBe(40);
  expect(result.observations).toHaveLength(481);
  expect(result.issues).toHaveLength(1);
  expect(result.audit.find(a => a.action === 'Profile saved').profile.thresholds.rsrp_dbm.NR).toBe(-100);
  expect(result.baseline.id).toBe('DT-DEMO-001');
  expect(result.run.sha256).toMatch(/^[a-f0-9]{64}$/);

  await page.getByRole('button', {name: 'Test report', exact: true}).click();
  await expect(page.locator('#report')).toContainText('Downtown field acceptance');
  await expect(page.locator('#report')).toContainText('Recorded findings');
  if (process.env.DM_REVIEW_OUTPUT) await page.pdf({path: path.join(process.env.DM_REVIEW_OUTPUT, 'review-report.pdf'), printBackground: true, preferCSSPageSize: true, tagged: true});
  await page.reload();
  await expect(page.locator('#run-title')).toHaveText('Tuning verification');
  await page.getByRole('button', {name: 'Investigate', exact: true}).click();
  await expect(page.locator('#issue-count')).toHaveText('1 open · 0 resolved');
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({width, height: 900});
    await expect.poll(()=>page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await capture(page, 'investigate-mobile.png');
  expect(errors).toEqual([]);
});

test('profile conflicts preserve the draft and a refresh recovers service failures', async ({page, dmURL}) => {
  await page.route('**/api/dm/catalog', route => route.fulfill({status: 503, json: {error: 'Offline'}}));
  await page.goto(dmURL);
  await expect(page.locator('#run-title')).toHaveText('Tuning verification');
  const state = await (await page.request.get(new URL('/api/dm/tests/DT-DEMO-002', dmURL).href)).json();
  await page.request.put(new URL('/api/dm/tests/DT-DEMO-002/profile', dmURL).href, {data: {revision: 0, profile: {...state.profile, name: 'Another analyst'}}});
  await page.getByRole('button', {name: 'Thresholds', exact: true}).click();
  await page.getByLabel('Profile name').fill('Unsaved local draft');
  await page.getByRole('button', {name: 'Apply thresholds'}).click();
  await expect(page.locator('#rules-error')).toContainText('another tab');
  await expect(page.getByLabel('Profile name')).toHaveValue('Unsaved local draft');
  await page.keyboard.press('Escape');
  await page.locator('#reload').click();
  await expect(page.locator('#quality-summary')).toContainText('Another analyst');
  await page.route('**/api/dm/tests/DT-DEMO-001', route => route.fulfill({status: 500, json: {error: 'Temporary registry failure'}}));
  await page.locator('[data-id="DT-DEMO-001"]').click();
  await expect(page.locator('#message')).toContainText('Temporary registry failure');
  await expect(page.locator('#test-id')).toHaveText('DT-DEMO-002');
  await page.unroute('**/api/dm/tests/DT-DEMO-001');
  await page.locator('[data-id="DT-DEMO-001"]').click();
  await expect(page.locator('#test-id')).toHaveText('DT-DEMO-001');
  await expect(page.locator('#quality-summary')).toContainText('Default profile');
});

test('an empty technology and sparse metrics cannot appear as accepted', async ({page, dmURL}) => {
  const csv = 'timestamp,latitude,longitude,rat,rsrp_dbm\n2026-11-10T00:00:00Z,,,NR,-90\n2026-11-10T00:00:01Z,,,NR,\n';
  const response = await page.request.post(new URL('/api/dm/tests', dmURL).href, {data: csv, headers: {
    'Content-Type': 'text/csv', 'X-DM-Request': '31c7709a-7061-487e-9ba9-60cb717d0c0d',
    'X-DM-Region': 'toronto', 'X-DM-Project': 'field', 'X-DM-Task': 'sparse', 'X-DM-Label': 'Sparse', 'X-DM-Source': 'sparse.csv',
  }});
  expect(response.status()).toBe(201);
  const {id} = await response.json();
  await page.goto(new URL(`/drive-test/?test=${id}`, dmURL).href);
  await expect(page.locator('#quality-summary')).toContainText('Insufficient evidence');
  await page.locator('#rat').selectOption('LTE');
  await expect(page.locator('#sample-time')).toContainText('No observations');
  await expect(page.locator('#flag-sample')).toBeDisabled();
  await expect(page.locator('#quality-summary .verdict.pass')).toHaveCount(0);
  await page.getByRole('button', {name: 'Investigate', exact: true}).click();
  await expect(page.locator('#sample-table')).toContainText('No observations match');
  await page.locator('#rat').selectOption('NR');
  await page.getByLabel('Selected metric status').selectOption('missing');
  await expect(page.locator('#sample-table tbody tr')).toHaveCount(1);
  await expect(page.locator('#sample-table')).toContainText('Missing');
});

test('100,000-observation capture stays paginated through replay and CDF analysis', async ({page, dmURL}) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const lines = ['timestamp,latitude,longitude,rat,rsrp_dbm,cell_id,pci,arfcn'];
  const epoch = Date.parse('2026-11-10T00:00:00Z');
  for (let i = 0; i < 100000; i++) lines.push(`${new Date(epoch + i * 100).toISOString()},43.643,-79.39,NR,${-80 - i % 50},N-412,412,640128`);
  const start = Date.now();
  const response = await page.request.post(new URL('/api/dm/tests', dmURL).href, {data: lines.join('\n'), headers: {
    'Content-Type': 'text/csv', 'X-DM-Request': 'daf7bfc4-5579-45dd-8080-88cd49e0b39f',
    'X-DM-Region': 'toronto', 'X-DM-Project': 'field', 'X-DM-Task': 'capacity', 'X-DM-Label': 'Capacity%20smoke', 'X-DM-Source': 'capacity.csv',
  }});
  expect(response.status()).toBe(201);
  const {id, count} = await response.json();
  expect(count).toBe(100000);
  const importMs = Date.now() - start;
  await page.goto(new URL(`/drive-test/?test=${id}`, dmURL).href);
  await expect(page.locator('#run-title')).toHaveText('Capacity smoke');
  await expect(page.locator('#map-caption')).toContainText('100,000');
  await page.getByRole('button', {name: 'Investigate', exact: true}).click();
  await expect(page.locator('#sample-table tbody tr')).toHaveCount(50);
  await expect(page.locator('#sample-count')).toContainText('100,000');
  await page.getByRole('button', {name: 'Next page', exact: true}).click();
  await expect(page.locator('#sample-page')).toContainText('51–100');
  await page.getByRole('button', {name: 'KPI analytics', exact: true}).click();
  await expect(page.locator('#cdf-chart')).toBeVisible();
  expect(errors).toEqual([]);
  if (process.env.DM_REVIEW_OUTPUT) {
    await mkdir(process.env.DM_REVIEW_OUTPUT, {recursive: true});
    await writeFile(path.join(process.env.DM_REVIEW_OUTPUT, 'capacity-smoke.json'), JSON.stringify({
      observations: count, csvBytes: Buffer.byteLength(lines.join('\n')), importMs, fullJourneyMs: Date.now() - start,
      browser: 'Chromium', scope: 'Single local synthetic smoke run; not a throughput SLA',
    }, null, 2) + '\n');
  }
});
