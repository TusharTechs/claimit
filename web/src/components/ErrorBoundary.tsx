import { Component, type ReactNode } from 'react';

/** Never show a blank screen mid-drop: show a friendly reload card instead. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('ClaimIt crashed:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-full place-items-center p-6 text-center">
        <div className="max-w-sm">
          <div className="font-display text-3xl font-extrabold">Oops — we hiccuped</div>
          <p className="mt-2 text-ink-2">Your claims are safe on the server. Reload to jump back into the drop.</p>
          <button className="btn mt-5 bg-hot px-6 py-3 text-white" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
