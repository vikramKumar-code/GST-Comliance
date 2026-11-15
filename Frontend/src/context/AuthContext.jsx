import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getMe, logout as logoutApi, switchWorkspace as switchWorkspaceApi } from '../api/auth.api';

const AuthContext = createContext(null);

// ✅ Move outside component to prevent recreation
const formatUserData = (data) => {
  if (!data) return null;
  const currentWs = data.currentWorkspace || null;
  const gstin = data.gstin || currentWs?.gstin || null;
  const workspaceName = data.workspaceName || currentWs?.name || null;
  const tradeName = currentWs?.tradeName || null;
  const address = currentWs?.address || null;
  const stateCode = currentWs?.stateCode || (gstin && gstin.length >= 2 ? gstin.slice(0, 2) : null);
  const stateName = currentWs?.stateName || null;
  const pincode = currentWs?.pincode || null;
  const phone = currentWs?.phone || null;
  const companyName = tradeName || workspaceName || (gstin ? `Client (${gstin})` : 'Client Organization');

  const rawUserName = data.user?.name;
  const resolvedName = (rawUserName && !rawUserName.startsWith('Taxpayer ('))
    ? rawUserName
    : (data.user?.email?.split('@')[0] || (gstin ? `GSTIN ${gstin}` : 'User'));

  return {
    id: data.user?.id || null,
    name: resolvedName,
    userName: resolvedName,
    workspaceName,
    tradeName,
    address,
    stateCode,
    stateName,
    pincode,
    phone,
    companyName,
    currentWorkspace: currentWs,
    email: data.user?.email || null,
    avatar: data.user?.avatar || null,
    authProvider: data.user?.authProvider || 'GSTIN_OTP',
    systemRole: data.user?.systemRole || (data.isSuperAdmin ? 'SUPER_ADMIN' : 'USER'),
    isSuperAdmin: Boolean(data.isSuperAdmin || data.user?.isSuperAdmin || data.user?.systemRole === 'SUPER_ADMIN'),
    gstin,
    hasPortalSession: Boolean(data.hasPortalSession || currentWs?.hasPortalSession),
    portalUsername: data.portalUsername || currentWs?.portalUsername || null,
    workspaceId: data.workspaceId || currentWs?.id || null,
    workspaceRole: data.workspaceRole || currentWs?.role || 'MEMBER',
    permissions: data.permissions || currentWs?.permissions || ['ALL'],
    subscription: currentWs?.subscription || { plan: 'FREE', status: 'ACTIVE' },
    expiresAt: data.expiresAt,
  };
};

// ✅ Helper: Check if subscription is valid
const isSubscriptionValid = (subscription) => {
  if (!subscription) return false;
  if (subscription.status === 'EXPIRED' || subscription.status === 'CANCELLED') return false;
  if (subscription.validUntil) {
    return new Date(subscription.validUntil) > new Date();
  }
  return true;
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const refreshIntervalRef = useRef(null);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 2;

  // ✅ Retry logic with exponential backoff
  const checkAuth = useCallback(async (isSilent = false, retryAttempt = 0) => {
    if (!isSilent && retryAttempt === 0) setLoading(true);
    setError(null);

    try {
      const data = await getMe();

      if (data && (data.gstin || data.user)) {
        const userData = formatUserData(data);
        setUser(userData);
        retryCountRef.current = 0; // Reset on success

        // ✅ Check subscription validity
        if (userData?.subscription && !isSubscriptionValid(userData.subscription)) {
          console.warn('Subscription expired or inactive');
          // You can dispatch an event or show a warning modal here
        }

        return data;
      } else {
        setUser(null);
        return null;
      }
    } catch (err) {
      // ✅ Retry logic for network errors
      const isNetworkError = !err?.code || err?.code === 'NETWORK_ERROR';
      if (isNetworkError && retryAttempt < MAX_RETRIES) {
        const delay = Math.pow(2, retryAttempt) * 1000; // 1s, 2s
        console.warn(`Auth check failed, retrying in ${delay}ms (attempt ${retryAttempt + 1})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return checkAuth(isSilent, retryAttempt + 1);
      }

      setUser(null);
      if (err?.code !== 'SESSION_EXPIRED') {
        setError(err);
      }
      return null;
    } finally {
      if (!isSilent && retryAttempt === 0) setLoading(false);
    }
  }, []);

  // ✅ Silent token refresh every 15 minutes
  const startTokenRefresh = useCallback(() => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
    }

    refreshIntervalRef.current = setInterval(() => {
      if (navigator.onLine) {
        checkAuth(true); // Silent refresh
      }
    }, 15 * 60 * 1000); // 15 minutes
  }, [checkAuth]);

  const stopTokenRefresh = useCallback(() => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
  }, []);

  // ✅ Initial auth check on mount
  useEffect(() => {
    let isMounted = true;

    checkAuth(false).then(() => {
      if (isMounted) {
        startTokenRefresh();
      }
    });

    return () => {
      isMounted = false;
      stopTokenRefresh();
    };
  }, [checkAuth, startTokenRefresh, stopTokenRefresh]);

  // ✅ Online/Offline detection
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Re-check auth when coming back online
      checkAuth(true);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [checkAuth]);

  const loginSuccess = useCallback((userData) => {
    setUser(formatUserData(userData));
    setError(null);
    startTokenRefresh(); // Start refresh after login
  }, [startTokenRefresh]);

  const switchActiveWorkspace = useCallback(async (workspaceId) => {
    try {
      const res = await switchWorkspaceApi(workspaceId);

      if (res?.currentWorkspace) {
        setUser((prev) => ({
          ...prev,
          workspaceName: res.currentWorkspace.name || prev?.workspaceName,
          currentWorkspace: res.currentWorkspace,
          gstin: res.currentWorkspace.gstin,
          hasPortalSession: Boolean(res.currentWorkspace.hasPortalSession),
          portalUsername: res.currentWorkspace.portalUsername || null,
          workspaceId: res.currentWorkspace.id,
          workspaceRole: res.currentWorkspace.role,
          permissions: res.currentWorkspace.permissions || prev?.permissions, // ✅ Update permissions
          subscription: res.currentWorkspace.subscription || prev?.subscription, // ✅ Update subscription
        }));

        // Re-check auth to ensure fresh data
        await checkAuth(true);
      }

      return res;
    } catch (err) {
      console.error('Workspace switch failed:', err);
      throw err;
    }
  }, [checkAuth]);

  const logout = useCallback(async () => {
    try {
      await logoutApi();
    } catch (err) {
      console.warn('Logout API call failed:', err);
    } finally {
      stopTokenRefresh(); // ✅ Stop refresh on logout
      setUser(null);
      setError(null);

      // ✅ Clear any cached data
      if (typeof window !== 'undefined') {
        sessionStorage.clear();
        // Don't clear localStorage as it might have user preferences
      }
    }
  }, [stopTokenRefresh]);

  // ✅ Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTokenRefresh();
    };
  }, [stopTokenRefresh]);

  const value = {
    user,
    loading,
    error,
    isOnline, // ✅ Expose online status
    isAuthenticated: Boolean(user?.id || user?.gstin),
    hasActiveWorkspace: Boolean(user?.gstin),
    isSubscriptionValid: user?.subscription ? isSubscriptionValid(user.subscription) : false, // ✅ Expose
    checkAuth,
    loginSuccess,
    switchActiveWorkspace,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;