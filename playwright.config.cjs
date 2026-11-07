const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './ndt/tests/ui',
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5189', browserName: process.env.NDT_BROWSER || 'chromium' },
  webServer: {
    command: 'python3 ndt/server.py --host 127.0.0.1 --port 5189 --db ndt/var/ui.sqlite3',
    url: 'http://127.0.0.1:5189/',
    reuseExistingServer: false,
  },
});
