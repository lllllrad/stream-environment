import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 30000,
  expect: { timeout: 7000, toHaveScreenshot: { maxDiffPixelRatio: .005, animations: 'disabled' } },
  use: { baseURL: 'http://127.0.0.1:4311', browserName: 'chromium', channel: 'msedge', viewport: { width: 1440, height: 1100 }, timezoneId: 'Asia/Seoul', locale: 'ko-KR', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/build.mjs && node scripts/test-server.ts', url: 'http://127.0.0.1:4311/health/ready', reuseExistingServer: false, timeout: 20000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-report.json' }]]
});
