import {App} from '@capacitor/app';
import {Capacitor} from '@capacitor/core';
import {StatusBar,Style} from '@capacitor/status-bar';

export function isNativeApp(){
  return Capacitor.isNativePlatform();
}

function syncStatusBar(){
  const dark=document.documentElement.dataset.theme==='dark';
  const background=getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
  void StatusBar.setStyle({style:dark?Style.Light:Style.Dark}).catch(()=>{});
  if(background)void StatusBar.setBackgroundColor({color:background}).catch(()=>{});
}

export async function initializeNativeApp(){
  if(!isNativeApp())return;

  syncStatusBar();
  const themeObserver=new MutationObserver(syncStatusBar);
  themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  await StatusBar.setOverlaysWebView({overlay:false}).catch(()=>{});
  await App.addListener('backButton',()=>{
    const modalEntry=window.history.state&&typeof window.history.state==='object'
      &&Object.prototype.hasOwnProperty.call(window.history.state,'__nourishModal');
    if(modalEntry)window.history.back();
    else App.exitApp();
  });
}
