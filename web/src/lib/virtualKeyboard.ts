/**
 * Tracks the on-screen keyboard so fixed chrome (bottom navigation, sync
 * toast) steps aside and the focused field stays visible. The state is
 * published as `data-keyboard="open"` on <html>; styles live in touch.css.
 */
export const KEYBOARD_MIN_HEIGHT_PX=120;

/** A keyboard is open when an editable field has focus and the visible viewport lost a keyboard's worth of height. */
export function isKeyboardOpen(baselineHeight:number,viewportHeight:number,editableFocused:boolean){
  return editableFocused&&baselineHeight-viewportHeight>=KEYBOARD_MIN_HEIGHT_PX;
}

export function isEditable(element:Element|null):boolean{
  if(!(element instanceof HTMLElement))return false;
  if(element.isContentEditable)return true;
  if(element instanceof HTMLTextAreaElement)return !element.readOnly;
  if(!(element instanceof HTMLInputElement)||element.readOnly)return false;
  return !['button','checkbox','color','file','hidden','image','radio','range','reset','submit'].includes(element.type);
}

let open=false;

function revealFocusedField(){
  const element=document.activeElement;
  if(!isEditable(element))return;
  const rect=(element as HTMLElement).getBoundingClientRect();
  const visibleBottom=window.visualViewport?.height??window.innerHeight;
  if(rect.top>=0&&rect.bottom<=visibleBottom-8)return;
  (element as HTMLElement).scrollIntoView({block:'center',inline:'nearest'});
}

export function setKeyboardOpen(next:boolean){
  if(next===open)return;
  open=next;
  if(next)document.documentElement.dataset.keyboard='open';
  else delete document.documentElement.dataset.keyboard;
  // Let the viewport finish resizing before measuring what the keyboard covers.
  if(next)window.setTimeout(revealFocusedField,60);
}

/** Browser/PWA detection; the Android shell reports keyboard events natively instead. */
export function watchVirtualKeyboard():()=>void{
  if(typeof window==='undefined'||!window.matchMedia?.('(pointer: coarse)').matches)return()=>{};
  const viewport=window.visualViewport;
  const currentHeight=()=>Math.min(window.innerHeight,viewport?.height??window.innerHeight);
  let baseline=currentHeight();
  const update=()=>{
    const editable=isEditable(document.activeElement);
    const height=currentHeight();
    if(!editable)baseline=Math.max(baseline,height);
    setKeyboardOpen(isKeyboardOpen(baseline,height,editable));
  };
  const onOrientation=()=>{window.setTimeout(()=>{baseline=currentHeight();update();},350);};
  const onFocusIn=()=>{if(open)window.setTimeout(revealFocusedField,60);else update();};
  const onFocusOut=()=>window.setTimeout(update,0);
  viewport?.addEventListener('resize',update);
  window.addEventListener('resize',update);
  window.addEventListener('orientationchange',onOrientation);
  document.addEventListener('focusin',onFocusIn);
  document.addEventListener('focusout',onFocusOut);
  return()=>{
    viewport?.removeEventListener('resize',update);
    window.removeEventListener('resize',update);
    window.removeEventListener('orientationchange',onOrientation);
    document.removeEventListener('focusin',onFocusIn);
    document.removeEventListener('focusout',onFocusOut);
    setKeyboardOpen(false);
  };
}
