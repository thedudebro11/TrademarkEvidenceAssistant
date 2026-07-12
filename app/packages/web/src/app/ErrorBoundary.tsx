import { Component, type ErrorInfo, type ReactNode } from "react";
import { StatusMessage } from "../components/ui/StatusMessage.js";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Global shell error boundary. Never exposes a stack trace to the user. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32 }}>
          <StatusMessage tone="error">
            Something went wrong displaying this page. Your original files were not affected — nothing here
            touches evidence directly. Try reloading the application.
          </StatusMessage>
        </div>
      );
    }
    return this.props.children;
  }
}
