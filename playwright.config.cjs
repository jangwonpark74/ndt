const { defineConfig } = require('@playwright/test');
const {mkdtempSync,readdirSync} = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {fixturePython}=require('./ndt/tests/ui/fixture-python.cjs');
const temp = process.env.NDT_UI_FIXTURE_DIR || mkdtempSync(path.join(os.tmpdir(),'ndt-ui-'));
process.env.NDT_UI_FIXTURE_DIR = temp;
const runId = process.env.NDT_UI_RUN_ID || `${process.env.NDT_BROWSER||'chromium'}-${Date.now()}-${process.pid}`;
process.env.NDT_UI_RUN_ID = runId;
const port = Number(process.env.NDT_UI_PORT || 5189);
// Preserve 1.63.0 defaults while backporting upstream Windows socket fix #43605.
const chromiumDisabledFeatures=['AvoidUnnecessaryBeforeUnloadCheckSync','DestroyProfileOnBrowserClose','DialMediaRouteProvider','GlobalMediaControls','HttpsUpgrades','LensOverlay','MediaRouter','PaintHolding','ThirdPartyStoragePartitioning','BlockOriginHeaderModificationOnRedirect','Translate','AutoDeElevate','OptimizationHints','msForceBrowserSignIn','msEdgeUpdateLaunchServicesPreferredVersion','TcpPortRandomizationWin'];
// Long Windows WebKit workers lost their WebGL context; isolate browser state by spec.
const projects=process.platform==='win32' && process.env.NDT_BROWSER==='webkit'
  ? readdirSync(path.join(__dirname,'ndt/tests/ui')).filter(name=>name.endsWith('.spec.cjs')).sort().map(name=>({name:`webkit-${name.replace('.spec.cjs','')}`,testMatch:`**/${name}`}))
  : undefined;

module.exports = defineConfig({
  testDir: './ndt/tests/ui',
  timeout: 30000,
  // The suites share a local planning database; serialize on Windows to avoid
  // cross-suite edits and resource contention during browser startup.
  workers: process.platform === 'win32' ? 1 : undefined,
  projects,
  globalTeardown:require.resolve('./ndt/tests/ui/global-teardown.cjs'),
  outputDir:path.join('test-results',runId),
  reporter:[['list'],['html',{outputFolder:path.join('playwright-report',runId),open:'never'}]],
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: process.env.NDT_BROWSER || 'chromium',
    launchOptions:process.platform==='win32' && (!process.env.NDT_BROWSER || process.env.NDT_BROWSER==='chromium')?{args:[`--disable-features=${chromiumDisabledFeatures.join(',')}`]}:undefined,
    trace:'retain-on-failure',screenshot:'only-on-failure',video:'retain-on-failure' },
  webServer: {
    command: `"${fixturePython()}" ndt/tests/fixtures/run-ui-server.py --host 127.0.0.1 --port ${port} --db "${path.join(temp,'planning.sqlite3')}" --dm-db "${path.join(temp,'drive-tests.sqlite3')}"`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
  },
});
