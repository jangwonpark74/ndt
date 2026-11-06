const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './ndt/tests/ui',
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5189', browserName: process.env.NDT_BROWSER || 'chromium' },
  webServer: {
    command: 'python3 -m http.server 5189 --bind 127.0.0.1 --directory ndt/dist',
    url: 'http://127.0.0.1:5189/',
    reuseExistingServer: false,
  },
});
