import {useEffect,useState} from 'react';
import {App} from '@capacitor/app';
import {isNativeApp} from '../lib/nativeApp';
import {SettingRow} from './ui/SettingRow';

/** The installed versions: the web bundle everywhere, and in the Android app the APK it runs inside. */
export function AppVersionInfo(){
  const [android,setAndroid]=useState<{version:string;build:string}|null>(null);
  useEffect(()=>{
    if(!isNativeApp())return;
    let active=true;
    void App.getInfo().then(info=>{
      if(active)setAndroid({version:info.version,build:info.build});
    // Without the native answer the row stays out rather than showing a guessed version.
    }).catch(()=>{});
    return()=>{active=false;};
  },[]);
  return <SettingRow label={<h3 className="setting-row-heading">App version</h3>} description="What is installed on this device.">
    <dl className="app-versions">
      <div><dt>Nutrition</dt><dd>{__APP_VERSION__}</dd></div>
      {android&&<div><dt>Android app</dt><dd>{android.version} <span>build {android.build}</span></dd></div>}
    </dl>
  </SettingRow>;
}
