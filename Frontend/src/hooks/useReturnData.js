import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  prepareGstr1,
  getGstr1,
  getGstr2b,
  getGstr3b,
  getReturnsSummary,
  seedSampleInvoices
} from '../api/returns.api';
import { mapPortalB2bItems, totalTaxForRows } from '../utils/returnHelpers';
import { formatDate } from '../utils/format';

/* -------------------------------------------------------------------------- */
/* Constants / helpers                                                        */
/* -------------------------------------------------------------------------- */

const OBJECT_ID_REGEX = /^[a-fA-F0-9]{24}$/;

function normalizeSet(value) {
  if (value === undefined || value === null) return new Set();

  if (value instanceof Set) {
    return new Set(
      Array.from(value)
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
    );
  }

  if (Array.isArray(value)) {
    return new Set(
      value
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
    );
  }

  if (typeof value === 'string') {
    return new Set(
      value
        .split(',')
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
    );
  }

  const single = String(value ?? '').trim();
  return single ? new Set([single]) : new Set();
}

function serializeSet(set) {
  return Array.from(set || [])
    .map(String)
    .sort()
    .join('|');
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function n(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function sumField(rows, field) {
  return round2(
    (rows || []).reduce((acc, row) => acc + n(row?.[field]), 0)
  );
}

function sumTaxRows(rows) {
  return round2(
    (rows || []).reduce(
      (acc, row) =>
        acc +
        n(row?.igst) +
        n(row?.cgst) +
        n(row?.sgst) +
        n(row?.cess),
      0
    )
  );
}

function makeApiError(err, fallbackMessage = 'Request failed.') {
  if (!err) return null;

  if (err instanceof Error) {
    return {
      code: err.code || 'ERROR',
      message: err.message || fallbackMessage,
      status: err.status ?? null,
      data: err.data ?? null,
      validationDetails: err.validationDetails ?? null,
      errorCd: err.errorCd ?? null,
      rateLimit: err.rateLimit ?? null,
      requestId: err.requestId ?? null
    };
  }

  return {
    code: err.code || 'ERROR',
    message: err.message || fallbackMessage,
    status: err.status ?? null,
    data: err.data ?? null,
    validationDetails: err.validationDetails ?? null,
    errorCd: err.errorCd ?? err.error_cd ?? null,
    rateLimit: err.rateLimit ?? null,
    requestId: err.requestId ?? null
  };
}

function isNotFound(err) {
  return (
    err?.code === 'DATA_NOT_AVAILABLE' ||
    err?.code === 'NOT_FOUND' ||
    err?.status === 404
  );
}

function isRetryableError(err) {
  return Boolean(
    err &&
    (
      err.code === 'RATE_LIMITED' ||
      err.code === 'REQUEST_TIMEOUT' ||
      err.code === 'TIMEOUT' ||
      err.code === 'NETWORK_ERROR' ||
      err.status === 429 ||
      err.status === 504 ||
      (err.status >= 500 && err.status < 600)
    )
  );
}

function normalizeReturnType(type) {
  return String(type || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeFilingRow(f) {
  if (!f || typeof f !== 'object') return null;

  const period = String(f.period || f.ret_period || f.tax_period || '').trim();
  const type = normalizeReturnType(f.type || f.returnType || f.return_type || '');
  const status = String(f.status || f.filingStatus || f.filing_status || '').trim();
  const arn = f.arn || f.ARN || f.acknowledgement_number || null;

  return {
    ...f,
    period,
    type,
    status,
    arn
  };
}

function extractFilings(summary) {
  if (!summary || typeof summary !== 'object') return [];

  const candidates = [
    summary.filings,
    summary.data?.filings,
    summary.result?.filings,
    summary.returns,
    summary.data?.returns
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map(normalizeFilingRow)
        .filter(Boolean);
    }
  }

  // Fallback: derive filing-like rows from availablePeriods if present.
  const periods =
    summary.availablePeriods ||
    summary.data?.availablePeriods ||
    [];

  if (!Array.isArray(periods)) return [];

  const out = [];

  for (const p of periods) {
    const period = String(p?.period || '').trim();
    if (!period) continue;

    if (p?.gstr1) {
      out.push(
        normalizeFilingRow({
          period,
          type: 'GSTR1',
          status: p.gstr1,
          arn: p.gstr1Arn || p.gstr1_arn || null
        })
      );
    }

    if (p?.gstr3b) {
      out.push(
        normalizeFilingRow({
          period,
          type: 'GSTR3B',
          status: p.gstr3b,
          arn: p.gstr3bArn || p.gstr3b_arn || null
        })
      );
    }
  }

  return out.filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Custom hook to centralize GST return data fetching logic.
 *
 * Responsibilities:
 * - Fetch local GSTR-1 preparation from workspace invoices
 * - Fetch returns summary / filing records
 * - Optionally fetch live GSTR-1 portal data
 * - Fetch GSTR-2B and GSTR-3B portal data
 * - Normalize excluded invoice IDs
 * - Handle race conditions and API errors safely
 *
 * NOTE:
 * This hook does NOT execute RETFILE/EVC filing.
 * Filing execution should be handled by filing page/modal using returns.api.
 */
export function useReturnData(period, externalExcludedIds) {
  const { user } = useAuth();

  const isExternalExclusions = externalExcludedIds !== undefined;

  /* ------------------------------------------------------------------------ */
  /* Exclusion state                                                          */
  /* ------------------------------------------------------------------------ */

  const [internalExcludedIds, setInternalExcludedIds] = useState(() =>
    normalizeSet(externalExcludedIds)
  );

  const excludedIds = useMemo(() => {
    if (isExternalExclusions) {
      return normalizeSet(externalExcludedIds);
    }
    return internalExcludedIds;
  }, [isExternalExclusions, externalExcludedIds, internalExcludedIds]);

  const excludedIdsKey = useMemo(() => serializeSet(excludedIds), [excludedIds]);

  const excludedIdsRef = useRef(excludedIds);
  useEffect(() => {
    excludedIdsRef.current = excludedIds;
  }, [excludedIds]);

  const setExcludedIds = useCallback(
    (updater) => {
      if (isExternalExclusions) {
        // Parent owns exclusion state. Do not mutate internal state.
        return;
      }

      setInternalExcludedIds((prev) => {
        const nextValue =
          typeof updater === 'function' ? updater(prev) : updater;
        return normalizeSet(nextValue);
      });
    },
    [isExternalExclusions]
  );

  const canModifyExclusions = !isExternalExclusions;

  /* ------------------------------------------------------------------------ */
  /* GSTR-1 state                                                             */
  /* ------------------------------------------------------------------------ */

  const [gstr1Loading, setGstr1Loading] = useState(true);
  const [gstr1Error, setGstr1Error] = useState(null);
  const [liveGstr1Error, setLiveGstr1Error] = useState(null);
  const [prepareData, setPrepareData] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [gstr1ViewMode, setGstr1ViewMode] = useState('local');
  const [liveGstr1Data, setLiveGstr1Data] = useState(null);
  const [filings, setFilings] = useState([]);
  const [isDataNotAvailable, setIsDataNotAvailable] = useState(false);

  /* ------------------------------------------------------------------------ */
  /* GSTR-2B / GSTR-3B state                                                  */
  /* ------------------------------------------------------------------------ */

  const [gstr2bData, setGstr2bData] = useState(null);
  const [gstr3bData, setGstr3bData] = useState(null);
  const [otherReturnsLoading, setOtherReturnsLoading] = useState(
    Boolean(user?.hasPortalSession)
  );
  const [otherReturnsError, setOtherReturnsError] = useState(null);

  /* ------------------------------------------------------------------------ */
  /* Seeding state                                                            */
  /* ------------------------------------------------------------------------ */

  const [seeding, setSeeding] = useState(false);
  const [seedSuccessMsg, setSeedSuccessMsg] = useState(null);

  /* ------------------------------------------------------------------------ */
  /* Refs for race protection and stable callbacks                            */
  /* ------------------------------------------------------------------------ */

  const gstr1RequestId = useRef(0);
  const otherReturnsRequestId = useRef(0);

  const periodRef = useRef(period);
  const viewModeRef = useRef(gstr1ViewMode);
  const portalSessionRef = useRef(Boolean(user?.hasPortalSession));
  const mountedRef = useRef(true);

  useEffect(() => {
    periodRef.current = period;
  }, [period]);

  useEffect(() => {
    viewModeRef.current = gstr1ViewMode;
  }, [gstr1ViewMode]);

  useEffect(() => {
    portalSessionRef.current = Boolean(user?.hasPortalSession);
  }, [user?.hasPortalSession]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ------------------------------------------------------------------------ */
  /* Fetch GSTR-1                                                             */
  /* ------------------------------------------------------------------------ */

  const fetchGstr1Data = useCallback(
    async (p, passedExcluded, fetchLive = false) => {
      if (!p) return;

      const currentExcluded =
        passedExcluded !== undefined
          ? normalizeSet(passedExcluded)
          : excludedIdsRef.current;

      const excludedArray = Array.from(currentExcluded);
      const requestId = ++gstr1RequestId.current;

      setGstr1Loading(true);
      setGstr1Error(null);
      setLiveGstr1Error(null);
      setIsDataNotAvailable(false);

      try {
        const calls = [
          prepareGstr1(p, excludedArray),
          getReturnsSummary(p)
        ];

        if (fetchLive) {
          calls.push(getGstr1(p, { forceSync: true }));
        }

        const results = await Promise.allSettled(calls);

        if (
          !mountedRef.current ||
          requestId !== gstr1RequestId.current
        ) {
          return;
        }

        const prepareRes = results[0];
        const summaryRes = results[1];
        const portalRes = fetchLive ? results[2] : null;

        /* ---------------- Local prepare ---------------- */
        if (prepareRes.status === 'fulfilled') {
          setPrepareData(prepareRes.value || null);
          setGstr1Error(null);
          setIsDataNotAvailable(false);
        } else {
          const err = makeApiError(prepareRes.reason);
          setPrepareData(null);

          if (isNotFound(err)) {
            setIsDataNotAvailable(true);
            setGstr1Error(null);
          } else {
            setIsDataNotAvailable(false);
            setGstr1Error(err);
          }
        }

        /* ---------------- Summary / filings ---------------- */
        if (summaryRes.status === 'fulfilled') {
          setFilings(extractFilings(summaryRes.value));
        } else {
          // Summary failure should not block local prepare view.
          setFilings([]);
        }

        /* ---------------- Live portal GSTR-1 ---------------- */
        if (portalRes) {
          if (portalRes.status === 'fulfilled') {
            setLiveGstr1Data(portalRes.value || null);
            setLiveGstr1Error(null);
          } else {
            const err = makeApiError(portalRes.reason);
            setLiveGstr1Data(null);
            setLiveGstr1Error(err);
          }
        }

        setSaveResult(null);
      } catch (err) {
        if (
          mountedRef.current &&
          requestId === gstr1RequestId.current
        ) {
          setGstr1Error(makeApiError(err));
          setPrepareData(null);
          setLiveGstr1Data(null);
          setLiveGstr1Error(null);
        }
      } finally {
        if (
          mountedRef.current &&
          requestId === gstr1RequestId.current
        ) {
          setGstr1Loading(false);
        }
      }
    },
    []
  );

  /* ------------------------------------------------------------------------ */
  /* Fetch GSTR-2B + GSTR-3B                                                  */
  /* ------------------------------------------------------------------------ */

  const fetchOtherReturns = useCallback(async (p) => {
    if (!p) return;

    const requestId = ++otherReturnsRequestId.current;

    setOtherReturnsLoading(true);
    setOtherReturnsError(null);

    try {
      const results = await Promise.allSettled([
        getGstr2b(p),
        getGstr3b(p)
      ]);

      if (
        !mountedRef.current ||
        requestId !== otherReturnsRequestId.current
      ) {
        return;
      }

      const [res2b, res3b] = results;

      if (res2b.status === 'fulfilled') {
        setGstr2bData(res2b.value || null);
      } else {
        setGstr2bData(null);
      }

      if (res3b.status === 'fulfilled') {
        setGstr3bData(res3b.value || null);
      } else {
        setGstr3bData(null);
      }

      const failures = results
        .filter((r) => r.status === 'rejected')
        .map((r) => makeApiError(r.reason))
        .filter(Boolean);

      // Ignore pure 404/data-not-available as hard error if at least one succeeded.
      const nonNotFoundFailures = failures.filter((err) => !isNotFound(err));

      if (nonNotFoundFailures.length > 0) {
        setOtherReturnsError(nonNotFoundFailures[0]);
      } else {
        setOtherReturnsError(null);
      }
    } catch (err) {
      if (
        mountedRef.current &&
        requestId === otherReturnsRequestId.current
      ) {
        setOtherReturnsError(makeApiError(err));
      }
    } finally {
      if (
        mountedRef.current &&
        requestId === otherReturnsRequestId.current
      ) {
        setOtherReturnsLoading(false);
      }
    }
  }, []);

  // Individual on-demand fetchers so clicking GSTR-2B only hits GSTR-2B
  // and clicking GSTR-3B only hits GSTR-3B (saves paid GST API credits).
  const fetchGstr2bData = useCallback(async (p) => {
    const targetPeriod = p || periodRef.current;
    if (!targetPeriod) return null;

    const requestId = ++otherReturnsRequestId.current;
    setOtherReturnsLoading(true);
    setOtherReturnsError(null);

    try {
      const data = await getGstr2b(targetPeriod);

      if (!mountedRef.current || requestId !== otherReturnsRequestId.current) {
        return null;
      }

      setGstr2bData(data || null);
      setOtherReturnsError(null);
      return data || null;
    } catch (err) {
      if (!mountedRef.current || requestId !== otherReturnsRequestId.current) {
        return null;
      }

      const normalized = makeApiError(err);
      setGstr2bData(null);

      if (!isNotFound(normalized)) {
        setOtherReturnsError(normalized);
      } else {
        setOtherReturnsError(null);
      }
      return null;
    } finally {
      if (mountedRef.current && requestId === otherReturnsRequestId.current) {
        setOtherReturnsLoading(false);
      }
    }
  }, []);

  const fetchGstr3bData = useCallback(async (p) => {
    const targetPeriod = p || periodRef.current;
    if (!targetPeriod) return null;

    const requestId = ++otherReturnsRequestId.current;
    setOtherReturnsLoading(true);
    setOtherReturnsError(null);

    try {
      const data = await getGstr3b(targetPeriod);

      if (!mountedRef.current || requestId !== otherReturnsRequestId.current) {
        return null;
      }

      setGstr3bData(data || null);
      setOtherReturnsError(null);
      return data || null;
    } catch (err) {
      if (!mountedRef.current || requestId !== otherReturnsRequestId.current) {
        return null;
      }

      const normalized = makeApiError(err);
      setGstr3bData(null);

      if (!isNotFound(normalized)) {
        setOtherReturnsError(normalized);
      } else {
        setOtherReturnsError(null);
      }
      return null;
    } finally {
      if (mountedRef.current && requestId === otherReturnsRequestId.current) {
        setOtherReturnsLoading(false);
      }
    }
  }, []);

  /* ------------------------------------------------------------------------ */
  /* Refresh helpers                                                          */
  /* ------------------------------------------------------------------------ */

  const refreshGstr1 = useCallback(
    (fetchLive) => {
      const shouldFetchLive =
        fetchLive !== undefined
          ? Boolean(fetchLive)
          : viewModeRef.current === 'taxpro' &&
          portalSessionRef.current;

      return fetchGstr1Data(
        periodRef.current,
        undefined,
        shouldFetchLive
      );
    },
    [fetchGstr1Data]
  );

  const loadLiveGstr1 = useCallback(() => {
    setGstr1ViewMode('taxpro');
    return fetchGstr1Data(periodRef.current, undefined, true);
  }, [fetchGstr1Data]);

  const loadLocalGstr1 = useCallback(() => {
    setGstr1ViewMode('local');
    return fetchGstr1Data(periodRef.current, undefined, false);
  }, [fetchGstr1Data]);

  const clearGstr1Error = useCallback(() => {
    setGstr1Error(null);
    setLiveGstr1Error(null);
    setIsDataNotAvailable(false);
  }, []);

  const clearOtherReturnsError = useCallback(() => {
    setOtherReturnsError(null);
  }, []);

  /* ------------------------------------------------------------------------ */
  /* Seeding                                                                  */
  /* ------------------------------------------------------------------------ */

  const handleSeedSampleInvoices = useCallback(async () => {
    if (!periodRef.current) return;

    setSeeding(true);
    setSeedSuccessMsg(null);

    try {
      const res = await seedSampleInvoices(periodRef.current);
      setSeedSuccessMsg(res?.message || 'Sample invoices generated successfully!');

      const shouldFetchLive =
        viewModeRef.current === 'taxpro' && portalSessionRef.current;

      await fetchGstr1Data(periodRef.current, undefined, shouldFetchLive);
    } catch (err) {
      const normalized = makeApiError(err, 'Failed to generate sample invoices.');
      setSeedSuccessMsg(normalized?.message || 'Failed to generate sample invoices.');
    } finally {
      setSeeding(false);
    }
  }, [fetchGstr1Data]);

  /* ------------------------------------------------------------------------ */
  /* Exclusion handlers                                                       */
  /* ------------------------------------------------------------------------ */

  const toggleExcludeInvoice = useCallback(
    (invoiceId) => {
      if (!canModifyExclusions) return;

      const id = String(invoiceId ?? '').trim();
      if (!id) return;

      setExcludedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [canModifyExclusions, setExcludedIds]
  );

  const handleExcludeAll = useCallback(
    (items) => {
      if (!canModifyExclusions) return;

      const allIds = (items || [])
        .filter((item) => !item?.isPortal && !item?.isHsnRow && !item?.isDocRow)
        .map((item) => String(item?._id ?? '').trim())
        .filter(Boolean);

      if (!allIds.length) return;

      if (
        typeof window !== 'undefined' &&
        !window.confirm(`Exclude all ${allIds.length} items from this return?`)
      ) {
        return;
      }

      setExcludedIds((prev) => {
        const next = new Set(prev);
        allIds.forEach((id) => next.add(id));
        return next;
      });
    },
    [canModifyExclusions, setExcludedIds]
  );

  const handleIncludeAll = useCallback(
    (items) => {
      if (!canModifyExclusions) return;

      const allIds = (items || [])
        .map((item) => String(item?._id ?? '').trim())
        .filter(Boolean);

      if (!allIds.length) return;

      setExcludedIds((prev) => {
        const next = new Set(prev);
        allIds.forEach((id) => next.delete(id));
        return next;
      });
    },
    [canModifyExclusions, setExcludedIds]
  );

  const clearExclusions = useCallback(() => {
    if (!canModifyExclusions) return;
    setExcludedIds(new Set());
  }, [canModifyExclusions, setExcludedIds]);

  /* ------------------------------------------------------------------------ */
  /* Effects                                                                  */
  /* ------------------------------------------------------------------------ */

  // GSTR-1 fetch on period / exclusion / view-mode / portal-session change.
  useEffect(() => {
    if (!period) {
      setGstr1Loading(false);
      return;
    }

    const fetchLive =
      gstr1ViewMode === 'taxpro' && Boolean(user?.hasPortalSession);

    fetchGstr1Data(period, undefined, fetchLive).catch(() => {
      // Error state is handled inside fetchGstr1Data.
    });
  }, [
    period,
    excludedIdsKey,
    gstr1ViewMode,
    user?.hasPortalSession,
    fetchGstr1Data
  ]);

  // Reset GSTR-2B / GSTR-3B data on period or portal session change.
  // Do NOT auto-fetch from Govt Portal — user must explicitly click the Fetch button to save API credits.
  useEffect(() => {
    setGstr2bData(null);
    setGstr3bData(null);
    setOtherReturnsLoading(false);
    setOtherReturnsError(null);
  }, [period, user?.hasPortalSession]);

  /* ------------------------------------------------------------------------ */
  /* Derived GSTR-1 local prepare data                                        */
  /* ------------------------------------------------------------------------ */

  const summary = useMemo(() => prepareData?.summary || {}, [prepareData]);

  const sectionDetails = useMemo(
    () =>
      prepareData?.sectionDetails || {
        b2b: [],
        b2cl: [],
        b2cs: [],
        exp: [],
        cdnr: [],
        cdnur: [],
        hsn: [],
        docSeries: [],
        docIssue: null,
        invalidInvoiceNumbers: [],
        invalidDates: [],
        invalidHsn: [],
        missingIrn: [],
        unclassifiedZeroRate: [],
        synthesizedLineItemsCount: 0
      },
    [prepareData]
  );

  const validationIssues = useMemo(() => {
    const sd = sectionDetails || {};

    return {
      invalidInvoiceNumbers: sd.invalidInvoiceNumbers || [],
      invalidDates: sd.invalidDates || [],
      invalidHsn: sd.invalidHsn || [],
      missingIrn: sd.missingIrn || [],
      unclassifiedZeroRate: sd.unclassifiedZeroRate || [],
      warnings: prepareData?.warnings || []
    };
  }, [sectionDetails, prepareData]);

  const blockingIssueCount = useMemo(
    () =>
      (validationIssues.invalidInvoiceNumbers?.length || 0) +
      (validationIssues.invalidDates?.length || 0) +
      (validationIssues.invalidHsn?.length || 0) +
      (validationIssues.missingIrn?.length || 0) +
      (validationIssues.unclassifiedZeroRate?.length || 0),
    [validationIssues]
  );

  const hasBlockingIssues = blockingIssueCount > 0;
  const gstr1Warnings = validationIssues.warnings || [];

  /* ------------------------------------------------------------------------ */
  /* Portal GSTR-1 mappings                                                   */
  /* ------------------------------------------------------------------------ */

  const hasPortalGstr1 = useMemo(
    () =>
      Boolean(
        liveGstr1Data &&
        (
          liveGstr1Data.totals ||
          (Array.isArray(liveGstr1Data.rows) && liveGstr1Data.rows.length > 0) ||
          (Array.isArray(liveGstr1Data.b2b) && liveGstr1Data.b2b.length > 0) ||
          (Array.isArray(liveGstr1Data.b2cl) && liveGstr1Data.b2cl.length > 0) ||
          (Array.isArray(liveGstr1Data.b2cs) && liveGstr1Data.b2cs.length > 0) ||
          (Array.isArray(liveGstr1Data.exp) && liveGstr1Data.exp.length > 0) ||
          (Array.isArray(liveGstr1Data.cdnr) && liveGstr1Data.cdnr.length > 0) ||
          (Array.isArray(liveGstr1Data.cdnur) && liveGstr1Data.cdnur.length > 0) ||
          liveGstr1Data.hsn ||
          liveGstr1Data.doc_issue ||
          liveGstr1Data.fetchedAt
        )
      ),
    [liveGstr1Data]
  );

  const isPortalGstr1Active =
    gstr1ViewMode === 'taxpro' && hasPortalGstr1;

  const portalB2bItems = useMemo(
    () => mapPortalB2bItems(liveGstr1Data) || [],
    [liveGstr1Data]
  );

  const portalB2clItems = useMemo(() => {
    if (!liveGstr1Data || !Array.isArray(liveGstr1Data.b2cl)) return [];

    const items = [];

    liveGstr1Data.b2cl.forEach((group, groupIdx) => {
      const invList = Array.isArray(group?.inv) ? group.inv : [];

      invList.forEach((inv, invIdx) => {
        let taxable = 0;
        let igst = 0;
        let cess = 0;

        (inv?.itms || []).forEach((itm) => {
          const det = itm?.itm_det || itm || {};
          taxable += n(det.txval);
          igst += n(det.iamt ?? det.igst);
          cess += n(det.csamt ?? det.cess);
        });

        const rawDate = inv?.idt || liveGstr1Data.fetchedAt;
        const pos = group?.pos || inv?.pos || 'Inter-state';

        items.push({
          _id: `portal-b2cl-${groupIdx}-${invIdx}`,
          invoiceNumber: inv?.inum || `B2CL-${items.length + 1}`,
          customerName: `Unregistered Buyer (POS: ${pos})`,
          customerGstin: 'Unregistered Consumer',
          invoiceDate: rawDate,
          dateFormatted: formatDate(rawDate),
          taxableAmount: round2(taxable),
          igst: round2(igst),
          cgst: 0,
          sgst: 0,
          cess: round2(cess),
          grandTotal: round2(n(inv?.val) || taxable + igst + cess),
          pos,
          isPortal: true
        });
      });
    });

    return items;
  }, [liveGstr1Data]);

  const portalB2csItems = useMemo(() => {
    if (!liveGstr1Data || !Array.isArray(liveGstr1Data.b2cs)) return [];

    return liveGstr1Data.b2cs.map((item, idx) => {
      const taxable = n(item.txval);
      const igst = n(item.iamt ?? item.igst);
      const cgst = n(item.camt ?? item.cgst);
      const sgst = n(item.samt ?? item.sgst);
      const cess = n(item.csamt ?? item.cess);
      const tax = round2(igst + cgst + sgst + cess);

      const typ = item.typ || 'OE';
      const etin = item.etin || '';
      const splyTy = item.sply_ty || item.splyTy || 'INTRA';
      const pos = item.pos || '00';
      const rt = item.rt;

      return {
        _id: `portal-b2cs-${typ}-${etin}-${splyTy}-${pos}-${rt}-${idx}`,
        invoiceNumber: `B2CS-${splyTy}-POS-${pos}-RT-${rt ?? 'NA'}`,
        customerName: `Retail Consumer (${splyTy}, POS ${pos}, Rate ${rt ?? 0}%)`,
        customerGstin: 'Unregistered',
        invoiceDate: liveGstr1Data.fetchedAt,
        dateFormatted: formatDate(liveGstr1Data.fetchedAt),
        taxableAmount: round2(taxable),
        igst: round2(igst),
        cgst: round2(cgst),
        sgst: round2(sgst),
        cess: round2(cess),
        grandTotal: round2(taxable + tax),
        typ,
        etin,
        supplyType: splyTy,
        pos,
        rate: rt,
        isPortal: true
      };
    });
  }, [liveGstr1Data]);

  const portalCdnrItems = useMemo(() => {
    if (!liveGstr1Data || !Array.isArray(liveGstr1Data.cdnr)) return [];

    const items = [];

    liveGstr1Data.cdnr.forEach((party, partyIdx) => {
      const ctin = party?.ctin || 'Registered Party';
      const notes = Array.isArray(party?.nt) ? party.nt : [];

      notes.forEach((nt, ntIdx) => {
        let taxable = 0;
        let igst = 0;
        let cgst = 0;
        let sgst = 0;
        let cess = 0;

        (nt?.itms || []).forEach((itm) => {
          const det = itm?.itm_det || itm || {};
          taxable += n(det.txval);
          igst += n(det.iamt ?? det.igst);
          cgst += n(det.camt ?? det.cgst);
          sgst += n(det.samt ?? det.sgst);
          cess += n(det.csamt ?? det.cess);
        });

        const rawDate = nt?.nt_dt || nt?.idt || liveGstr1Data.fetchedAt;
        const tax = round2(igst + cgst + sgst + cess);

        items.push({
          _id: `portal-cdnr-${partyIdx}-${ntIdx}`,
          invoiceNumber: nt?.nt_num || `CDNR-${items.length + 1}`,
          customerName: party?.trdnm || party?.cname || 'Registered Party',
          customerGstin: ctin,
          invoiceDate: rawDate,
          dateFormatted: formatDate(rawDate),
          taxableAmount: round2(taxable),
          igst: round2(igst),
          cgst: round2(cgst),
          sgst: round2(sgst),
          cess: round2(cess),
          grandTotal: round2(taxable + tax),
          noteType: nt?.ntty || null,
          invTyp: nt?.inv_typ || null,
          etin: nt?.etin || null,
          pos: nt?.pos || null,
          isPortal: true
        });
      });
    });

    return items;
  }, [liveGstr1Data]);

  const portalCdnurItems = useMemo(() => {
    if (!liveGstr1Data || !Array.isArray(liveGstr1Data.cdnur)) return [];

    return liveGstr1Data.cdnur.map((nt, idx) => {
      let taxable = 0;
      let igst = 0;
      let cgst = 0;
      let sgst = 0;
      let cess = 0;

      (nt?.itms || []).forEach((itm) => {
        const det = itm?.itm_det || itm || {};
        taxable += n(det.txval);
        igst += n(det.iamt ?? det.igst);
        cgst += n(det.camt ?? det.cgst);
        sgst += n(det.samt ?? det.sgst);
        cess += n(det.csamt ?? det.cess);
      });

      const rawDate = nt?.nt_dt || nt?.idt || liveGstr1Data.fetchedAt;
      const tax = round2(igst + cgst + sgst + cess);
      const typ = nt?.typ || 'CDNUR';

      return {
        _id: `portal-cdnur-${typ}-${idx}`,
        invoiceNumber: nt?.nt_num || `CDNUR-${idx + 1}`,
        customerName:
          typ === 'EXPWP' || typ === 'EXPWOP'
            ? `Export/SEZ Note (${typ})`
            : `Unregistered/Consumer Note (${typ})`,
        customerGstin: 'Unregistered / Export',
        invoiceDate: rawDate,
        dateFormatted: formatDate(rawDate),
        taxableAmount: round2(taxable),
        igst: round2(igst),
        cgst: round2(cgst),
        sgst: round2(sgst),
        cess: round2(cess),
        grandTotal: round2(n(nt?.val) || taxable + tax),
        noteType: nt?.ntty || null,
        typ,
        pos: nt?.pos || null,
        isPortal: true
      };
    });
  }, [liveGstr1Data]);

  const portalExpItems = useMemo(() => {
    if (!liveGstr1Data || !Array.isArray(liveGstr1Data.exp)) return [];

    const items = [];

    liveGstr1Data.exp.forEach((group, groupIdx) => {
      const expTyp = group?.exp_typ || group?.expTyp || 'WOPAY';
      const invList = Array.isArray(group?.inv) ? group.inv : [];

      invList.forEach((inv, invIdx) => {
        let taxable = 0;
        let igst = 0;
        let cess = 0;

        (inv?.itms || []).forEach((itm) => {
          const det = itm?.itm_det || itm || {};
          taxable += n(det.txval);
          igst += n(det.iamt ?? det.igst);
          cess += n(det.csamt ?? det.cess);
        });

        const rawDate = inv?.idt || liveGstr1Data.fetchedAt;

        items.push({
          _id: `portal-exp-${expTyp}-${groupIdx}-${invIdx}`,
          invoiceNumber: inv?.inum || `EXP-${items.length + 1}`,
          customerName: `Overseas Importer (${expTyp})`,
          customerGstin: 'Export Supply',
          invoiceDate: rawDate,
          dateFormatted: formatDate(rawDate),
          taxableAmount: round2(taxable),
          igst: round2(igst),
          cgst: 0,
          sgst: 0,
          cess: round2(cess),
          grandTotal: round2(n(inv?.val) || taxable + igst + cess),
          expTyp,
          sbnum: inv?.sbnum || null,
          sbdt: inv?.sbdt || null,
          sbpcode: inv?.sbpcode || null,
          isPortal: true
        });
      });
    });

    return items;
  }, [liveGstr1Data]);

  const portalHsnItems = useMemo(() => {
    if (!liveGstr1Data) return [];

    const hsnData =
      liveGstr1Data.hsn?.data ||
      (Array.isArray(liveGstr1Data.hsn) ? liveGstr1Data.hsn : null);

    if (!Array.isArray(hsnData) || hsnData.length === 0) return [];

    return hsnData.map((h, idx) => {
      // Updated backend may send value-wise HSN rows using `val` instead of `rt`.
      const taxable = n(h.txval ?? h.val);
      const igst = n(h.iamt ?? h.igst);
      const cgst = n(h.camt ?? h.cgst);
      const sgst = n(h.samt ?? h.sgst);
      const cess = n(h.csamt ?? h.cess);
      const tax = round2(igst + cgst + sgst + cess);

      return {
        _id: `portal-hsn-${h.hsn_sc || idx}-${h.uqc || ''}-${h.rt ?? ''}-${h.val ?? ''}`,
        invoiceNumber: h.hsn_sc || `HSN-${idx + 1}`,
        customerName: h.desc || 'General Goods/Services',
        customerGstin: `Qty: ${h.qty || 1} ${h.uqc || 'NOS'}`,
        taxableAmount: round2(taxable),
        igst: round2(igst),
        cgst: round2(cgst),
        sgst: round2(sgst),
        cess: round2(cess),
        grandTotal: round2(taxable + tax),
        qty: n(h.qty),
        uqc: h.uqc || 'NOS',
        rate: h.rt,
        val: h.val,
        isHsnRow: true,
        isPortal: true
      };
    });
  }, [liveGstr1Data]);

  const portalDocItems = useMemo(() => {
    if (!liveGstr1Data) return [];

    const docDet =
      liveGstr1Data.doc_issue?.doc_det ||
      (Array.isArray(liveGstr1Data.doc_issue) ? liveGstr1Data.doc_issue : null);

    if (!Array.isArray(docDet) || docDet.length === 0) {
      // Fallback to prepareData docSeries if available.
      const series = sectionDetails?.docSeries;
      if (Array.isArray(series) && series.length > 0) {
        return series
          .filter((s) => s?.totnum > 0)
          .map((s, idx) => ({
            _id: `local-doc-${s.typeCode || idx}`,
            invoiceNumber: `${s.from || '-'} to ${s.to || '-'}`,
            customerName: s.typeCode || 'Document Series',
            customerGstin: `Total: ${s.totnum || 0}, Cancel: ${s.cancel || 0}, Net: ${s.net_issue || 0}`,
            taxableAmount: n(s.totnum),
            grandTotal: n(s.totnum),
            totnum: n(s.totnum),
            cancel: n(s.cancel),
            netIssue: n(s.net_issue),
            isDocRow: true,
            isPortal: false
          }));
      }
      return [];
    }

    const rows = [];

    docDet.forEach((det, detIdx) => {
      const docs = Array.isArray(det?.docs) ? det.docs : [];

      docs.forEach((doc, docIdx) => {
        rows.push({
          _id: `portal-doc-${det?.doc_num || detIdx}-${docIdx}`,
          invoiceNumber: `${doc?.from || '-'} to ${doc?.to || '-'}`,
          customerName: det?.doc_typ || `Document Type ${det?.doc_num || ''}`.trim(),
          customerGstin: `Total: ${doc?.totnum || 0}, Cancel: ${doc?.cancel || 0}, Net: ${doc?.net_issue || 0}`,
          taxableAmount: n(doc?.totnum),
          grandTotal: n(doc?.totnum),
          totnum: n(doc?.totnum),
          cancel: n(doc?.cancel),
          netIssue: n(doc?.net_issue),
          docNum: det?.doc_num,
          docTyp: det?.doc_typ,
          isDocRow: true,
          isPortal: true
        });
      });
    });

    return rows;
  }, [liveGstr1Data, sectionDetails]);

  const portalInvoiceItems = useMemo(
    () => [
      ...portalB2bItems,
      ...portalB2clItems,
      ...portalB2csItems,
      ...portalExpItems,
      ...portalCdnrItems,
      ...portalCdnurItems
    ],
    [
      portalB2bItems,
      portalB2clItems,
      portalB2csItems,
      portalExpItems,
      portalCdnrItems,
      portalCdnurItems
    ]
  );

  const portalAllRows = useMemo(
    () => [
      ...portalInvoiceItems,
      ...portalHsnItems,
      ...portalDocItems
    ],
    [portalInvoiceItems, portalHsnItems, portalDocItems]
  );

  /* ------------------------------------------------------------------------ */
  /* Portal computed totals                                                   */
  /* ------------------------------------------------------------------------ */

  const portalComputedTotals = useMemo(() => {
    const taxable = sumField(portalInvoiceItems, 'taxableAmount');
    const igst = sumField(portalInvoiceItems, 'igst');
    const cgst = sumField(portalInvoiceItems, 'cgst');
    const sgst = sumField(portalInvoiceItems, 'sgst');
    const cess = sumField(portalInvoiceItems, 'cess');
    const totalTax = round2(igst + cgst + sgst + cess);
    const grandTotal = round2(taxable + totalTax);

    return {
      taxable,
      igst,
      cgst,
      sgst,
      cess,
      totalTax,
      grandTotal
    };
  }, [portalInvoiceItems]);

  const portalInvoiceCount = useMemo(
    () =>
      portalB2bItems.length +
      portalB2clItems.length +
      portalExpItems.length +
      portalCdnrItems.length +
      portalCdnurItems.length,
    [
      portalB2bItems.length,
      portalB2clItems.length,
      portalExpItems.length,
      portalCdnrItems.length,
      portalCdnurItems.length
    ]
  );

  /* ------------------------------------------------------------------------ */
  /* Effective GSTR-1 figures                                                 */
  /* ------------------------------------------------------------------------ */

  const localTotals = useMemo(
    () => ({
      taxable: round2(summary.totalTaxable),
      igst: round2(summary.totalIgst),
      cgst: round2(summary.totalCgst),
      sgst: round2(summary.totalSgst),
      cess: round2(summary.totalCess),
      totalTax:
        summary.totalTax !== undefined
          ? round2(summary.totalTax)
          : round2(
            n(summary.totalIgst) +
            n(summary.totalCgst) +
            n(summary.totalSgst) +
            n(summary.totalCess)
          ),
      grandTotal: round2(summary.grandTotal)
    }),
    [summary]
  );

  const portalTotals = useMemo(() => {
    if (liveGstr1Data?.totals) {
      return {
        taxable: round2(liveGstr1Data.totals.taxable),
        igst: round2(liveGstr1Data.totals.igst),
        cgst: round2(liveGstr1Data.totals.cgst),
        sgst: round2(liveGstr1Data.totals.sgst),
        cess: round2(liveGstr1Data.totals.cess),
        totalTax:
          liveGstr1Data.totals.totalTax !== undefined
            ? round2(liveGstr1Data.totals.totalTax)
            : round2(
              n(liveGstr1Data.totals.igst) +
              n(liveGstr1Data.totals.cgst) +
              n(liveGstr1Data.totals.sgst) +
              n(liveGstr1Data.totals.cess)
            ),
        grandTotal: round2(liveGstr1Data.totals.grandTotal)
      };
    }

    return portalComputedTotals;
  }, [liveGstr1Data, portalComputedTotals]);

  const activeGstr1Totals = isPortalGstr1Active ? portalTotals : localTotals;

  const g1Taxable = activeGstr1Totals.taxable;
  const g1Igst = activeGstr1Totals.igst;
  const g1Cgst = activeGstr1Totals.cgst;
  const g1Sgst = activeGstr1Totals.sgst;
  const g1Cess = activeGstr1Totals.cess;
  const g1TotalTax = activeGstr1Totals.totalTax;
  const g1GrandTotal = activeGstr1Totals.grandTotal;

  const g1InvoiceCount = isPortalGstr1Active
    ? portalInvoiceCount
    : n(summary.includedInvoices ?? summary.totalInvoices);

  /* ------------------------------------------------------------------------ */
  /* Portal section tax sums (compatibility with old UI)                      */
  /* ------------------------------------------------------------------------ */

  const portalB2clTaxable = useMemo(
    () => sumField(portalB2clItems, 'taxableAmount'),
    [portalB2clItems]
  );

  const portalB2clTax = useMemo(
    () => sumTaxRows(portalB2clItems),
    [portalB2clItems]
  );

  const portalB2csTaxable = useMemo(
    () => sumField(portalB2csItems, 'taxableAmount'),
    [portalB2csItems]
  );

  const portalB2csTax = useMemo(
    () => sumTaxRows(portalB2csItems),
    [portalB2csItems]
  );

  const portalCdnrTaxable = useMemo(
    () => sumField(portalCdnrItems, 'taxableAmount'),
    [portalCdnrItems]
  );

  const portalCdnrTax = useMemo(
    () => sumTaxRows(portalCdnrItems),
    [portalCdnrItems]
  );

  const portalExpTaxable = useMemo(
    () => sumField(portalExpItems, 'taxableAmount'),
    [portalExpItems]
  );

  const portalExpTax = useMemo(
    () => sumTaxRows(portalExpItems),
    [portalExpItems]
  );

  const portalHsnTaxable = useMemo(
    () => sumField(portalHsnItems, 'taxableAmount'),
    [portalHsnItems]
  );

  const portalHsnTax = useMemo(
    () => sumTaxRows(portalHsnItems),
    [portalHsnItems]
  );

  /* ------------------------------------------------------------------------ */
  /* Filing records                                                           */
  /* ------------------------------------------------------------------------ */

  const gstr1Filing = useMemo(() => {
    if (!Array.isArray(filings)) return null;

    return (
      filings.find(
        (f) =>
          String(f.period) === String(period) &&
          normalizeReturnType(f.type) === 'GSTR1' &&
          String(f.status).toLowerCase() === 'filed'
      ) || null
    );
  }, [filings, period]);

  const gstr1ReadyFiling = useMemo(() => {
    if (!Array.isArray(filings)) return null;

    return (
      filings.find(
        (f) =>
          String(f.period) === String(period) &&
          normalizeReturnType(f.type) === 'GSTR1' &&
          String(f.status).toLowerCase() === 'readytoevc'
      ) || null
    );
  }, [filings, period]);

  const gstr3bFiling = useMemo(() => {
    if (!Array.isArray(filings)) return null;

    return (
      filings.find(
        (f) =>
          String(f.period) === String(period) &&
          normalizeReturnType(f.type) === 'GSTR3B' &&
          String(f.status).toLowerCase() === 'filed'
      ) || null
    );
  }, [filings, period]);

  const gstr3bReadyFiling = useMemo(() => {
    if (!Array.isArray(filings)) return null;

    return (
      filings.find(
        (f) =>
          String(f.period) === String(period) &&
          normalizeReturnType(f.type) === 'GSTR3B' &&
          String(f.status).toLowerCase() === 'readytoevc'
      ) || null
    );
  }, [filings, period]);

  /* ------------------------------------------------------------------------ */
  /* GSTR-2B derived                                                          */
  /* ------------------------------------------------------------------------ */

  const g2bTotals = useMemo(
    () =>
      gstr2bData?.totals || {
        taxable: 0,
        igst: 0,
        cgst: 0,
        sgst: 0,
        cess: 0
      },
    [gstr2bData]
  );

  const g2bTotalTax = useMemo(
    () =>
      round2(
        n(g2bTotals.igst) +
        n(g2bTotals.cgst) +
        n(g2bTotals.sgst) +
        n(g2bTotals.cess)
      ),
    [g2bTotals]
  );

  const g2bCount = useMemo(
    () =>
      gstr2bData?.invoices?.length ||
      gstr2bData?.rows?.length ||
      0,
    [gstr2bData]
  );

  const gstr2bListedItc = g2bTotalTax;

  /* ------------------------------------------------------------------------ */
  /* GSTR-3B derived                                                          */
  /* ------------------------------------------------------------------------ */

  const g3bRows = useMemo(
    () => (Array.isArray(gstr3bData?.rows) ? gstr3bData.rows : []),
    [gstr3bData]
  );

  const g3bOutwardRows = useMemo(
    () =>
      g3bRows.filter((row) =>
        /^3\.1(?:\(|\s|$)/i.test(String(row?.label || ''))
      ),
    [g3bRows]
  );

  const g3bItcRows = useMemo(
    () =>
      g3bRows.filter((row) =>
        /^4(?:\s|\.|$)/i.test(String(row?.label || ''))
      ),
    [g3bRows]
  );

  const outwardLiability = useMemo(
    () => (g3bOutwardRows.length ? totalTaxForRows(g3bOutwardRows) : null),
    [g3bOutwardRows]
  );

  const outwardTaxableTurnover = useMemo(
    () =>
      g3bOutwardRows.length
        ? round2(
          g3bOutwardRows.reduce(
            (total, row) => total + n(row?.taxable),
            0
          )
        )
        : null,
    [g3bOutwardRows]
  );

  const g3bItcAvailable = useMemo(
    () => (g3bItcRows.length ? totalTaxForRows(g3bItcRows) : null),
    [g3bItcRows]
  );

  /* ------------------------------------------------------------------------ */
  /* Return                                                                   */
  /* ------------------------------------------------------------------------ */

  return {
    // GSTR-1 state
    gstr1Loading,
    setGstr1Loading,
    gstr1Error,
    setGstr1Error,
    liveGstr1Error,
    setLiveGstr1Error,
    prepareData,
    setPrepareData,
    liveGstr1Data,
    setLiveGstr1Data,
    saveResult,
    setSaveResult,
    gstr1ViewMode,
    setGstr1ViewMode,
    isDataNotAvailable,
    setIsDataNotAvailable,

    // GSTR-1 actions
    fetchGstr1Data,
    refreshGstr1,
    loadLiveGstr1,
    loadLocalGstr1,
    clearGstr1Error,

    // Exclusions
    excludedIds,
    setExcludedIds,
    canModifyExclusions,
    toggleExcludeInvoice,
    handleExcludeAll,
    handleIncludeAll,
    clearExclusions,

    // GSTR-1 derived local data
    summary,
    sectionDetails,
    validationIssues,
    hasBlockingIssues,
    blockingIssueCount,
    gstr1Warnings,

    // Portal GSTR-1 derived
    hasPortalGstr1,
    isPortalGstr1Active,
    portalB2bItems,
    portalB2clItems,
    portalB2csItems,
    portalCdnrItems,
    portalCdnurItems,
    portalExpItems,
    portalHsnItems,
    portalDocItems,
    portalInvoiceItems,
    portalAllRows,

    // Portal section sums (backward compatible)
    portalB2clTaxable,
    portalB2clTax,
    portalB2csTaxable,
    portalB2csTax,
    portalCdnrTaxable,
    portalCdnrTax,
    portalExpTaxable,
    portalExpTax,
    portalHsnTaxable,
    portalHsnTax,

    // Effective GSTR-1 figures
    g1Taxable,
    g1Igst,
    g1Cgst,
    g1Sgst,
    g1Cess,
    g1TotalTax,
    g1GrandTotal,
    g1InvoiceCount,

    // GSTR-2B state
    gstr2bData,
    setGstr2bData,
    fetchGstr2bData,
    g2bTotals,
    g2bTotalTax,
    g2bCount,
    gstr2bListedItc,

    // GSTR-3B state
    gstr3bData,
    setGstr3bData,
    fetchGstr3bData,
    g3bRows,
    g3bOutwardRows,
    g3bItcRows,
    outwardLiability,
    outwardTaxableTurnover,
    g3bItcAvailable,

    // Other returns status
    otherReturnsLoading,
    setOtherReturnsLoading,
    otherReturnsError,
    setOtherReturnsError,
    fetchOtherReturns,
    clearOtherReturnsError,

    // Seeding
    seeding,
    seedSuccessMsg,
    setSeedSuccessMsg,
    handleSeedSampleInvoices,

    // Filing history/status
    filings,
    gstr1Filing,
    gstr1ReadyFiling,
    gstr3bFiling,
    gstr3bReadyFiling
  };
}

export default useReturnData;