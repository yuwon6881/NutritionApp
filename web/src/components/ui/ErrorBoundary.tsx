import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reloadWithFreshShell } from '../../lib/freshShell';
import { Button } from './Button';

const RELOAD_FLAG = 'nutrition-chunk-reload';
// A deploy removes hashed stylesheets as well as scripts, and Vite's CSS preload reports its own message.
const CHUNK_FAILURE = /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|Unable to preload CSS/i;

/// A missing file while online means the page is older than the deployment. Offline, the same failure
/// is the connection, which a reload cannot fix.
export const isStaleVersionError = (error: Error): boolean =>
  CHUNK_FAILURE.test(error.message) && (typeof navigator === 'undefined' || navigator.onLine !== false);

// A deploy replaces hashed chunks, so a long-lived tab can ask for a file that no longer exists.
// One reload per tab session fetches the new shell, so a chunk that is still missing cannot loop;
// the user's food diary survives the reload through IndexedDB. The reload also drops the service
// worker's cached shell, which is what keeps requesting the deleted chunks.
function reloadOnceForNewVersion(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return false;
    sessionStorage.setItem(RELOAD_FLAG, '1');
  } catch {
    return false;
  }
  void reloadWithFreshShell();
  return true;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; reloading: boolean }> {
  state = { failed: false, reloading: false };

  static getDerivedStateFromError() {
    return { failed: true, reloading: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isStaleVersionError(error) && reloadOnceForNewVersion()) return;
    console.error(error, info.componentStack);
  }

  private reload = () => {
    this.setState({ reloading: true });
    void reloadWithFreshShell();
  };

  private reset = () => {
    this.setState({ failed: false, reloading: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="auth-page" role="alert">
        <div className="auth-shell">
          <section className="panel auth-card reload-recovery" aria-labelledby="reload-heading">
            <span className="recovery-error-icon" aria-hidden="true">!</span>
            <p className="eyebrow">NUTRITION</p>
            <h1 id="reload-heading">This view needs a reload</h1>
            <p>Your diary is saved. Reload to continue.</p>
            <div className="recovery-actions">
              <Button variant="primary" fullWidth disabled={this.state.reloading} onClick={this.reload}>
                {this.state.reloading ? 'Reloading…' : 'Reload Nutrition'}
              </Button>
              <Button variant="secondary" fullWidth disabled={this.state.reloading} onClick={this.reset}>
                Try again
              </Button>
            </div>
          </section>
        </div>
      </main>
    );
  }
}
