import {App} from '@capacitor/app';
import {Keyboard} from '@capacitor/keyboard';
import {StatusBar,Style} from '@capacitor/status-bar';
import {setKeyboardOpen} from './virtualKeyboard';
import {BACK_TO_HOME_EVENT,hardwareBackAction,readState} from './appHistory';




export function statusBarStyleForTheme(dark:boolean){
  return dark?Style.Dark:Style.Light;
}

function syncStatusBar(){
  const dark=document.documentElement.dataset.theme==='dark';
  const background=getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
  void StatusBar.setStyle({style:statusBarStyleForTheme(dark)}).catch(()=>{});
  if(background)void StatusBar.setBackgroundColor({color:background}).catch(()=>{});
}

export async function initializeNativeApp(){
  await (await import('./nativeShortcuts')).initializeNativeShortcuts();
  await (await import('./apkUpdates')).installApkUpdateChecks();

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
    // Leaving from the Dashboard sends the app to the background as Android does for its own
    // apps; finishing the activity would make every return a cold start through the splash screen.
    else void App.minimizeApp();
  });
}
