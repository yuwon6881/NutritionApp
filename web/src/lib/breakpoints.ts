/**
 * The one window-size contract, matching the CSS tiers in index.css:
 * compact below 640 px, medium 640–1023 px, expanded from 1024 px.
 * Pointer type chooses optional gestures, never layout.
 */
export type WindowTier='compact'|'medium'|'expanded';

export const MEDIUM_MIN_WIDTH=640;
export const EXPANDED_MIN_WIDTH=1024;
export const EXPANDED_QUERY=`(min-width:${EXPANDED_MIN_WIDTH}px)`;

export function windowTier(width:number):WindowTier{
  if(width>=EXPANDED_MIN_WIDTH)return 'expanded';
  return width>=MEDIUM_MIN_WIDTH?'medium':'compact';
}

export function isExpandedWindow(){
  return typeof window!=='undefined'&&!!window.matchMedia?.(EXPANDED_QUERY).matches;
}
