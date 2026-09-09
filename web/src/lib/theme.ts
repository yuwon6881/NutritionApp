export type Theme='light'|'dark';
const key='nourish-theme';

export function storedTheme():Theme|null{
  try{const value=localStorage.getItem(key);return value==='light'||value==='dark'?value:null;}
  catch{return null;}
}

export const activeTheme=():Theme=>storedTheme()??'light';

export function applyTheme(theme:Theme){
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content',theme==='dark'?'#0b0e14':'#fcfcfc');
}

/** An explicit choice is remembered per device and survives sign-out and re-entry. */
export function chooseTheme(theme:Theme){
  try{localStorage.setItem(key,theme);}catch{/* Storage can be unavailable; the applied theme still holds for this session. */}
  applyTheme(theme);
}

/** Applies the persisted explicit choice. An absent choice is always Light. */
export function watchTheme():()=>void{
  applyTheme(activeTheme());
  return()=>{};
}
