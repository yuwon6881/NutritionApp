/**
 * Ergonomics and calculations for toast dismiss gestures and message limits.
 */

export const MAX_TOAST_MESSAGE_LENGTH = 80;
export const TOAST_SWIPE_THRESHOLD_PX = 60;
export const TOAST_FLICK_THRESHOLD_PX = 30;
export const TOAST_FLICK_MAX_TIME_MS = 280;

/**
 * Truncate long toast messages with an ellipsis so long names or copy don't blow up the toast.
 */
export function formatToastMessage(message: string, maxLength = MAX_TOAST_MESSAGE_LENGTH): string {
  if (!message) return '';
  if (message.length <= maxLength) return message;
  return `${message.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Decide whether a drag gesture should dismiss to the left, right, or settle back.
 */
export function calculateSwipeOutcome(
  dx: number,
  dt: number,
  width: number
): 'dismiss-left' | 'dismiss-right' | 'settle' {
  const threshold = Math.min(TOAST_SWIPE_THRESHOLD_PX, Math.max(44, width * 0.2));
  const isFlick = Math.abs(dx) >= TOAST_FLICK_THRESHOLD_PX && dt <= TOAST_FLICK_MAX_TIME_MS;
  if (dx <= -threshold || (dx <= -TOAST_FLICK_THRESHOLD_PX && isFlick)) {
    return 'dismiss-left';
  }
  if (dx >= threshold || (dx >= TOAST_FLICK_THRESHOLD_PX && isFlick)) {
    return 'dismiss-right';
  }
  return 'settle';
}

/**
 * Compute toast opacity during dragging so it fades as it is pulled away.
 */
export function calculateSwipeOpacity(dx: number, width: number): number {
  const safeWidth = Math.max(1, width);
  const ratio = Math.abs(dx) / (safeWidth * 0.75);
  return Math.max(0.1, Math.min(1, 1 - ratio));
}

/**
 * Lock gesture axis once movement exceeds a small deadband, or release if vertical scrolling.
 */
export function classifyGestureAxis(dx: number, dy: number): 'horizontal' | 'vertical' | 'pending' {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < 6 && absY < 6) return 'pending';
  return absX >= absY ? 'horizontal' : 'vertical';
}
