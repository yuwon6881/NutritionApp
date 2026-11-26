import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Info, Undo2 } from 'lucide-react';
import { UNDO_WINDOW_MS } from '../../lib/heldMutations';
import {
  calculateSwipeOpacity,
  calculateSwipeOutcome,
  classifyGestureAxis,
  formatToastMessage,
  MAX_TOAST_MESSAGE_LENGTH,
} from '../../lib/toastSwipe';
import { Button } from './Button';
import { useReducedMotion } from './Motion';

/**
 * One undo notice at a time, announced politely and placed above the bottom
 * navigation. It closes when its window ends or when swiped/dismissed; a newer
 * notice replaces an older one, whose operation then simply completes.
 */
interface UndoNotice {
  id: number;
  message: string;
  expiresAt: number;
  /** Absent for a plain notice, which offers nothing to undo. */
  onUndo?: () => Promise<boolean> | boolean;
  /** Called once if this notice is dismissed or replaced without undoing. */
  onRelease?: () => void;
}

let current: UndoNotice | null = null;
let nextId = 1;
const listeners = new Set<(notice: UndoNotice | null) => void>();
const dismissListeners = new Set<() => void>();

const publish = (notice: UndoNotice | null) => {
  const previous = current;
  current = notice;
  if (previous?.onRelease) {
    const release = previous.onRelease;
    previous.onRelease = undefined;
    release();
  }
  listeners.forEach(listener => listener(notice));
};

export function showUndo(
  message: string,
  onUndo: () => Promise<boolean> | boolean,
  durationMs = UNDO_WINDOW_MS,
  onRelease?: () => void
) {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    onRelease?.();
    return;
  }
  publish({ id: nextId++, message, expiresAt: Date.now() + durationMs, onUndo, onRelease });
}

/** A brief non-blocking notice in the same slot, for outcomes that need no action. */
export function showNotice(message: string, durationMs = 6000) {
  publish({ id: nextId++, message, expiresAt: Date.now() + durationMs });
}

/** Dismiss the current toast entirely, removing notice, result, and pending timers. */
export function dismissToast(release = true) {
  if (!release && current) current.onRelease = undefined;
  publish(null);
  dismissListeners.forEach(listener => listener());
}

export { MAX_TOAST_MESSAGE_LENGTH, formatToastMessage };

function DismissIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function UndoToastHost() {
  const [notice, setNotice] = useState<UndoNotice | null>(current);
  const [result, setResult] = useState('');
  const toastRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
    toastWidth: number;
    axis: 'pending' | 'horizontal' | 'vertical';
  } | null>(null);

  const dismiss = useCallback(() => {
    dismissToast();
  }, []);

  useEffect(() => {
    listeners.add(setNotice);
    const onDismiss = () => setResult('');
    dismissListeners.add(onDismiss);
    return () => {
      listeners.delete(setNotice);
      dismissListeners.delete(onDismiss);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    setResult('');
    const timer = window.setTimeout(() => {
      if (current?.id === notice.id) {
        if (dragRef.current !== null) return;
        notice.onRelease = undefined;
        publish(null);
      }
    }, Math.max(0, notice.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => {
      if (dragRef.current !== null) return;
      setResult('');
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [result]);

  useEffect(() => {
    const node = toastRef.current;
    if (node) {
      node.style.removeProperty('transform');
      node.style.removeProperty('opacity');
    }
    dragRef.current = null;
  }, [notice?.id, result]);

  useEffect(() => {
    if (!notice && !result) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [notice, result, dismiss]);

  const undo = async () => {
    if (!notice?.onUndo) return;
    notice.onRelease = undefined;
    try {
      const restored = await notice.onUndo();
      if (current?.id !== notice.id) return;
      publish(null);
      setResult(restored ? 'Undone.' : 'Could not undo; the action expired or a later edit depends on it.');
    } catch {
      if (current?.id !== notice.id) return;
      publish(null);
      setResult('Could not undo. Your saved changes are unchanged.');
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const node = toastRef.current;
    if (!node) return;
    if (typeof node.setPointerCapture === 'function') {
      try {
        node.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture may fail in synthetic test environments.
      }
    }
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTime: Date.now(),
      toastWidth: node.offsetWidth || 320,
      axis: 'pending',
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (drag.axis === 'pending') {
      const axis = classifyGestureAxis(dx, dy);
      if (axis === 'pending') return;
      if (axis === 'vertical') {
        if (
          typeof e.currentTarget.hasPointerCapture === 'function' &&
          e.currentTarget.hasPointerCapture(e.pointerId)
        ) {
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
        }
        dragRef.current = null;
        return;
      }
      drag.axis = 'horizontal';
    }

    if (drag.axis !== 'horizontal') return;

    const node = toastRef.current;
    if (!node) return;
    const opacity = calculateSwipeOpacity(dx, drag.toastWidth);
    node.style.transform = `translate(calc(-50% + ${dx}px), 0)`;
    node.style.opacity = `${opacity}`;
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (
      typeof e.currentTarget.hasPointerCapture === 'function' &&
      e.currentTarget.hasPointerCapture(e.pointerId)
    ) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    const node = toastRef.current;
    if (!node) return;

    if (drag.axis !== 'horizontal') {
      node.style.removeProperty('transform');
      node.style.removeProperty('opacity');
      return;
    }

    const dx = e.clientX - drag.startX;
    const dt = Date.now() - drag.startTime;
    const outcome = calculateSwipeOutcome(dx, dt, drag.toastWidth);

    if (outcome === 'dismiss-left' || outcome === 'dismiss-right') {
      if (reduced || typeof node.animate !== 'function') {
        dismiss();
        return;
      }
      const direction = outcome === 'dismiss-right' ? 1 : -1;
      const exitDistance = drag.toastWidth + 80;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        dismiss();
      };
      const anim = node.animate([
        { transform: node.style.transform || 'translate(-50%, 0)', opacity: node.style.opacity || '1' },
        { transform: `translate(calc(-50% + ${direction * exitDistance}px), 0)`, opacity: '0' }
      ], {
        duration: 160,
        easing: 'cubic-bezier(.2,.8,.2,1)',
        fill: 'forwards'
      });
      anim.onfinish = finish;
      window.setTimeout(finish, 200);
    } else {
      if (reduced || typeof node.animate !== 'function') {
        node.style.removeProperty('transform');
        node.style.removeProperty('opacity');
        scheduleFallbackExpire();
        return;
      }
      const anim = node.animate([
        { transform: node.style.transform || 'translate(-50%, 0)', opacity: node.style.opacity || '1' },
        { transform: 'translate(-50%, 0)', opacity: '1' }
      ], {
        duration: 160,
        easing: 'cubic-bezier(.2,.8,.2,1)',
        fill: 'forwards'
      });
      anim.onfinish = () => {
        node.style.removeProperty('transform');
        node.style.removeProperty('opacity');
        scheduleFallbackExpire();
      };
    }
  };

  const scheduleFallbackExpire = () => {
    if (!notice) return;
    const remaining = Math.max(1500, notice.expiresAt - Date.now());
    window.setTimeout(() => {
      if (current?.id === notice.id && dragRef.current === null) {
        notice.onRelease = undefined;
        publish(null);
      }
    }, remaining);
  };

  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    const node = toastRef.current;
    if (node) {
      node.style.removeProperty('transform');
      node.style.removeProperty('opacity');
    }
  };

  if (!notice && !result) return null;

  const rawText = notice ? notice.message : result;
  const displayText = formatToastMessage(rawText);

  return (
    <div
      ref={toastRef}
      className="undo-toast"
      role="status"
      aria-live="polite"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <span className="undo-toast-icon" aria-hidden="true"><Info size={18}/></span>
      <span
        className="undo-toast-message"
        title={rawText.length > MAX_TOAST_MESSAGE_LENGTH ? rawText : undefined}
      >
        {displayText}
      </span>
      {notice?.onUndo && (
        <Button variant="secondary" size="sm" onClick={() => void undo()}>
          <Undo2 size={16} aria-hidden="true"/>Undo
        </Button>
      )}
      <Button
        variant="tertiary"
        size="icon"
        aria-label="Dismiss notice"
        className="undo-toast-dismiss"
        onClick={dismiss}
      >
        <DismissIcon/>
      </Button>
    </div>
  );
}
