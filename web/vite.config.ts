import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { NUTRITION_SHORTCUTS } from './src/lib/nutritionShortcuts.ts';
const apiTarget = process.env.NUTRITION_API ?? 'http://127.0.0.1:5087';
const proxy = { '/api': { target: apiTarget, changeOrigin: false }, '/health': { target: apiTarget, changeOrigin: false } };
export default defineConfig({
  appType:'mpa',
  define:{__APP_VERSION__:JSON.stringify(process.env.npm_package_version??'development')},
  plugins:[react(),VitePWA({strategies:'injectManifest',srcDir:'src',filename:'sw.ts',registerType:'prompt',injectRegister:false,devOptions:{enabled:true,type:'module'},manifest:{id:'/',name:'Nutrition App',short_name:'Nutrition App',description:'Food, weight, and nutrition targets.',start_url:'/',scope:'/',display:'standalone',display_override:['standalone'],background_color:'#fcfcfc',theme_color:'#fcfcfc',categories:['health','lifestyle'],prefer_related_applications:false,icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'/icon-maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'},{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}],shortcuts:NUTRITION_SHORTCUTS.map(shortcut=>({name:shortcut.name,short_name:shortcut.shortName,description:shortcut.description,url:shortcut.url,icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png'}]}))},injectManifest:{globPatterns:['**/*.{js,css,html,svg,png,woff2}']}})],
  server:{port:5178,proxy},
  preview:{port:5088,proxy}
});
