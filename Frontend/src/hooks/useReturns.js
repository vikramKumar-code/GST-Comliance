import { useState, useEffect, useCallback, useRef } from 'react';
import { getDashboard, getReturnsSummary } from '../api/returns.api';

/**
 * Helper to compute default last month period MMYYYY
 */
export function getLastMonthPeriod() {
  const now = new Date();
  let m = now.getMonth(); // 0 is Jan, so getMonth() is naturally (currentMonth - 1)
  let y = now.getFullYear();
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  return `${String(m).padStart(2, '0')}${y}`;
}

/**
 * Custom hook to manage returns summary and dashboard state.
 * Handles fast period changes by discarding out-of-date responses,
 * extracts DATA_NOT_AVAILABLE (404) for calm EmptyState rendering,
 * and detects stale cached responses.
 */
export default function useReturns(initialPeriod) {
  const [period, setPeriod] = useState(() => initialPeriod || getLastMonthPeriod());
  const [availablePeriods, setAvailablePeriods] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isDataNotAvailable, setIsDataNotAvailable] = useState(false);

  // Counter to ignore out-of-date responses on fast period changes
  const requestIdRef = useRef(0);

  const executeFetch = useCallback((selectedPeriod) => {
    const currentRequestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setIsDataNotAvailable(false);

    return Promise.all([
      getDashboard(selectedPeriod),
      getReturnsSummary(selectedPeriod).catch(() => null),
    ])
      .then(([dash, summary]) => {
        if (currentRequestId !== requestIdRef.current) return;
        setDashboardData(dash);
        if (summary?.availablePeriods) {
          setAvailablePeriods(summary.availablePeriods);
        }
      })
      .catch((err) => {
        if (currentRequestId !== requestIdRef.current) return;
        if (err?.code === 'DATA_NOT_AVAILABLE' || err?.status === 404) {
          setIsDataNotAvailable(true);
          setDashboardData(null);
          setError(null);
        } else {
          setError(err);
          setDashboardData(null);
        }
      })
      .finally(() => {
        if (currentRequestId === requestIdRef.current) {
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    if (!period) return;
    let ignore = false;
    const currentRequestId = ++requestIdRef.current;

    Promise.resolve().then(() => {
      if (ignore) return;
      setLoading(true);
      setError(null);
      setIsDataNotAvailable(false);

      Promise.all([
        getDashboard(period),
        getReturnsSummary(period).catch(() => null),
      ])
        .then(([dash, summary]) => {
          if (ignore || currentRequestId !== requestIdRef.current) return;
          setDashboardData(dash);
          if (summary?.availablePeriods) {
            setAvailablePeriods(summary.availablePeriods);
          }
        })
        .catch((err) => {
          if (ignore || currentRequestId !== requestIdRef.current) return;
          if (err?.code === 'DATA_NOT_AVAILABLE' || err?.status === 404) {
            setIsDataNotAvailable(true);
            setDashboardData(null);
            setError(null);
          } else {
            setError(err);
            setDashboardData(null);
          }
        })
        .finally(() => {
          if (!ignore && currentRequestId === requestIdRef.current) {
            setLoading(false);
          }
        });
    });

    return () => {
      ignore = true;
    };
  }, [period]);

  const isStale = Boolean(dashboardData?.stale);
  const updatedAt = dashboardData?.updatedAt || dashboardData?.fetchedAt || null;

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
    refresh: () => executeFetch(period),
  };
}
