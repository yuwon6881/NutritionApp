import './scan-overlay.css';

/**
 * Calm "scanning" treatment laid over a picked image while an AI response is pending.
 * Renders nothing when inactive, so it disappears the moment the response or an error arrives.
 * The parent must be `position: relative`; the overlay never intercepts pointer input.
 * Under reduced motion the sweep is replaced by a static tint with a slow pulse of the brackets.
 */
export function ScanOverlay({active, label = 'Scanning'}: {active: boolean; label?: string}) {
  if (!active) return null;
  return <div className="scan-overlay" data-scan-overlay>
    <span className="scan-overlay-sweep" aria-hidden="true" />
    <span className="scan-overlay-corner scan-overlay-corner-tl" aria-hidden="true" />
    <span className="scan-overlay-corner scan-overlay-corner-tr" aria-hidden="true" />
    <span className="scan-overlay-corner scan-overlay-corner-bl" aria-hidden="true" />
    <span className="scan-overlay-corner scan-overlay-corner-br" aria-hidden="true" />
    <span className="scan-overlay-badge" role="status">{label}…</span>
  </div>;
}
