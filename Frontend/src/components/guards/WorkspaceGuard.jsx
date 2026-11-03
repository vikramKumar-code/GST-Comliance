import { useAuth } from '../../context/AuthContext';
import EmptyState from '../common/EmptyState';

/**
 * WorkspaceGuard - Ensures an active workspace is present before rendering multi-tenant data
 */
export default function WorkspaceGuard({ children, fallback }) {
  const { user, loading } = useAuth();

  if (loading) return null;

  const hasWorkspace = Boolean(user?.workspaceId || user?.gstin);

  if (!hasWorkspace) {
    if (fallback) return fallback;

    return (
      <div className="p-8">
        <EmptyState
          icon="🏢"
          title="No Active Workspace Selected"
          description="Please create or select an organization/workspace from the top header to view and manage GST invoices and returns."
          actionLabel="Go to Settings"
          onAction={() => {
            window.location.href = '/settings';
          }}
        />
      </div>
    );
  }

  return children;
}
