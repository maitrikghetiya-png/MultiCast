import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'An unexpected rendering error occurred.',
    };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[MultiCast ErrorBoundary]', error, info.componentStack);
  }

  private handleReload = (): void => {
    this.setState({ hasError: false, errorMessage: '' });
    window.location.assign('/');
  };

  public render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    let friendlyDetail = this.state.errorMessage;
    if (friendlyDetail.startsWith('{')) {
      try {
        const parsed = JSON.parse(friendlyDetail) as { error?: string; operationType?: string };
        friendlyDetail = parsed.error || friendlyDetail;
      } catch {
        // Keep original message if not JSON
      }
    }

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#FAFAFA] px-6 py-12 text-zinc-900">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-600">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <h1 className="mt-4 font-display text-xl font-semibold text-zinc-900">
            MultiCast encountered an error
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600">
            {friendlyDetail}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#D91B24] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#B8141C]"
          >
            <RefreshCw className="h-4 w-4" />
            Return to MultiCast
          </button>
        </div>
      </div>
    );
  }
}
