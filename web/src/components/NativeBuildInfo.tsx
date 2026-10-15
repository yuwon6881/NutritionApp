import {lazy,Suspense,useEffect,useState} from 'react';
import {App} from '@capacitor/app';
import {isNativeApp} from '../lib/nativeApp';
const ApkUpdateSettings=lazy(()=>import('./ApkUpdateSettings').then(module=>({default:module.ApkUpdateSettings})));

export function NativeBuildInfo(){
  const [build,setBuild]=useState<string|null>(null);
  useEffect(()=>{
    if(!isNativeApp())return;
    let active=true;
    void App.getInfo().then(info=>{
      if(active)setBuild(`${info.version} (build ${info.build})`);
    }).catch(()=>{});
    return()=>{active=false;};
  },[]);
  if(!build)return null;
  return <div><p className="source">Android version {build}.</p><Suspense fallback={null}><ApkUpdateSettings/></Suspense></div>;
}
