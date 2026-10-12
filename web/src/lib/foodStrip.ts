export interface VisibleBounds {
  left: number;
  right: number;
}

/**
 * Checks whether an element (`dayRect`) requires scrolling into view to be fully visible
 * within the visible boundaries of its scroll container (`stripRect`).
 * Returns false if `dayRect` is completely inside `stripRect` within tolerance.
 */
export function needsReveal(
  stripRect: VisibleBounds,
  dayRect: VisibleBounds,
  tolerance = 0.5
): boolean {
  return dayRect.left < stripRect.left - tolerance || dayRect.right > stripRect.right + tolerance;
}
