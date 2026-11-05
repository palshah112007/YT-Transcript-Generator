import React from 'react';

/**
 * Top-level ErrorBoundary that intercepts unhandled render exceptions,
 * preventing full-page white screens and offering one-click recovery.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('TranscriptLab Error caught by boundary:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-screen" role="alert">
          <div className="error-boundary-card">
            <span className="error-badge">Application Notice</span>
            <h2>Something went wrong</h2>
            <p className="error-msg">
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>
            <div className="error-actions">
              <button className="primary-btn" onClick={this.handleReset}>
                Reload Application
              </button>
              <button
                className="secondary-btn"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                Try to Recover
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

