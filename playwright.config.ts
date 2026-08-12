import { defineConfig, devices } from "@playwright/test";
export default defineConfig({ testDir: "./e2e", use: { baseURL: "http://127.0.0.1:3333", ...devices["Desktop Chrome"] }, webServer: { command: "set ENABLE_TEST_DATA=true&& set PORT=3333&& npm run dev", url: "http://127.0.0.1:3333", reuseExistingServer: false } });
