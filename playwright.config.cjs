const { defineConfig } = require('@playwright/test');
const {mkdtempSync} = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const temp = process.env.NDT_UI_FIXTURE_DIR || mkdtempSync(path.join(os.tmpdir(),'ndt-ui-'));
process.env.NDT_UI_FIXTURE_DIR = temp;
const runId = process.env.NDT_UI_RUN_ID || `${process.env.NDT_BROWSER||'chromium'}-${Date.now()}-${process.pid}`;
process.env.NDT_UI_RUN_ID = runId;
const port = Number(process.env.NDT_UI_PORT || 5189);

module.exports = defineConfig({
  testDir: './ndt/tests/ui',
  timeout: 30000,
  outputDir:path.join('test-results',runId),
  reporter:[['list'],['html',{outputFolder:path.join('playwright-report',runId),open:'never'}]],
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: process.env.NDT_BROWSER || 'chromium',
    trace:'retain-on-failure',screenshot:'only-on-failure',video:'retain-on-failure' },
  webServer: {
    command: `python3 ndt/server.py --host 127.0.0.1 --port ${port} --db "${path.join(temp,'planning.sqlite3')}" --dm-db "${path.join(temp,'drive-tests.sqlite3')}"`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
  },
});
