export type Theme='light'|'dark';
const key='nutrition-theme';
const darkQuery='(prefers-color-scheme: dark)';

export function storedTheme():Theme|null{
  try{const value=localStorage.getItem(key);return value==='light'||value==='dark'?value:null;}
  catch{return null;}
}

/** The browser or OS appearance. */
export function systemTheme():Theme{
  return typeof window!=='undefined'&&window.matchMedia?.(darkQuery).matches?'dark':'light';
}

/** The signed-in appearance: the user's explicit choice, else the browser or OS appearance. */
export const activeTheme=():Theme=>storedTheme()??systemTheme();

/** Mirrors the sign-in marker used at startup so the first paint matches the screen that follows. */
export function hasSavedSession():boolean{
  try{return !!localStorage.getItem('nutrition-account')&&localStorage.getItem('nutrition-signed-out')!=='1';}
  catch{return false;}
}

export const initialTheme=():Theme=>hasSavedSession()?activeTheme():systemTheme();

export function applyTheme(theme:Theme){
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content',theme==='dark'?'#000000':'#f4f4f5');
}

/** An explicit choice is remembered per device and applies once signed in. */
export function chooseTheme(theme:Theme){
  try{localStorage.setItem(key,theme);}catch{/* Storage can be unavailable; the applied theme still holds for this session. */}
  applyTheme(theme);
}

/**
 * Signed out, the screen always follows the browser or OS. Signed in, it shows the saved choice and
 * falls back to the browser or OS until one exists. Either way it tracks live system changes.
 */
export function watchTheme(signedIn:boolean):()=>void{
  const sync=()=>applyTheme(signedIn?activeTheme():systemTheme());
  sync();
  const media=window.matchMedia?.(darkQuery);
  media?.addEventListener('change',sync);
  return()=>media?.removeEventListener('change',sync);
}
