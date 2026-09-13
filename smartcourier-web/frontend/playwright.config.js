import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests',timeout:180000,expect:{timeout:15000},workers:1,
  use:{baseURL:process.env.WEB_TEST_URL||'http://127.0.0.1:5173',viewport:{width:1440,height:1050},headless:true,reducedMotion:'reduce',screenshot:'only-on-failure',trace:'retain-on-failure'},
  reporter:[['list']],
});
