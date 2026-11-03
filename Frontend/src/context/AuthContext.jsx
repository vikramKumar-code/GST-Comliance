import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getMe, logout as logoutApi, switchWorkspace as switchWorkspaceApi } from '../api/auth.api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const formatUserData = (data) => {
    if (!data) return null;
    const gstin = data.gstin || data.currentWorkspace?.gstin || null;
    const fallbackName = gstin === '06AAMCC3439Q1Z2' ? 'Candidtax Private Limited' : (gstin ? `GSTIN ${gstin}` : 'User');
    const rawName = data.user?.name || data.currentWorkspace?.name;
    const resolvedName = (rawName && !rawName.startsWith('Taxpayer (')) ? rawName : fallbackName;

    return {
      id: data.user?.id || null,
      name: resolvedName,
      email: data.user?.email || null,
      avatar: data.user?.avatar || null,
      authProvider: data.user?.authProvider || 'GSTIN_OTP',
      systemRole: data.user?.systemRole || (data.isSuperAdmin ? 'SUPER_ADMIN' : 'USER'),
      isSuperAdmin: Boolean(data.isSuperAdmin || data.user?.isSuperAdmin || data.user?.systemRole === 'SUPER_ADMIN'),
      gstin,
      workspaceId: data.workspaceId || data.currentWorkspace?.id || null,
      workspaceRole: data.workspaceRole || data.currentWorkspace?.role || 'MEMBER',
      permissions: data.permissions || data.currentWorkspace?.permissions || ['ALL'],
      subscription: data.currentWorkspace?.subscription || { plan: 'FREE', status: 'ACTIVE' },
      expiresAt: data.expiresAt,
    };
  };

  const checkAuth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMe();
      if (data && (data.gstin || data.user)) {
        setUser(formatUserData(data));
      } else {
        setUser(null);
      }
      return data;
    } catch (err) {
      setUser(null);
      if (err?.code !== 'SESSION_EXPIRED') {
        setError(err);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    getMe()
      .then((data) => {
        if (isMounted) {
          if (data && (data.gstin || data.user)) {
            setUser(formatUserData(data));
          } else {
            setUser(null);
          }
        }
      })
      .catch((err) => {
        if (isMounted) {
          setUser(null);
          if (err?.code !== 'SESSION_EXPIRED') {
            setError(err);
          }
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const loginSuccess = useCallback((userData) => {
    setUser(formatUserData(userData));
    setError(null);
  }, []);

  const switchActiveWorkspace = useCallback(async (workspaceId) => {
    const res = await switchWorkspaceApi(workspaceId);
    if (res?.currentWorkspace) {
      setUser((prev) => ({
        ...prev,
        gstin: res.currentWorkspace.gstin,
        workspaceId: res.currentWorkspace.id,
        workspaceRole: res.currentWorkspace.role
      }));
    }
    return res;
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutApi();
    } catch {
      // Ignore network/session logout errors during client state cleanup
    } finally {
      setUser(null);
      setError(null);
    }
  }, []);

  const value = {
    user,
    loading,
    error,
    isAuthenticated: Boolean(user?.id || user?.gstin),
    hasActiveWorkspace: Boolean(user?.gstin),
    checkAuth,
    loginSuccess,
    switchActiveWorkspace,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
