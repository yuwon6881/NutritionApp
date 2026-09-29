// Applies the saved theme before first paint. Kept as a same-origin file because
// the Content-Security-Policy (script-src 'self') blocks inline scripts.
(()=>{
  let theme='light';
  try{
    const saved=localStorage.getItem('nourish-theme');
    if(saved==='light'||saved==='dark')theme=saved;
  }catch{/* Storage can be unavailable; the light default applies. */}
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#0b0e14':'#fcfcfc');
})();
