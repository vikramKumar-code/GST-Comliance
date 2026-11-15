import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Loader from '../common/Loader';

/**
 * ProtectedRoute component
 * - Redirects unauthenticated users to /login
 * - Shows error states for network/server issues
 * - Provides retry mechanism
 * - Accessible loading states
 */
export default function ProtectedRoute({ children }) {
  const { user, loading, error } = useAuth();
  const location = useLocation();

  // ✅ Better validation: Check if user has required fields
  const isValidUser = user && (user.id || user.gstin);

  // ✅ Handle loading state with accessibility
  if (loading && !isValidUser) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-slate-50"
        role="status"
        aria-live="polite"
        aria-label="Authenticating user session"
      >
        <Loader message="Verifying secure session..." size="lg" />
        <span className="sr-only">Loading, please wait</span>
      </div>
    );
  }

  // ✅ Handle error state (network/server issues)
  if (error && !isValidUser) {
    const isNetworkError = error.code === 'NETWORK_ERROR' || !navigator.onLine;
    const isServerError = error.code === 'SERVER_ERROR' || error.status >= 500;

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
          {/* Error Icon */}
          <div className="mx-auto w-16 h-16 mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>

          {/* Error Message */}
          <h2 className="text-xl font-semibold text-slate-900 mb-2">
            {isNetworkError ? 'Connection Problem' :
              isServerError ? 'Server Unavailable' :
                'Authentication Failed'}
          </h2>

          <p className="text-slate-600 mb-6">
            {isNetworkError
              ? 'Please check your internet connection and try again.'
              : isServerError
                ? 'Our servers are temporarily unavailable. Please try again in a few moments.'
                : 'We couldn\'t verify your session. Please try logging in again.'}
          </p>

          {/* Action Buttons */}
          <div className="flex gap-3 justify-center">
            {(isNetworkError || isServerError) && (
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Retry
              </button>
            )}

            <button
              onClick={() => window.location.href = '/login'}
              className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors font-medium"
            >
              Go to Login
            </button>
          </div>

          {/* Error Details (dev mode only) */}
          {import.meta.env.DEV && (
            <details className="mt-6 text-left">
              <summary className="text-sm text-slate-500 cursor-pointer hover:text-slate-700">
                Error Details
              </summary>
              <pre className="mt-2 p-3 bg-slate-100 rounded text-xs text-slate-600 overflow-auto">
                {JSON.stringify(error, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }

  // ✅ Redirect to login if not authenticated
  if (!isValidUser) {
    // Preserve current location for redirect after login
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location,
          message: 'Please log in to access this page'
        }}
      />
    );
  }

  // ✅ User is valid, render protected content
  return children;
}