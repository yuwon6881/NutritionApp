import {App} from '@capacitor/app';
import {Capacitor} from '@capacitor/core';
import {Keyboard} from '@capacitor/keyboard';
import {StatusBar,Style} from '@capacitor/status-bar';
import {setKeyboardOpen} from './virtualKeyboard';
import {hardwareBackAction,readState} from './appHistory';

/** Asks the shell to show the Dashboard when Back reaches a page with no in-app history below it. */
export const BACK_TO_HOME_EVENT='nutrition-back-home';

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
  await Keyboard.addListener('keyboardWillShow',()=>setKeyboardOpen(true)).catch(()=>{});
  await Keyboard.addListener('keyboardDidHide',()=>setKeyboardOpen(false)).catch(()=>{});
  await App.addListener('backButton',()=>{
    const action=hardwareBackAction(readState(window.history));
    if(action==='history-back')window.history.back();
    else if(action==='home')window.dispatchEvent(new Event(BACK_TO_HOME_EVENT));
    else void App.exitApp();
  });
}
