import { useAuth } from '../../context/AuthContext';

/**
 * Verified permissions mapping derived directly from backend workspaceRole middleware
 */
export const PERMISSIONS_MAP = {
  // Invoicing & Operations
  'invoices.read': ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  'invoices.create': ['OWNER', 'ADMIN', 'MEMBER'],
  'invoices.update': ['OWNER', 'ADMIN', 'MEMBER'],
  'invoices.delete': ['OWNER', 'ADMIN'],
  'invoices.einvoice': ['OWNER', 'ADMIN', 'MEMBER'],
  'invoices.ewaybill': ['OWNER', 'ADMIN', 'MEMBER'],

  // Customers & Items
  'customers.read': ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  'customers.manage': ['OWNER', 'ADMIN', 'MEMBER'],
  'customers.delete': ['OWNER', 'ADMIN'],

  'items.read': ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  'items.manage': ['OWNER', 'ADMIN', 'MEMBER'],
  'items.delete': ['OWNER', 'ADMIN'],

  // Purchases & Bills
  'bills.read': ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  'bills.manage': ['OWNER', 'ADMIN', 'MEMBER'],
  'bills.delete': ['OWNER', 'ADMIN'],

  // GST Returns & Statutory Filings
  'returns.read': ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  'returns.prepare': ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  'returns.save': ['OWNER', 'ADMIN'],
  'returns.nil': ['OWNER', 'ADMIN'],
  'returns.seed': ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],

  // Administrative
  'subscriptions.manage': ['OWNER', 'ADMIN'],
  'workspace.link_gstin': ['OWNER', 'ADMIN'],
  'workspace.settings': ['OWNER', 'ADMIN'],
};

/**
 * Utility to check permission for a given role
 */
export function checkPermission(role, permissionName) {
  if (!role || !permissionName) return false;
  const allowed = PERMISSIONS_MAP[permissionName];
  if (!allowed) return true; // Fail open for unmapped non-sensitive actions
  return allowed.includes(String(role).toUpperCase());
}

/**
 * PermissionGuard component - conditionally renders UI based on user's active permissions
 */
export default function PermissionGuard({
  permission,
  children,
  fallback = null,
  renderDisabled = false,
  disabledTooltip = 'Your current role does not have permission for this action.',
}) {
  const { user } = useAuth();
  const currentRole = user?.workspaceRole || 'MEMBER';
  const hasAccess = checkPermission(currentRole, permission);

  if (hasAccess) {
    return children;
  }

  if (renderDisabled && children) {
    return (
      <span className="inline-block cursor-not-allowed opacity-50 select-none" title={disabledTooltip}>
        {children}
      </span>
    );
  }

  return fallback;
}
