import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',workers:1,fullyParallel:false,timeout:60000,expect:{timeout:15000},use:{baseURL:'http://127.0.0.1:5088',browserName:'chromium',trace:'retain-on-failure'},reporter:[['list'],['html',{open:'never'}]]});
