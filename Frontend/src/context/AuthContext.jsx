import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo
} from 'react';

import {
  getMe,
  logout as logoutApi,
  switchWorkspace as switchWorkspaceApi
} from '../api/auth.api';

import { normalizeGstin } from '../utils/validators';

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

const AuthContext = createContext(null);

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_AUTH_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function unwrapResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }

  /**
   * Some backend responses may be wrapped as:
   * { success: true, data: {...} }
   *
   * Our axios client already unwraps response.data, but this keeps
   * AuthContext resilient if a future interceptor changes behaviour.
   */
  if (
    data.data &&
    typeof data.data === 'object' &&
    !Array.isArray(data.data) &&
    ('success' in data || 'code' in data || 'message' in data)
  ) {
    return data.data;
  }

  return data;
}

function normalizeUsername(value) {
  const username = String(value ?? '').trim();
  return username || null;
}

function toDateMs(value) {
  if (!value) return null;

  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function isSubscriptionValid(subscription, now = Date.now()) {
  if (!subscription) return false;

  const status = String(subscription.status || '').toUpperCase();

  if (
    status === 'EXPIRED' ||
    status === 'CANCELLED' ||
    status === 'INACTIVE' ||
    status === 'SUSPENDED'
  ) {
    return false;
  }

  const validUntil = toDateMs(
    subscription.validUntil ||
    subscription.currentPeriodEnd ||
    subscription.endDate ||
    null
  );

  if (validUntil && validUntil <= now) {
    return false;
  }

  return true;
}

function formatUserData(raw, previous = null) {
  const data = unwrapResponse(raw);

  if (!data) {
    return previous
      ? {
        ...previous,
        hasPortalSession: false,
        portalUsername: null,
        expiresAt: null
      }
      : null;
  }

  const currentWs =
    data.currentWorkspace ||
    data.workspace ||
    previous?.currentWorkspace ||
    null;

  const workspaceId =
    data.workspaceId ||
    currentWs?.id ||
    currentWs?._id ||
    previous?.workspaceId ||
    null;

  const gstin =
    normalizeGstin(
      data.gstin ||
      currentWs?.gstin ||
      previous?.gstin ||
      ''
    ) || null;

  const workspaceName =
    data.workspaceName ||
    currentWs?.name ||
    previous?.workspaceName ||
    null;

  const tradeName =
    currentWs?.tradeName ||
    data.tradeName ||
    previous?.tradeName ||
    null;

  const address =
    currentWs?.address ||
    data.address ||
    previous?.address ||
    null;

  const stateCode =
    data.stateCode ||
    currentWs?.stateCode ||
    (gstin && gstin.length >= 2 ? gstin.slice(0, 2) : null) ||
    previous?.stateCode ||
    null;

  const stateName =
    currentWs?.stateName ||
    data.stateName ||
    previous?.stateName ||
    null;

  const pincode =
    currentWs?.pincode ||
    data.pincode ||
    previous?.pincode ||
    null;

  const phone =
    currentWs?.phone ||
    data.phone ||
    previous?.phone ||
    null;

  const companyName =
    tradeName ||
    workspaceName ||
    (gstin ? `Client (${gstin})` : previous?.companyName || 'Client Organization');

  const rawUserName =
    data.user?.name ||
    previous?.name ||
    null;

  const resolvedName =
    rawUserName && !String(rawUserName).startsWith('Taxpayer (')
      ? rawUserName
      : data.user?.email?.split('@')[0] ||
      (gstin ? `GSTIN ${gstin}` : previous?.name || 'User');

  const portalUsername = normalizeUsername(
    data.portalUsername ||
    currentWs?.portalUsername ||
    previous?.portalUsername
  );

  const hasPortalSession = Boolean(
    data.hasPortalSession ??
    currentWs?.hasPortalSession ??
    false
  );

  const expiresAt = hasPortalSession
    ? data.expiresAt ||
    currentWs?.portalSessionExpiresAt ||
    previous?.expiresAt ||
    null
    : null;

  return {
    id:
      data.user?.id ||
      data.user?._id ||
      data.id ||
      previous?.id ||
      null,

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

    email: data.user?.email || previous?.email || null,
    avatar: data.user?.avatar || previous?.avatar || null,

    authProvider:
      data.user?.authProvider ||
      previous?.authProvider ||
      'GSTIN_OTP',

    systemRole:
      data.user?.systemRole ||
      (data.isSuperAdmin ? 'SUPER_ADMIN' : previous?.systemRole) ||
      'USER',

    isSuperAdmin: Boolean(
      data.isSuperAdmin ||
      data.user?.isSuperAdmin ||
      data.user?.systemRole === 'SUPER_ADMIN'
    ),

    gstin,

    hasPortalSession,
    portalUsername,

    workspaceId,

    workspaceRole:
      data.workspaceRole ||
      currentWs?.role ||
      previous?.workspaceRole ||
      'MEMBER',

    permissions:
      data.permissions ||
      currentWs?.permissions ||
      previous?.permissions ||
      ['ALL'],

    subscription:
      currentWs?.subscription ||
      data.subscription ||
      previous?.subscription || {
        plan: 'FREE',
        status: 'ACTIVE'
      },

    expiresAt
  };
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  /**
   * Increment whenever workspace/user context changes materially.
   * Pages can use this to reset return data, exclusions, filing state, etc.
   */
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);

  /**
   * Local portal session mirror.
   * Primary source of truth remains backend getMe(), but this allows
   * immediate UI update after AuthScreen OTP verification.
   */
  const [portalSession, setPortalSession] = useState(null);

  const mountedRef = useRef(true);
  const userRef = useRef(null);

  const inFlightRef = useRef(false);
  const currentPromiseRef = useRef(null);
  const authRequestIdRef = useRef(0);

  const refreshIntervalRef = useRef(null);

  /* ------------------------------------------------------------------------ */
  /* Stable state appliers                                                    */
  /* ------------------------------------------------------------------------ */

  const applyUser = useCallback((nextUser) => {
    userRef.current = nextUser;
    setUserState(nextUser);
  }, []);

  const applyPortalSession = useCallback((nextSession) => {
    setPortalSession(nextSession);
  }, []);

  const syncPortalSessionFromUser = useCallback(
    (u) => {
      if (u?.hasPortalSession && (u.gstin || u.workspaceId)) {
        applyPortalSession({
          key: u.workspaceId || u.gstin,
          gstin: u.gstin || null,
          username: u.portalUsername || null,
          verifiedAt: Date.now(),
          expiresAt: u.expiresAt || null
        });
      } else {
        applyPortalSession(null);
      }
    },
    [applyPortalSession]
  );

  /* ------------------------------------------------------------------------ */
  /* Auth check with retry + race protection                                  */
  /* ------------------------------------------------------------------------ */

  const checkAuth = useCallback(
    async ({ silent = false } = {}) => {
      if (!mountedRef.current) {
        return userRef.current;
      }

      /**
       * Prevent overlapping auth checks.
       * If one is already running, return its promise.
       */
      if (inFlightRef.current) {
        return currentPromiseRef.current || Promise.resolve(userRef.current);
      }

      inFlightRef.current = true;

      const requestId = ++authRequestIdRef.current;

      const promise = (async () => {
        let lastError = null;

        if (!silent) {
          setLoading(true);
        }

        try {
          for (let attempt = 0; attempt <= MAX_AUTH_RETRIES; attempt += 1) {
            try {
              const raw = await getMe();

              if (
                !mountedRef.current ||
                requestId !== authRequestIdRef.current
              ) {
                return userRef.current;
              }

              const data = unwrapResponse(raw);

              const hasIdentity = Boolean(
                data &&
                (data.user ||
                  data.gstin ||
                  data.currentWorkspace ||
                  data.workspace ||
                  data.workspaceId ||
                  data.id)
              );

              if (hasIdentity) {
                const formatted = formatUserData(data, userRef.current);

                applyUser(formatted);
                syncPortalSessionFromUser(formatted);
                setError(null);

                return formatted;
              }

              applyUser(null);
              applyPortalSession(null);
              setError(null);

              return null;
            } catch (err) {
              lastError = err;

              const code = err?.code;
              const status = err?.status;

              const sessionExpired =
                code === 'SESSION_EXPIRED' || status === 401;

              if (sessionExpired) {
                if (
                  !mountedRef.current ||
                  requestId !== authRequestIdRef.current
                ) {
                  return userRef.current;
                }

                applyUser(null);
                applyPortalSession(null);
                setError(null);

                return null;
              }

              /**
               * Retry only transient/network/server errors.
               * Do not retry validation/auth/rate-limit errors.
               */
              const retryable =
                !code ||
                code === 'NETWORK_ERROR' ||
                (status >= 500 && status !== 501 && status !== 505);

              if (retryable && attempt < MAX_AUTH_RETRIES) {
                const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);

                await new Promise((resolve) => setTimeout(resolve, delay));

                if (
                  !mountedRef.current ||
                  requestId !== authRequestIdRef.current
                ) {
                  return userRef.current;
                }

                continue;
              }

              break;
            }
          }

          if (
            !mountedRef.current ||
            requestId !== authRequestIdRef.current
          ) {
            return userRef.current;
          }

          /**
           * Important production behaviour:
           * If user is already authenticated and getMe fails due to network,
           * do NOT force logout. Keep user, expose error.
           */
          if (userRef.current) {
            setError(lastError);
            return userRef.current;
          }

          applyUser(null);
          applyPortalSession(null);
          setError(lastError);

          return null;
        } finally {
          if (requestId === authRequestIdRef.current) {
            inFlightRef.current = false;
            currentPromiseRef.current = null;

            if (!silent) {
              setLoading(false);
            }
          }
        }
      })();

      currentPromiseRef.current = promise;

      return promise;
    },
    [applyUser, applyPortalSession, syncPortalSessionFromUser]
  );

  /* ------------------------------------------------------------------------ */
  /* Token/session refresh                                                     */
  /* ------------------------------------------------------------------------ */

  const startTokenRefresh = useCallback(() => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
    }

    refreshIntervalRef.current = setInterval(() => {
      if (
        mountedRef.current &&
        typeof navigator !== 'undefined' &&
        navigator.onLine &&
        userRef.current
      ) {
        checkAuth({ silent: true }).catch(() => {
          // Silent refresh errors are exposed through state, not thrown.
        });
      }
    }, REFRESH_INTERVAL_MS);
  }, [checkAuth]);

  const stopTokenRefresh = useCallback(() => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
  }, []);

  /* ------------------------------------------------------------------------ */
  /* Portal session helpers                                                   */
  /* ------------------------------------------------------------------------ */

  const clearPortalSession = useCallback(
    (reason = 'MANUAL') => {
      const prev = userRef.current;

      if (!prev) return;

      const next = {
        ...prev,
        hasPortalSession: false,
        portalUsername: null,
        expiresAt: null
      };

      applyUser(next);
      applyPortalSession(null);

      if (reason === 'EXPIRED') {
        setError({
          code: 'SESSION_EXPIRED',
          message:
            'GST portal session expired. Please re-authenticate from GST Return Hub.'
        });
      }
    },
    [applyUser, applyPortalSession]
  );

  const markPortalSessionVerified = useCallback(
    (payload = {}) => {
      const prev = userRef.current;

      if (!prev) {
        return null;
      }

      const response = payload?.response || null;

      const gstin =
        normalizeGstin(
          payload.gstin ||
          response?.gstin ||
          prev.gstin ||
          ''
        ) ||
        prev.gstin ||
        null;

      const username =
        normalizeUsername(
          payload.username ||
          response?.username ||
          prev.portalUsername ||
          payload?.taxpayerDetails?.username
        ) ||
        prev.portalUsername ||
        null;

      const expiresAt =
        payload.expiresAt ||
        response?.expiresAt ||
        prev.expiresAt ||
        null;

      const next = {
        ...prev,
        gstin,
        hasPortalSession: true,
        portalUsername: username,
        expiresAt
      };

      applyUser(next);

      applyPortalSession({
        key: next.workspaceId || gstin,
        gstin,
        username,
        verifiedAt: Date.now(),
        expiresAt
      });

      setError(null);

      /**
       * Sync with backend shortly after local verification.
       * This avoids UI flicker while ensuring server state is authoritative.
       */
      setTimeout(() => {
        if (mountedRef.current) {
          checkAuth({ silent: true }).catch(() => { });
        }
      }, 1500);

      return next;
    },
    [applyUser, applyPortalSession, checkAuth]
  );

  /* ------------------------------------------------------------------------ */
  /* Portal session auto-expiry                                               */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!user?.hasPortalSession || !user?.expiresAt) {
      return;
    }

    const exp = toDateMs(user.expiresAt);

    if (!exp) return;

    const ms = exp - Date.now();

    if (ms <= 0) {
      clearPortalSession('EXPIRED');
      return;
    }

    const timer = setTimeout(() => {
      clearPortalSession('EXPIRED');
      checkAuth({ silent: true }).catch(() => { });
    }, ms + 1000);

    return () => clearTimeout(timer);
  }, [
    user?.hasPortalSession,
    user?.expiresAt,
    clearPortalSession,
    checkAuth
  ]);

  /* ------------------------------------------------------------------------ */
  /* Login success                                                            */
  /* ------------------------------------------------------------------------ */

  const loginSuccess = useCallback(
    (raw) => {
      const data = unwrapResponse(raw);
      const formatted = formatUserData(data, userRef.current);

      applyUser(formatted);
      syncPortalSessionFromUser(formatted);

      setError(null);
      setWorkspaceEpoch((e) => e + 1);

      startTokenRefresh();

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('auth:login-success', {
            detail: {
              user: formatted
            }
          })
        );
      }

      return formatted;
    },
    [
      applyUser,
      syncPortalSessionFromUser,
      startTokenRefresh
    ]
  );

  /* ------------------------------------------------------------------------ */
  /* Workspace switch                                                         */
  /* ------------------------------------------------------------------------ */

  const switchActiveWorkspace = useCallback(
    async (workspaceId) => {
      const prev = userRef.current;
      const currentId = prev?.workspaceId;

      /**
       * Same workspace: just refresh silently.
       */
      if (
        workspaceId &&
        currentId &&
        String(workspaceId) === String(currentId)
      ) {
        await checkAuth({ silent: true });
        return userRef.current;
      }

      try {
        const raw = await switchWorkspaceApi(workspaceId);
        const data = unwrapResponse(raw);

        const currentWs =
          data?.currentWorkspace ||
          data?.workspace ||
          null;

        const nextGstin =
          normalizeGstin(
            data?.gstin ||
            currentWs?.gstin ||
            ''
          ) || null;

        const prevGstin = prev?.gstin || null;

        const gstinChanged = Boolean(
          nextGstin &&
          prevGstin &&
          nextGstin !== prevGstin
        );

        const formatted = formatUserData(data, prev);

        const explicitPortal =
          data?.hasPortalSession ??
          currentWs?.hasPortalSession;

        /**
         * Portal session is generally tied to GSTIN/portal credentials.
         * If GSTIN changes, stale portal session must be cleared.
         * If switching workspace but same GSTIN, preserve only if backend
         * does not explicitly say false.
         */
        const portalPreservable =
          !gstinChanged &&
          Boolean(prev?.hasPortalSession) &&
          (!prevGstin || !nextGstin || prevGstin === nextGstin);

        const hasPortal =
          explicitPortal !== undefined
            ? Boolean(explicitPortal)
            : portalPreservable;

        const nextUser = {
          ...(prev || {}),
          ...(formatted || {}),

          gstin:
            nextGstin ||
            formatted?.gstin ||
            prev?.gstin ||
            null,

          workspaceId:
            formatted?.workspaceId ||
            currentWs?.id ||
            currentWs?._id ||
            prev?.workspaceId ||
            null,

          hasPortalSession: hasPortal,

          portalUsername: hasPortal
            ? formatted?.portalUsername ||
            prev?.portalUsername ||
            null
            : null,

          expiresAt: hasPortal
            ? formatted?.expiresAt ||
            prev?.expiresAt ||
            null
            : null
        };

        applyUser(nextUser);
        syncPortalSessionFromUser(nextUser);

        setError(null);
        setWorkspaceEpoch((e) => e + 1);

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('auth:workspace-switched', {
              detail: {
                workspaceId: nextUser.workspaceId,
                gstin: nextUser.gstin,
                epoch: workspaceEpoch + 1
              }
            })
          );
        }

        /**
         * Hydrate full server state silently.
         */
        checkAuth({ silent: true }).catch(() => { });

        return nextUser;
      } catch (err) {
        setError(err);
        throw err;
      }
    },
    [
      applyUser,
      syncPortalSessionFromUser,
      checkAuth,
      workspaceEpoch
    ]
  );

  /* ------------------------------------------------------------------------ */
  /* Logout                                                                   */
  /* ------------------------------------------------------------------------ */

  const logout = useCallback(async () => {
    stopTokenRefresh();

    try {
      await logoutApi();
    } catch (err) {
      // Logout API failure should not block local logout.
      console.warn('Logout API call failed:', err?.message || err);
    } finally {
      applyUser(null);
      applyPortalSession(null);
      setError(null);
      setWorkspaceEpoch((e) => e + 1);

      if (typeof window !== 'undefined') {
        /**
         * Clear session-scoped caches.
         * Do not clear localStorage blindly because app preferences may live there.
         */
        sessionStorage.clear();

        window.dispatchEvent(
          new CustomEvent('auth:logout')
        );
      }
    }
  }, [
    applyUser,
    applyPortalSession,
    stopTokenRefresh
  ]);

  /* ------------------------------------------------------------------------ */
  /* Initial auth + refresh lifecycle                                         */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    mountedRef.current = true;

    checkAuth({ silent: false })
      .finally(() => {
        if (mountedRef.current) {
          startTokenRefresh();
        }
      });

    return () => {
      mountedRef.current = false;
      stopTokenRefresh();
    };
  }, [
    checkAuth,
    startTokenRefresh,
    stopTokenRefresh
  ]);

  /* ------------------------------------------------------------------------ */
  /* Online/offline handling                                                  */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setIsOnline(true);

      if (userRef.current) {
        checkAuth({ silent: true }).catch(() => { });
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    setIsOnline(navigator.onLine);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [checkAuth]);

  /* ------------------------------------------------------------------------ */
  /* Derived values                                                           */
  /* ------------------------------------------------------------------------ */

  const portalSessionExpiresAtMs = toDateMs(user?.expiresAt);

  const portalSessionActive = Boolean(
    user?.hasPortalSession &&
    (
      !portalSessionExpiresAtMs ||
      portalSessionExpiresAtMs > Date.now()
    )
  );

  const subscriptionValid = useMemo(
    () =>
      user?.subscription
        ? isSubscriptionValid(user.subscription)
        : false,
    [user?.subscription]
  );

  /* ------------------------------------------------------------------------ */
  /* Context value                                                            */
  /* ------------------------------------------------------------------------ */

  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      isOnline,

      isAuthenticated: Boolean(
        user?.id ||
        user?.workspaceId ||
        user?.gstin
      ),

      hasActiveWorkspace: Boolean(
        user?.gstin ||
        user?.workspaceId
      ),

      isSubscriptionValid: subscriptionValid,

      portalSessionActive,
      portalSessionExpiresAt: user?.expiresAt || null,
      portalSession,

      workspaceEpoch,

      checkAuth,
      refreshAuth: () => checkAuth({ silent: false }),

      loginSuccess,
      switchActiveWorkspace,
      logout,

      markPortalSessionVerified,
      clearPortalSession
    }),
    [
      user,
      loading,
      error,
      isOnline,
      subscriptionValid,
      portalSessionActive,
      portalSession,
      workspaceEpoch,
      checkAuth,
      loginSuccess,
      switchActiveWorkspace,
      logout,
      markPortalSessionVerified,
      clearPortalSession
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

export default AuthContext;