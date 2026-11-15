import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import EmptyState from '../common/EmptyState';
import Loader from '../common/Loader';

/**
 * WorkspaceGuard - Ensures an active workspace is present before rendering multi-tenant data
 * 
 * Checks:
 * 1. User is authenticated
 * 2. Workspace exists
 * 3. Workspace is ACTIVE (not suspended)
 * 4. Subscription is valid (not expired)
 * 5. User has required permissions
 */
export default function WorkspaceGuard({
  children,
  fallback,
  requiredPlan = null, // e.g., 'PRO', 'ENTERPRISE'
  requiredPermissions = [] // e.g., ['FILE_RETURNS', 'VIEW_REPORTS']
}) {
  const { user, loading, error, isSubscriptionValid } = useAuth();
  const navigate = useNavigate();

  // ✅ Show skeleton loader during initial auth check
  if (loading && !user) {
    return (
      <div className="min-h-[400px] flex items-center justify-center bg-slate-50">
        <Loader message="Loading workspace..." size="md" />
      </div>
    );
  }

  // ✅ Handle auth errors
  if (error && !user) {
    return (
      <div className="p-8">
        <EmptyState
          icon="⚠️"
          title="Authentication Error"
          description={
            error.code === 'NETWORK_ERROR'
              ? 'Please check your internet connection and try again.'
              : 'We couldn\'t verify your session. Please log in again.'
          }
          actionLabel={error.code === 'NETWORK_ERROR' ? 'Retry' : 'Go to Login'}
          onAction={() => {
            if (error.code === 'NETWORK_ERROR') {
              window.location.reload();
            } else {
              navigate('/login', { state: { from: window.location.pathname } });
            }
          }}
        />
      </div>
    );
  }

  // ✅ Check if user is authenticated
  const isAuthenticated = Boolean(user && (user.id || user.gstin));
  if (!isAuthenticated) {
    if (fallback) return fallback;
    navigate('/login', {
      replace: true,
      state: {
        from: window.location.pathname,
        message: 'Please log in to access this workspace'
      }
    });
    return null;
  }

  // ✅ Check if workspace exists
  const hasWorkspace = Boolean(user?.workspaceId && user?.gstin);
  if (!hasWorkspace) {
    if (fallback) return fallback;

    return (
      <div className="p-8">
        <EmptyState
          icon="🏢"
          title="No Active Workspace Selected"
          description="Please create or select an organization/workspace from the top header to view and manage GST invoices and returns."
          actionLabel="Select Workspace"
          onAction={() => {
            // ✅ Use React Router instead of page reload
            navigate('/settings', {
              state: {
                highlightWorkspaceSelector: true,
                message: 'Please select a workspace to continue'
              }
            });
          }}
          secondaryActionLabel="Create New Workspace"
          onSecondaryAction={() => navigate('/settings?action=create')}
        />
      </div>
    );
  }

  // ✅ Check if workspace is ACTIVE (not suspended)
  const isWorkspaceActive = user?.currentWorkspace?.status !== 'SUSPENDED';
  if (!isWorkspaceActive) {
    if (fallback) return fallback;

    return (
      <div className="p-8">
        <EmptyState
          icon="🚫"
          title="Workspace Suspended"
          description="This workspace has been suspended by the administrator. Please contact support for assistance."
          actionLabel="Contact Support"
          onAction={() => navigate('/support')}
          secondaryActionLabel="Switch Workspace"
          onSecondaryAction={() => navigate('/settings')}
        />
      </div>
    );
  }

  // ✅ Check subscription validity
  if (!isSubscriptionValid) {
    if (fallback) return fallback;

    const subscription = user?.subscription;
    const isExpired = subscription?.validUntil && new Date(subscription.validUntil) < new Date();
    const isCancelled = subscription?.status === 'CANCELLED';

    return (
      <div className="p-8">
        <EmptyState
          icon="💳"
          title={isExpired ? 'Subscription Expired' : 'Subscription Inactive'}
          description={
            isExpired
              ? `Your ${subscription?.plan || 'PRO'} plan expired on ${new Date(subscription.validUntil).toLocaleDateString('en-IN')}. Please renew to continue accessing premium features.`
              : isCancelled
                ? 'Your subscription has been cancelled. Please reactivate to continue.'
                : 'Please activate a subscription plan to access this feature.'
          }
          actionLabel="Upgrade Plan"
          onAction={() => navigate('/subscription')}
          secondaryActionLabel="View Plans"
          onSecondaryAction={() => navigate('/pricing')}
        />
      </div>
    );
  }

  // ✅ Check if specific plan is required
  if (requiredPlan) {
    const currentPlan = user?.subscription?.plan || 'FREE';
    const planHierarchy = { 'FREE': 0, 'PRO': 1, 'ENTERPRISE': 2 };
    const requiredLevel = planHierarchy[requiredPlan] || 0;
    const currentLevel = planHierarchy[currentPlan] || 0;

    if (currentLevel < requiredLevel) {
      if (fallback) return fallback;

      return (
        <div className="p-8">
          <EmptyState
            icon="⭐"
            title={`${requiredPlan} Plan Required`}
            description={`This feature requires ${requiredPlan} plan or higher. Your current plan: ${currentPlan}.`}
            actionLabel={`Upgrade to ${requiredPlan}`}
            onAction={() => navigate('/subscription', { state: { recommendedPlan: requiredPlan } })}
          />
        </div>
      );
    }
  }

  // ✅ Check required permissions (if specified)
  if (requiredPermissions.length > 0) {
    const userPermissions = user?.permissions || [];
    const hasAllPermissions = requiredPermissions.every(perm =>
      userPermissions.includes(perm) || userPermissions.includes('ALL')
    );

    if (!hasAllPermissions) {
      if (fallback) return fallback;

      return (
        <div className="p-8">
          <EmptyState
            icon="🔒"
            title="Permission Denied"
            description="You don't have permission to access this feature. Please contact your workspace administrator."
            actionLabel="Contact Admin"
            onAction={() => navigate('/support')}
          />
        </div>
      );
    }
  }

  // ✅ All checks passed, render protected content
  return children;
}