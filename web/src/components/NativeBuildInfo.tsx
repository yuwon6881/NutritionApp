import {useEffect,useState} from 'react';
import {App} from '@capacitor/app';
import {isNativeApp} from '../lib/nativeApp';

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
  return <p className="source">Android version {build}. Install a newer APK to update this app.</p>;
}
