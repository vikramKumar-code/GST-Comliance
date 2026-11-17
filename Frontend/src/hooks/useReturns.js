import { useState, useEffect, useCallback, useRef } from 'react';
import { getDashboard, getReturnsSummary } from '../api/returns.api';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const PERIOD_REGEX = /^(0[1-9]|1[0-2])(19|20)\d{2}$/;

function toPositiveNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/**
 * IST offset in minutes.
 * Backend uses GST_TZ_OFFSET_MIN=330 by default.
 * Frontend can override via VITE_GST_TZ_OFFSET_MIN if needed.
 */
const TZ_OFFSET_MIN = toPositiveNumber(
  import.meta.env.VITE_GST_TZ_OFFSET_MIN,
  330
);

const IST_OFFSET_MS = TZ_OFFSET_MIN * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Period helpers                                                             */
/* -------------------------------------------------------------------------- */

function nowIst() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

/**
 * Current GST return period in IST.
 * Example: Nov 2026 => "112026"
 */
export function getCurrentIstPeriod() {
  const d = nowIst();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${month}${year}`;
}

/**
 * Last completed month in IST.
 * Example: current Nov 2026 => "102026"
 */
export function getLastMonthPeriod() {
  const d = nowIst();

  let monthIndex = d.getUTCMonth(); // 0 = Jan
  let year = d.getUTCFullYear();

  monthIndex -= 1;

  if (monthIndex < 0) {
    monthIndex = 11;
    year -= 1;
  }

  const month = String(monthIndex + 1).padStart(2, '0');
  return `${month}${year}`;
}

function normalizePeriod(value) {
  const period = String(value ?? '').trim();
  return PERIOD_REGEX.test(period) ? period : null;
}

function isFuturePeriod(value) {
  const period = normalizePeriod(value);
  if (!period) return false;

  const current = getCurrentIstPeriod();

  const periodMonth = Number(period.slice(0, 2));
  const periodYear = Number(period.slice(2));

  const currentMonth = Number(current.slice(0, 2));
  const currentYear = Number(current.slice(2));

  if (periodYear > currentYear) return true;
  if (periodYear === currentYear && periodMonth > currentMonth) return true;

  return false;
}

function getInitialPeriod(value) {
  const normalized = normalizePeriod(value);

  if (normalized && !isFuturePeriod(normalized)) {
    return normalized;
  }

  return getLastMonthPeriod();
}

/* -------------------------------------------------------------------------- */
/* Error helpers                                                              */
/* -------------------------------------------------------------------------- */

function makeApiError(code, message, status = null, data = null) {
  return {
    code,
    message,
    status,
    data
  };
}

function isNotFound(err) {
  return (
    err?.code === 'DATA_NOT_AVAILABLE' ||
    err?.code === 'NOT_FOUND' ||
    err?.status === 404
  );
}

function isRateLimited(err) {
  return (
    err?.code === 'RATE_LIMITED' ||
    err?.status === 429
  );
}

function isTimeout(err) {
  return (
    err?.code === 'REQUEST_TIMEOUT' ||
    err?.code === 'TIMEOUT' ||
    err?.status === 504
  );
}

function isRetryableError(err) {
  return Boolean(
    err &&
    (
      isRateLimited(err) ||
      isTimeout(err) ||
      err?.code === 'NETWORK_ERROR' ||
      err?.status >= 500
    )
  );
}

function getErrorStatus(err) {
  if (err?.status) return err.status;
  if (isNotFound(err)) return 404;
  if (isRateLimited(err)) return 429;
  if (isTimeout(err)) return 504;
  return 500;
}

function getErrorCode(err) {
  return err?.code || 'SERVER_ERROR';
}

function getErrorMessage(err) {
  return err?.message || 'Something went wrong. Please try again.';
}

function getErrorData(err) {
  return err?.data || {
    code: getErrorCode(err),
    message: getErrorMessage(err)
  };
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Custom hook to manage returns summary and dashboard state.
 *
 * Responsibilities:
 * - IST-aware default period
 * - block future periods
 * - fetch dashboard + returns summary
 * - cache successful period responses
 * - ignore out-of-date responses on fast period changes
 * - normalize 404 empty-state vs retryable errors
 */
export default function useReturns(initialPeriod) {
  const [period, setPeriodState] = useState(() => getInitialPeriod(initialPeriod));
  const [availablePeriods, setAvailablePeriods] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isDataNotAvailable, setIsDataNotAvailable] = useState(false);
  const [lastResponse, setLastResponse] = useState(null);

  const requestIdRef = useRef(0);
  const periodCacheRef = useRef(new Map());
  const mountedRef = useRef(true);
  const periodRef = useRef(period);

  useEffect(() => {
    periodRef.current = period;
  }, [period]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ------------------------------------------------------------------------ */
  /* State appliers                                                           */
  /* ------------------------------------------------------------------------ */

  const applySuccess = useCallback((selectedPeriod, dashboard, summary, latency, requestId) => {
    if (!mountedRef.current) return;
    if (requestId != null && requestId !== requestIdRef.current) return;

    setDashboardData(dashboard);

    if (summary && Array.isArray(summary.availablePeriods)) {
      setAvailablePeriods(summary.availablePeriods);
    }

    setIsDataNotAvailable(false);
    setError(null);

    setLastResponse({
      method: 'GET',
      endpoint: `/api/dashboard?period=${selectedPeriod}`,
      status: 200,
      latency,
      data: dashboard,
      success: true,
      requestId: requestId || null
    });

    periodCacheRef.current.set(selectedPeriod, {
      dashboard,
      summary: summary || null,
      availablePeriods: summary?.availablePeriods || [],
      fetchedAt: new Date().toISOString(),
      latency
    });
  }, []);

  const applyError = useCallback((selectedPeriod, err, latency, requestId) => {
    if (!mountedRef.current) return;
    if (requestId != null && requestId !== requestIdRef.current) return;

    const status = getErrorStatus(err);

    setLastResponse({
      method: 'GET',
      endpoint: `/api/dashboard?period=${selectedPeriod}`,
      status,
      latency,
      data: getErrorData(err),
      success: false,
      errorCode: getErrorCode(err),
      requestId: requestId || null
    });

    if (isNotFound(err)) {
      setIsDataNotAvailable(true);
      setDashboardData(null);
      setError(null);
      return;
    }

    setError(err);
    setDashboardData(null);
    setIsDataNotAvailable(false);
  }, []);

  /* ------------------------------------------------------------------------ */
  /* Fetch                                                                    */
  /* ------------------------------------------------------------------------ */

  const fetchPeriod = useCallback(async (selectedPeriod, options = {}) => {
    const {
      force = false,
      includeSummary = true
    } = options;

    const normalized = normalizePeriod(selectedPeriod);

    if (!normalized) {
      const err = makeApiError(
        'VALIDATION_ERROR',
        'Invalid return period. Period must be in MMYYYY format.'
      );

      setError(err);
      setLastResponse({
        method: 'GET',
        endpoint: '/api/dashboard',
        status: 400,
        latency: 0,
        data: getErrorData(err),
        success: false,
        errorCode: err.code,
        requestId: null
      });

      return Promise.reject(err);
    }

    if (isFuturePeriod(normalized)) {
      const err = makeApiError(
        'VALIDATION_ERROR',
        'Return period cannot be in the future.'
      );

      setError(err);
      setLastResponse({
        method: 'GET',
        endpoint: `/api/dashboard?period=${normalized}`,
        status: 400,
        latency: 0,
        data: getErrorData(err),
        success: false,
        errorCode: err.code,
        requestId: null
      });

      return Promise.reject(err);
    }

    // Serve from cache unless force refresh.
    if (!force && periodCacheRef.current.has(normalized)) {
      const cached = periodCacheRef.current.get(normalized);

      applySuccess(
        normalized,
        cached.dashboard,
        cached.summary,
        cached.latency || 0,
        null
      );

      return Promise.resolve(cached.dashboard);
    }

    const requestId = ++requestIdRef.current;

    setLoading(true);
    setError(null);
    setIsDataNotAvailable(false);

    const startTime = nowMs();

    try {
      const dashboardPromise = getDashboard(normalized);

      const summaryPromise = includeSummary
        ? getReturnsSummary(normalized).catch(() => null)
        : Promise.resolve(null);

      const [dashboard, summary] = await Promise.all([
        dashboardPromise,
        summaryPromise
      ]);

      const latency = Math.round(nowMs() - startTime);

      applySuccess(normalized, dashboard, summary, latency, requestId);

      return dashboard;
    } catch (err) {
      const latency = Math.round(nowMs() - startTime);

      applyError(normalized, err, latency, requestId);

      throw err;
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [applySuccess, applyError]);

  /* ------------------------------------------------------------------------ */
  /* Period setter                                                            */
  /* ------------------------------------------------------------------------ */

  const setPeriod = useCallback((next) => {
    const value = typeof next === 'function'
      ? next(periodRef.current)
      : next;

    const normalized = normalizePeriod(value);

    if (!normalized) {
      setError(makeApiError(
        'VALIDATION_ERROR',
        'Invalid return period. Period must be in MMYYYY format.'
      ));
      return;
    }

    if (isFuturePeriod(normalized)) {
      setError(makeApiError(
        'VALIDATION_ERROR',
        'Return period cannot be in the future.'
      ));
      return;
    }

    setPeriodState(normalized);
  }, []);

  /* ------------------------------------------------------------------------ */
  /* Auto-fetch on period change                                              */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!period) return;

    fetchPeriod(period, { force: false }).catch(() => {
      // Error state is already handled inside fetchPeriod.
    });
  }, [period, fetchPeriod]);

  /* ------------------------------------------------------------------------ */
  /* Public actions                                                           */
  /* ------------------------------------------------------------------------ */

  const refresh = useCallback(() => {
    return fetchPeriod(periodRef.current, { force: true });
  }, [fetchPeriod]);

  const clearPeriodCache = useCallback((targetPeriod) => {
    if (targetPeriod) {
      const normalized = normalizePeriod(targetPeriod);
      if (normalized) {
        periodCacheRef.current.delete(normalized);
      }
      return;
    }

    periodCacheRef.current.clear();
  }, []);

  const invalidateAll = useCallback(() => {
    periodCacheRef.current.clear();
  }, []);

  /* ------------------------------------------------------------------------ */
  /* Derived values                                                           */
  /* ------------------------------------------------------------------------ */

  const isStale = Boolean(dashboardData?.stale);

  const updatedAt =
    dashboardData?.updatedAt ||
    dashboardData?.fetchedAt ||
    null;

  const canRetry = isRetryableError(error);

  return {
    period,
    setPeriod,

    availablePeriods,
    dashboardData,

    loading,
    error,
    isDataNotAvailable,
    isStale,
    updatedAt,
    canRetry,

    lastResponse,

    refresh,
    clearPeriodCache,
    invalidateAll,

    // Useful for UI period picker / defaults
    getCurrentIstPeriod,
    getLastMonthPeriod
  };
}