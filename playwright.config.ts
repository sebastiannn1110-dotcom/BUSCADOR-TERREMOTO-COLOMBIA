import { defineConfig, devices } from "@playwright/test";
export default defineConfig({ testDir: "./e2e", use: { baseURL: "http://127.0.0.1:3333", ...devices["Desktop Chrome"] }, webServer: { command: "npm run dev", env: { ...process.env, ENABLE_TEST_DATA: "true", PORT: "3333", NEXT_DIST_DIR: ".next-e2e" }, url: "http://127.0.0.1:3333", reuseExistingServer: false } });
