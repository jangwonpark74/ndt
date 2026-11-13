const {fixturePython}=require('./fixture-python.cjs');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {mkdtemp, rm, readFile} = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const {stopFixture} = require('./process-cleanup.cjs');

const {expect, test} = require('@playwright/test');
const {AxeBuilder} = require('@axe-core/playwright');

test('Test ID import, replay, analytics, report and responsive controls', async ({page}) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'dm-browser-'));
  const server = spawn(fixturePython(), ['-B', 'tests/fixtures/serve-drive-fixture.py', '--port', '0', '--db', path.join(temp, 'planning.sqlite3'), '--dm-db', path.join(temp, 'tests.sqlite3')],
    {cwd: path.join(__dirname, '../..'), stdio: ['ignore', 'pipe', 'inherit']});
  try {
    const url = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.once('exit', code => reject(new Error(`DM server exited with ${code}`)));
      const output = readline.createInterface({input: server.stdout});
      output.once('line', line => {
        output.close();
        resolve(line.match(/http:\/\/[^ ]+/)[0]+'/drive-test/');
      });
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await expect(page.locator('#run-title')).toHaveText('Tuning verification');
    await expect(page.locator('#map-mode')).toHaveValue('trace');
    await expect(page.locator('#map-status')).toBeHidden();
    await expect(page.locator('#map-attribution')).toBeHidden();
    await expect(page.locator('#sample-time')).toHaveText('2026-11-09 14:10:00 UTC');
    const scale = await page.locator('#map-scale').innerText();
    await page.getByRole('button', {name: 'Zoom trace in'}).click();
    await expect(page.locator('#map-scale')).not.toHaveText(scale);
    await page.getByRole('button', {name: 'Fit route'}).click();
    await expect(page.locator('#map-scale')).toHaveText(scale);
    await page.getByRole('button', {name: 'Next observation'}).click();
    await expect(page.locator('#sample-time')).toHaveText('2026-11-09 14:10:01 UTC');
    await page.locator('#play').click();
    await expect(page.getByRole('button', {name: 'Pause', exact: false})).toBeVisible();
    await page.getByRole('button', {name: 'Pause', exact: false}).click();
    await page.locator('#events').getByRole('button').filter({hasText: 'LTE fallback logged'}).click();
    await expect(page.locator('#sample-rat')).toHaveText('LTE');
    await page.getByRole('button', {name: 'Thresholds'}).click();
    await page.locator('#limit-nr').fill('-100');
    await page.getByRole('button', {name: 'Apply thresholds'}).click();
    await expect(page.locator('#timeline-label')).toContainText('NR -100');
    await page.getByRole('button', {name: 'Thresholds'}).click();
    await page.getByRole('button', {name: 'Reset defaults'}).click();
    await page.getByRole('button', {name: 'Apply thresholds'}).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    if (process.env.DM_SCREENSHOT) await page.screenshot({path: process.env.DM_SCREENSHOT, fullPage: true});

    const audit = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(({id, nodes}) => ({id, targets: nodes.map(node => node.target)})), []);

    await page.getByRole('button', {name: 'KPI analytics'}).click();
    await page.getByLabel('Baseline Test ID').selectOption('DT-DEMO-001');
    await expect(page.getByRole('columnheader', {name: 'Current − baseline'})).toBeVisible();
    await expect(page.getByRole('row', {name: /NR · Median.*-82/}).first()).toBeVisible();
    await page.getByRole('button', {name: 'Test report'}).click();
    await expect(page.getByText('Synthetic demonstration.', {exact: true})).toBeVisible();
    await expect(page.locator('#report-map')).toBeVisible();
    await expect(page.getByText('Baseline DT-DEMO-001 · Morning baseline', {exact: false})).toBeVisible();
    if (process.env.DM_PDF_OUTPUT) await page.pdf({path: process.env.DM_PDF_OUTPUT, printBackground: true, preferCSSPageSize: true, tagged: true});

    const upload = page.getByRole('button', {name: 'Import run', exact: false});
    await upload.click();
    const response = await page.request.get(new URL('/api/dm/catalog', url).href);
    const {tasks} = await response.json();
    const task = tasks[0] || {region_id: 'toronto', project_id: 'field', task_id: 'TASK-001', task: 'TASK-001'};
    if (tasks.length) {
      await page.getByLabel('Planning task').selectOption([task.region_id, task.project_id, task.task_id].join('/'));
    } else {
      await page.getByLabel('Project ID').fill(task.project_id);
      await page.getByLabel('Task ID').fill(task.task_id);
    }
    await page.getByLabel('Run name').fill('Browser capture');
    await page.getByLabel('Normalized CSV').setInputFiles({name: 'field.csv', mimeType: 'text/csv', buffer: Buffer.from('bad\n')});
    await page.getByRole('button', {name: 'Create Test ID'}).click();
    await expect(page.getByRole('alert')).toContainText('unique headers');
    const csv = 'timestamp,latitude,longitude,rat,rsrp_dbm,latency_ms,event\n' +
      '2026-11-10T10:00:00Z,43.643,-79.39,LTE,-112,74,Radio setup\n' +
      '2026-11-10T10:00:01Z,43.643,-79.389,NR,-91,20,\n';
    await page.getByLabel('Normalized CSV').setInputFiles({name: 'field.csv', mimeType: 'text/csv', buffer: Buffer.from(csv)});
    await page.getByRole('button', {name: 'Create Test ID'}).click();
    await expect(page.locator('#run-title')).toHaveText('Browser capture');
    await expect(page.locator('#run-context')).toContainText(`${task.task} · ${task.task_id}`);
    const id = await page.locator('#test-id').innerText();
    assert.match(id, /^DT-\d{8}-[A-F0-9]{12}$/);
    await page.reload();
    await expect(page.locator('#test-id')).toHaveText(id);
    await page.locator('#rat').selectOption('LTE');
    await page.locator('#metric').selectOption('latency_ms');
    await expect(page.locator('#kpis')).toContainText('100.0%');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Export CSV'}).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), `${id}.csv`);
    const exported = await readFile(await download.path(), 'utf8');
    assert.match(exported, /-112/);
    assert.match(exported, /-91/);

    await page.setViewportSize({width: 390, height: 844});
    await expect.poll(()=>page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await expect(page.locator('#route-canvas')).toBeVisible();
    if (!process.env.DM_LIVE_MAP) {
      await page.route('https://tiles.openfreemap.org/styles/liberty', route =>
        route.fulfill({json: {version: 8, sources: {}, layers: [{id: 'bg', type: 'background', paint: {'background-color': '#e8edeb'}}]}}));
    }
    await page.locator('#map-mode').selectOption('live');
    await expect(page.locator('#live-map canvas')).toBeVisible({timeout: 12000});
    await expect(page.locator('#route-canvas')).toBeHidden({timeout: 12000});
    await page.locator('#map-mode').selectOption('trace');
    await expect(page.locator('#route-canvas')).toBeVisible();
    assert.deepEqual(errors, []);
  } finally {
    await stopFixture(server);
    await rm(temp, {recursive: true, force: true});
  }
});
