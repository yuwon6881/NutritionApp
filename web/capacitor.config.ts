import type {CapacitorConfig} from '@capacitor/cli';

const config:CapacitorConfig={
  appId:'com.nutritionapp.mobile',
  appName:'Nutrition App',
  webDir:'dist',
  server:{
    hostname:'nutrition-diary-app.vercel.app',
    androidScheme:'https',
    allowNavigation:['fitness-account-i47taxhzba-as.a.run.app'],
  },
  android:{
    loggingBehavior:'none',
    resolveServiceWorkerRequests:false,
  },
  plugins:{
    PushNotifications:{presentationOptions:['alert']},
  },
};

export default config;
