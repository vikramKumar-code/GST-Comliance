import { useAuth } from '../../context/AuthContext';
import EmptyState from '../common/EmptyState';

/**
 * RoleGuard - Enforces workspace role access (OWNER, ADMIN, MEMBER, VIEWER)
 * Displays access denied state if user's active role is not in allowedRoles.
 */
export default function RoleGuard({
  allowedRoles = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  children,
  fallback,
}) {
  const { user } = useAuth();
  const currentRole = (user?.workspaceRole || 'MEMBER').toUpperCase();

  const isAllowed = allowedRoles.map((r) => r.toUpperCase()).includes(currentRole);

  if (isAllowed) {
    return children;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  return (
    <div className="p-8">
      <EmptyState
        icon="🔒"
        title="Access Restricted"
        description={`Your current role (${currentRole}) does not have permission to access this administrative section. Please contact your workspace Owner or Admin.`}
        actionLabel="Back to Dashboard"
        onAction={() => {
          window.location.href = '/dashboard';
        }}
      />
    </div>
  );
}
