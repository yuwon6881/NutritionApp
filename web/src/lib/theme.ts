export type Theme='light'|'dark';
const key='nourish-theme';

const query=()=>typeof window.matchMedia==='function'?window.matchMedia('(prefers-color-scheme: dark)'):null;

/** The browser preference is the default for a device that has never chosen one here. */
export const browserTheme=():Theme=>query()?.matches?'dark':'light';

export function storedTheme():Theme|null{
  try{const value=localStorage.getItem(key);return value==='light'||value==='dark'?value:null;}
  catch{return null;}
}

export const activeTheme=():Theme=>storedTheme()??browserTheme();

export function applyTheme(theme:Theme){
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content',theme==='dark'?'#0b0e14':'#fcfcfc');
}

/** An explicit choice is remembered per device and survives sign-out and re-entry. */
export function chooseTheme(theme:Theme){
  try{localStorage.setItem(key,theme);}catch{/* Storage can be unavailable; the applied theme still holds for this session. */}
  applyTheme(theme);
}

/** Follows the browser until this device stores a choice of its own. */
export function watchTheme():()=>void{
  applyTheme(activeTheme());
  const media=query();
  if(!media)return()=>{};
  const listener=()=>{if(!storedTheme())applyTheme(browserTheme());};
  media.addEventListener('change',listener);
  return()=>media.removeEventListener('change',listener);
}
