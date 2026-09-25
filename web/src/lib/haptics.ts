/**
 * Short tactile confirmation for touch gestures. Best-effort: silent where
 * vibration is unsupported or the person prefers reduced motion.
 */
export function hapticTick(durationMs=35){
  if(typeof navigator==='undefined'||!('vibrate' in navigator))return;
  if(typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  try{navigator.vibrate(durationMs);}catch{/* Vibration is optional feedback. */}
}
