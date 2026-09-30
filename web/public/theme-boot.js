// Applies the theme before first paint. Signed out, the browser or OS appearance applies; signed in,
// the saved choice applies, falling back to the browser or OS. Kept as a same-origin file because
// the Content-Security-Policy (script-src 'self') blocks inline scripts.
(()=>{
  const system=()=>window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  let theme=system();
  try{
    const signedIn=!!localStorage.getItem('nourish-account')&&localStorage.getItem('nourish-signed-out')!=='1';
    const saved=localStorage.getItem('nourish-theme');
    if(signedIn&&(saved==='light'||saved==='dark'))theme=saved;
  }catch{/* Storage can be unavailable; the browser or OS appearance applies. */}
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#0b0e14':'#fcfcfc');
})();
