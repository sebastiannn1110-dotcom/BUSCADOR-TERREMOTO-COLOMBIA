import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:3333", ...devices["Desktop Chrome"] },
  webServer: {
    command: "npm run dev",
    env: {
      NODE_ENV: "development",
      ENABLE_TEST_DATA: "false",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "",
      APP_URL: "",
      NEXT_PUBLIC_CAPTCHA_SITE_KEY: "",
      CAPTCHA_SECRET_KEY: "",
      CAPTCHA_PROVIDER: "",
      IP_HASH_SECRET: "e2e-local-secret-never-used-for-production",
      PORT: "3333",
      NEXT_DIST_DIR: ".next-e2e"
    },
    url: "http://127.0.0.1:3333",
    reuseExistingServer: false
  }
});
