import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getMe, logout as logoutApi } from '../api/auth.api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const checkAuth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMe();
      if (data && data.gstin) {
        setUser({
          gstin: data.gstin,
          expiresAt: data.expiresAt,
        });
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
          if (data && data.gstin) {
            setUser({
              gstin: data.gstin,
              expiresAt: data.expiresAt,
            });
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
    setUser({
      gstin: userData.gstin,
      expiresAt: userData.expiresAt,
    });
    setError(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutApi();
    } catch (err) {
      console.warn('Logout API error:', err);
    } finally {
      setUser(null);
      setError(null);
    }
  }, []);

  const value = {
    user,
    loading,
    error,
    isAuthenticated: Boolean(user?.gstin),
    checkAuth,
    loginSuccess,
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
