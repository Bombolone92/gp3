import {defineConfig} from '@playwright/test';
// Uses the already running Vite instance; never launches another port.
export default defineConfig({testDir:'../tests/browser',timeout:180000,
 use:{baseURL:'http://127.0.0.1:5173',browserName:'chromium',channel:'chrome',headless:true}});
