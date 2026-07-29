import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import "./ErrorBoundary.css";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
}

/**
 * The app had no error boundary at all: an exception thrown while rendering
 * any single component (a bad tab, a bad section) unmounted the entire React
 * tree, leaving a blank white window with no on-screen trace of what broke --
 * confirmed 2026-07-29 as the mechanism behind a reported Settings-tab crash
 * with nothing in the console. This boundary catches the exception, keeps
 * the rest of the window from vanishing, and prints the message and
 * component stack directly on screen so a crash is diagnosable without
 * DevTools.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info: info.componentStack ?? null });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary">
        <h1>Something crashed</h1>
        <p className="error-boundary-message">{error.message}</p>
        {info && <pre className="error-boundary-stack">{info}</pre>}
      </div>
    );
  }
}
