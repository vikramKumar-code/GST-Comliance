import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // In production we never log sensitive data
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="container min-vh-100 d-flex align-items-center justify-content-center py-5">
          <div className="card shadow-sm border p-4 bg-white text-center" style={{ maxWidth: '480px' }}>
            <div className="fs-1 mb-2">⚠️</div>
            <h2 className="fs-5 fw-bold text-dark mb-1">Something went wrong</h2>
            <p className="text-secondary small mb-4">
              An unexpected error occurred while rendering this page. You can safely reload the application.
            </p>
            <div className="d-flex justify-content-center gap-2">
              <button
                type="button"
                className="btn btn-primary btn-sm px-4 fw-semibold"
                onClick={this.handleReload}
              >
                ↻ Reload Application
              </button>
              <a href="/dashboard" className="btn btn-outline-secondary btn-sm px-3">
                Go to Dashboard
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
