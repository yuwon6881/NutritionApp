import type {FirebaseApp} from 'firebase/app';
import type {Messaging,MessagePayload} from 'firebase/messaging';
import {getFirebaseConfig,getVapidKey} from './firebaseConfig';

let appInstance:FirebaseApp|null=null;
let messagingInstance:Messaging|null=null;

async function getMessagingInstance(){
  if(messagingInstance)return messagingInstance;
  const config=getFirebaseConfig();
  if(!config)return null;
  const [{initializeApp},{getMessaging,isSupported}]=await Promise.all([
    import('firebase/app'),
    import('firebase/messaging')
  ]);
  if(!(await isSupported()))throw new Error('This browser does not support web push notifications.');
  appInstance??=initializeApp(config);
  messagingInstance=getMessaging(appInstance);
  return messagingInstance;
}

export async function getFcmToken(registration:ServiceWorkerRegistration){
  const vapidKey=getVapidKey();
  if(!vapidKey)return null;
  const messaging=await getMessagingInstance();
  if(!messaging)return null;
  const {getToken}=await import('firebase/messaging');
  const token=await getToken(messaging,{vapidKey,serviceWorkerRegistration:registration});
  if(!token)throw new Error('The push service did not return a device registration.');
  return token;
}

export async function onForegroundMessage(callback:(payload:MessagePayload)=>void){
  const messaging=await getMessagingInstance();
  if(!messaging)return ()=>undefined;
  const {onMessage}=await import('firebase/messaging');
  return onMessage(messaging,callback);
}
