import type {CapacitorConfig} from '@capacitor/cli';

const config:CapacitorConfig={
  appId:'com.nutritionapp.mobile',
  appName:'Nutrition',
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
    // Keep the web view resizing above the keyboard under Android 15 edge-to-edge.
    Keyboard:{resizeOnFullScreen:true},
  },
};

export default config;
