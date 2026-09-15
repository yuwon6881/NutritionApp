import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
const apiTarget = process.env.NUTRITION_API ?? 'http://127.0.0.1:5087';
const proxy = { '/api': { target: apiTarget, changeOrigin: false }, '/health': { target: apiTarget, changeOrigin: false } };
export default defineConfig({
  appType:'mpa',
  plugins:[react(),VitePWA({strategies:'injectManifest',srcDir:'src',filename:'sw.ts',registerType:'prompt',injectRegister:'auto',devOptions:{enabled:true,type:'module'},manifest:{id:'/',name:'Nutrition App',short_name:'Nutrition App',description:'Food, weight, and nutrition targets.',start_url:'/',scope:'/',display:'standalone',display_override:['standalone'],background_color:'#fcfcfc',theme_color:'#fcfcfc',categories:['health','lifestyle'],prefer_related_applications:false,icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}]},injectManifest:{globPatterns:['**/*.{js,css,html,svg,png,woff2}']}})],
  server:{port:5178,proxy},
  preview:{port:5088,proxy}
});
