import ErrorBoundary from '../../components/common/ErrorBoundary';
import QueryProvider from './QueryProvider';
import { AuthProvider } from '../../context/AuthContext';

/**
 * Clean composable AppProviders wrapper
 */
export default function AppProviders({ children }) {
  return (
    <ErrorBoundary>
      <QueryProvider>
        <AuthProvider>
          {children}
        </AuthProvider>
      </QueryProvider>
    </ErrorBoundary>
  );
}
