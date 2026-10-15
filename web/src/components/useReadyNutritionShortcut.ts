import { useEffect, useEffectEvent } from 'react';
import { consumeReadyNutritionShortcut, NATIVE_SHORTCUT_READY, type NutritionShortcutAction } from '../lib/nutritionShortcuts';

export function useReadyNutritionShortcut(authenticated: boolean, profileReady: boolean,
  onAction: (action: NutritionShortcutAction) => void) {
  const dispatch = useEffectEvent(() => {
    if (!authenticated || !profileReady) return;
    let action: NutritionShortcutAction | null = null;
    try { action = consumeReadyNutritionShortcut(localStorage, { authenticated, profileReady }); }
    catch { return; }
    if (action) onAction(action);
  });
  useEffect(() => {
    dispatch();
    const ready = () => dispatch();
    window.addEventListener(NATIVE_SHORTCUT_READY, ready);
    return () => window.removeEventListener(NATIVE_SHORTCUT_READY, ready);
  }, [authenticated, profileReady]);
}
