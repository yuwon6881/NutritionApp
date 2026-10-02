import type { AppState } from '../types';

/** Bootstrap stores the previous peer outcome; a live answer owns its warning. */
export function trainingWarning(current: AppState, incoming: AppState, liveAccount: string | null): string | null | undefined {
  if (liveAccount === current.id && incoming.id === current.id && incoming.workoutConnected !== false)
    return current.workoutWarning;
  return incoming.workoutWarning;
}
