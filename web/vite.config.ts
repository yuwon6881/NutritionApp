import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins:[react(),VitePWA({strategies:'injectManifest',srcDir:'src',filename:'sw.ts',registerType:'prompt',injectRegister:'auto',manifest:{name:'Nourish — Nutrition Coach',short_name:'Nourish',description:'Food, weight, and nutrition targets.',start_url:'/',display:'standalone',background_color:'#fcfcfc',theme_color:'#fcfcfc',icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}]},injectManifest:{globPatterns:['**/*.{js,css,html,svg,png,woff2}']}})],
  server:{port:5178,proxy:{'/api':{target:'http://127.0.0.1:5088',changeOrigin:false}}},
});
