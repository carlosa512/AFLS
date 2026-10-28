import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Panel } from './components';

/** What a broken tab shows instead of blanking the app: the error, and a way to try again. */
export function TabError({ name, error, onRetry }: { name: string; error: Error; onRetry?: () => void }) {
  return (
    <Panel title={`${name} couldn't open`}>
      <p style={{ marginTop: 0 }}>
        Something in this tab broke while drawing it. The rest of the game still works, and your save is untouched.
      </p>
      <p className="muted small">
        <code>{error.message}</code>
      </p>
      <p className="muted small">If it keeps happening, download a backup from Home and send it with this message.</p>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </Panel>
  );
}

/**
 * Catches a render error in one tab so the rest of the app keeps drawing. React unmounts the whole tree
 * on an uncaught render error, so without this one bad row blanks every screen. Key it by the tab so
 * moving to another one starts clean.
 */
export class TabBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.name} tab failed to render`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <TabError name={this.props.name} error={error} onRetry={() => this.setState({ error: null })} />;
  }
}
