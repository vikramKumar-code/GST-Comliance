import { useState, useEffect, useCallback } from 'react';
import { getDashboard, getReturnsSummary } from '../api/returns.api';

/**
 * Custom hook to manage returns summary and dashboard state
 */
export default function useReturns(initialPeriod = '092026') {
  const [period, setPeriod] = useState(initialPeriod);
  const [availablePeriods, setAvailablePeriods] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchReturnsData = useCallback(async (selectedPeriod) => {
    setLoading(true);
    setError(null);
    try {
      const [dash, summary] = await Promise.all([
        getDashboard(selectedPeriod),
        getReturnsSummary(selectedPeriod),
      ]);
      setDashboardData(dash);
      if (summary?.availablePeriods) {
        setAvailablePeriods(summary.availablePeriods);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (!period) return;

    Promise.all([
      getDashboard(period),
      getReturnsSummary(period),
    ])
      .then(([dash, summary]) => {
        if (!isMounted) return;
        setDashboardData(dash);
        if (summary?.availablePeriods) {
          setAvailablePeriods(summary.availablePeriods);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err);
      })
      .finally(() => {
        if (!isMounted) return;
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [period]);

  return {
    period,
    setPeriod,
    availablePeriods,
    dashboardData,
    loading,
    error,
    refresh: () => fetchReturnsData(period),
  };
}
