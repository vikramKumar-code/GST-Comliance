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
import {
  mapPortalB2bItems,
  calculatePortalTax,
  calculatePortalTaxable,
  totalTaxForRows
} from '../utils/returnHelpers';
import { formatDate } from '../utils/format';

/**
 * Custom hook to centralize all GST return data fetching logic
 * @param {string} period MMYYYY
 * @param {Set|Array} [externalExcludedIds]
 * @returns {Object} All return data states, computations, and fetch functions
 */
export function useReturnData(period, externalExcludedIds) {
  const { user } = useAuth();

  // Exclusion State: supports caller-passed externalExcludedIds or internal state
  const [internalExcludedIds, setInternalExcludedIds] = useState(new Set());
  const excludedIds = externalExcludedIds !== undefined ? externalExcludedIds : internalExcludedIds;
  const setExcludedIds = setInternalExcludedIds;

  // GSTR-1 Data State
  const [gstr1Loading, setGstr1Loading] = useState(true);
  const [gstr1Error, setGstr1Error] = useState(null);
  const [prepareData, setPrepareData] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [gstr1ViewMode, setGstr1ViewMode] = useState('local');
  const [liveGstr1Data, setLiveGstr1Data] = useState(null);
  const [filings, setFilings] = useState([]);

  // Other Returns (GSTR-2B & GSTR-3B) State
  const [gstr2bData, setGstr2bData] = useState(null);
  const [gstr3bData, setGstr3bData] = useState(null);
  const [otherReturnsLoading, setOtherReturnsLoading] = useState(Boolean(user?.hasPortalSession));
  const [otherReturnsError, setOtherReturnsError] = useState(null);

  // Seeding State
  const [seeding, setSeeding] = useState(false);
  const [seedSuccessMsg, setSeedSuccessMsg] = useState(null);

  // Request IDs to prevent race conditions
  const gstr1RequestId = useRef(0);
  const otherReturnsRequestId = useRef(0);

  // Ref for excludedIds to avoid stale closures
  const excludedIdsRef = useRef(excludedIds);
  useEffect(() => {
    excludedIdsRef.current = excludedIds;
  }, [excludedIds]);

  // ============================================================================
  // DATA FETCHING FUNCTIONS (Using Promise.allSettled)
  // ============================================================================

  const fetchGstr1Data = useCallback(async (p, passedExcluded, fetchLive = false) => {
    if (!p) return;
    const currentExcluded = passedExcluded !== undefined ? passedExcluded : excludedIdsRef.current;
    const requestId = ++gstr1RequestId.current;
    try {
      const calls = [
        prepareGstr1(p, Array.from(currentExcluded)),
        getReturnsSummary(p)
      ];
      if (fetchLive) {
        calls.push(getGstr1(p));
      }
      const results = await Promise.allSettled(calls);
      if (requestId !== gstr1RequestId.current) return;

      const prepareRes = results[0];
      const summaryRes = results[1];
      const portalRes = fetchLive ? results[2] : null;

      setPrepareData(prepareRes.status === 'fulfilled' ? prepareRes.value : null);
      if (summaryRes?.status === 'fulfilled') {
        const fData = summaryRes.value?.filings || summaryRes.value?.data?.filings || [];
        setFilings(Array.isArray(fData) ? fData : []);
      }
      if (portalRes) {
        setLiveGstr1Data(portalRes.status === 'fulfilled' ? portalRes.value : null);
      }
      setSaveResult(null);
      const failures = [prepareRes, ...(portalRes ? [portalRes] : [])]
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason?.message || 'A GSTR-1 data request failed.');
      setGstr1Error(failures.length ? new Error(failures.join(' ')) : null);
    } catch (err) {
      if (requestId === gstr1RequestId.current) setGstr1Error(err);
    } finally {
      if (requestId === gstr1RequestId.current) setGstr1Loading(false);
    }
  }, []);

  const fetchGstr2bData = useCallback(async (p) => {
    if (!p) return;
    const requestId = ++otherReturnsRequestId.current;
    setOtherReturnsLoading(true);
    setOtherReturnsError(null);
    try {
      const res2b = await getGstr2b(p);
      if (requestId !== otherReturnsRequestId.current) return;
      setGstr2bData(res2b);
    } catch (err) {
      if (requestId === otherReturnsRequestId.current) setOtherReturnsError(err);
    } finally {
      if (requestId === otherReturnsRequestId.current) setOtherReturnsLoading(false);
    }
  }, []);

  const fetchGstr3bData = useCallback(async (p) => {
    if (!p) return;
    const requestId = ++otherReturnsRequestId.current;
    setOtherReturnsLoading(true);
    setOtherReturnsError(null);
    try {
      const res3b = await getGstr3b(p);
      if (requestId !== otherReturnsRequestId.current) return;
      setGstr3bData(res3b);
    } catch (err) {
      if (requestId === otherReturnsRequestId.current) setOtherReturnsError(err);
    } finally {
      if (requestId === otherReturnsRequestId.current) setOtherReturnsLoading(false);
    }
  }, []);

  const fetchOtherReturns = useCallback(async (p) => {
    if (!p) return;
    await Promise.allSettled([fetchGstr2bData(p), fetchGstr3bData(p)]);
  }, [fetchGstr2bData, fetchGstr3bData]);

  const handleSeedSampleInvoices = async () => {
    setSeeding(true);
    setSeedSuccessMsg(null);
    try {
      const res = await seedSampleInvoices(period);
      setSeedSuccessMsg(res?.message || 'Sample invoices generated successfully!');
      setGstr1Loading(true);
      setGstr1Error(null);
      setPrepareData(null);
      await fetchGstr1Data(period, excludedIdsRef.current, false);
    } catch (err) {
      console.error('Failed to generate sample invoices:', err);
      setSeedSuccessMsg('Failed to generate sample invoices.');
    } finally {
      setSeeding(false);
    }
  };

  // Exclusion handlers
  const toggleExcludeInvoice = (invoiceId) => {
    const idStr = String(invoiceId);
    setGstr1Loading(true);
    setGstr1Error(null);
    setPrepareData(null);
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(idStr)) next.delete(idStr);
      else next.add(idStr);
      return next;
    });
  };

  const handleExcludeAll = (items) => {
    if (!window.confirm(`Exclude all ${items.length} items from this return?`)) return;
    const allIds = items
      .filter((item) => !item.isPortal && !item.isHsnRow && !item.isDocRow)
      .map((item) => String(item._id));

    setExcludedIds((prev) => {
      const next = new Set(prev);
      allIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleIncludeAll = (items) => {
    const allIds = items.map((item) => String(item._id));
    setExcludedIds((prev) => {
      const next = new Set(prev);
      allIds.forEach((id) => next.delete(id));
      return next;
    });
  };

  // Prepare effect when excludedIds changes (with initial mount guard)
  const isInitialExcludedMount = useRef(true);
  useEffect(() => {
    if (isInitialExcludedMount.current) {
      isInitialExcludedMount.current = false;
      return;
    }
    prepareGstr1(period, Array.from(excludedIds))
      .then((res) => setPrepareData(res))
      .catch((err) => setGstr1Error(err));
  }, [excludedIds, period]);

  // Initial and period-change fetch with proper cleanup
  useEffect(() => {
    let active = true;
    const loadReturns = async () => {
      await Promise.resolve();
      if (!active) return;
      fetchGstr1Data(period, undefined, false);
    };
    loadReturns();
    return () => {
      active = false;
    };
  }, [fetchGstr1Data, period]);

  // ============================================================================
  // MEMOIZED COMPUTATIONS
  // ============================================================================

  const summary = prepareData?.summary || {};
  const sectionDetails = prepareData?.sectionDetails || {
    b2b: [],
    b2cl: [],
    b2cs: [],
    exp: [],
    cdnr: [],
    hsn: [],
    docIssue: []
  };

  const hasPortalGstr1 = useMemo(() => Boolean(
    (liveGstr1Data?.totals?.taxable || 0) > 0 ||
    (liveGstr1Data?.rows && liveGstr1Data.rows.length > 0) ||
    liveGstr1Data?.fetchedAt
  ), [liveGstr1Data]);

  const isPortalGstr1Active = gstr1ViewMode === 'taxpro';

  // Filing Records & Status for Current Period
  const gstr1Filing = useMemo(() => {
    if (!Array.isArray(filings)) return null;
    return filings.find(
      (f) => String(f.period) === String(period) &&
        (String(f.type).toUpperCase() === 'GSTR1' || String(f.type).toUpperCase() === 'GSTR-1') &&
        (String(f.status).toLowerCase() === 'filed')
    ) || null;
  }, [filings, period]);

  const gstr3bFiling = useMemo(() => {
    if (!Array.isArray(filings)) return null;
    return filings.find(
      (f) => String(f.period) === String(period) &&
        (String(f.type).toUpperCase() === 'GSTR3B' || String(f.type).toUpperCase() === 'GSTR-3B') &&
        (String(f.status).toLowerCase() === 'filed')
    ) || null;
  }, [filings, period]);

  // Portal data mappings
  const portalB2bItems = useMemo(() => mapPortalB2bItems(liveGstr1Data), [liveGstr1Data]);

  const portalB2clItems = useMemo(() => {
    if (!liveGstr1Data) return [];
    if (Array.isArray(liveGstr1Data.b2cl) && liveGstr1Data.b2cl.length > 0) {
      const items = [];
      liveGstr1Data.b2cl.forEach((b, bIdx) => {
        (b.inv || []).forEach((inv, iIdx) => {
          let taxable = 0, igst = 0, cess = 0;
          (inv.itms || []).forEach((itm) => {
            const d = itm.itm_det || itm;
            taxable += Number(d.txval || 0);
            igst += Number(d.iamt || d.igst || 0);
            cess += Number(d.csamt || d.cess || 0);
          });
          const rawDate = inv.idt || liveGstr1Data.fetchedAt;
          items.push({
            _id: `portal-b2cl-${bIdx}-${iIdx}`,
            invoiceNumber: inv.inum || `B2CL-${items.length + 1}`,
            customerName: `Unregistered Buyer (POS: ${b.pos || inv.pos || 'Inter-state'})`,
            customerGstin: 'Unregistered Consumer',
            invoiceDate: rawDate,
            dateFormatted: formatDate(rawDate),
            taxableAmount: taxable,
            igst,
            cgst: 0,
            sgst: 0,
            grandTotal: Number(inv.val || (taxable + igst + cess)),
            isPortal: true
          });
        });
      });
      return items;
    }
    return [];
  }, [liveGstr1Data]);

  const portalB2csItems = useMemo(() => {
    if (!liveGstr1Data) return [];
    if (Array.isArray(liveGstr1Data.b2cs) && liveGstr1Data.b2cs.length > 0) {
      return liveGstr1Data.b2cs.map((item, i) => ({
        _id: `portal-b2cs-${i}`,
        invoiceNumber: `B2CS-POS-${item.pos || '00'}`,
        customerName: `Retail Consumer (Rate: ${item.rt !== undefined ? item.rt + '%' : 'Standard'})`,
        customerGstin: 'Unregistered',
        invoiceDate: liveGstr1Data.fetchedAt,
        dateFormatted: formatDate(liveGstr1Data.fetchedAt),
        taxableAmount: Number(item.txval || 0),
        igst: Number(item.iamt || item.igst || 0),
        cgst: Number(item.camt || item.cgst || 0),
        sgst: Number(item.samt || item.sgst || 0),
        grandTotal: Number(item.txval || 0) + Number(item.iamt || 0) + Number(item.camt || 0) + Number(item.samt || 0) + Number(item.csamt || item.cess || 0),
        isPortal: true
      }));
    }
    return [];
  }, [liveGstr1Data]);

  const portalCdnrItems = useMemo(() => {
    if (!liveGstr1Data) return [];
    if (Array.isArray(liveGstr1Data.cdnr) && liveGstr1Data.cdnr.length > 0) {
      const items = [];
      liveGstr1Data.cdnr.forEach((party, pIdx) => {
        const ctin = party.ctin || 'Registered Party';
        (party.nt || []).forEach((nt, nIdx) => {
          let taxable = 0, igst = 0, cgst = 0, sgst = 0;
          (nt.itms || []).forEach((itm) => {
            const d = itm.itm_det || itm;
            taxable += Number(d.txval || 0);
            igst += Number(d.iamt || d.igst || 0);
            cgst += Number(d.camt || d.cgst || 0);
            sgst += Number(d.samt || d.sgst || 0);
          });
          const rawDate = nt.nt_dt || nt.idt || liveGstr1Data.fetchedAt;
          items.push({
            _id: `portal-cdnr-${pIdx}-${nIdx}`,
            invoiceNumber: nt.nt_num || `NOTE-${items.length + 1}`,
            customerName: party.trdnm || party.cname || 'Registered Party',
            customerGstin: ctin,
            invoiceDate: rawDate,
            dateFormatted: formatDate(rawDate),
            taxableAmount: taxable,
            igst,
            cgst,
            sgst,
            grandTotal: taxable + igst + cgst + sgst,
            isPortal: true
          });
        });
      });
      return items;
    }
    return [];
  }, [liveGstr1Data]);

  const portalExpItems = useMemo(() => {
    if (!liveGstr1Data) return [];
    if (Array.isArray(liveGstr1Data.exp) && liveGstr1Data.exp.length > 0) {
      const items = [];
      liveGstr1Data.exp.forEach((group, gIdx) => {
        (group.inv || []).forEach((inv, iIdx) => {
          let taxable = 0, igst = 0;
          (inv.itms || []).forEach((itm) => {
            const d = itm.itm_det || itm;
            taxable += Number(d.txval || 0);
            igst += Number(d.iamt || d.igst || 0);
          });
          const rawDate = inv.idt || liveGstr1Data.fetchedAt;
          items.push({
            _id: `portal-exp-${gIdx}-${iIdx}`,
            invoiceNumber: inv.inum || `EXP-${items.length + 1}`,
            customerName: `Overseas Importer (${group.exp_typ || 'WOPAY'})`,
            customerGstin: 'Export Supply',
            invoiceDate: rawDate,
            dateFormatted: formatDate(rawDate),
            taxableAmount: taxable,
            igst,
            cgst: 0,
            sgst: 0,
            grandTotal: taxable + igst,
            isPortal: true
          });
        });
      });
      return items;
    }
    return [];
  }, [liveGstr1Data]);

  const portalHsnItems = useMemo(() => {
    if (!liveGstr1Data) return [];
    const hsnData = liveGstr1Data.hsn?.data || (Array.isArray(liveGstr1Data.hsn) ? liveGstr1Data.hsn : null);
    if (Array.isArray(hsnData) && hsnData.length > 0) {
      return hsnData.map((h, i) => ({
        _id: `portal-hsn-${i}`,
        invoiceNumber: h.hsn_sc || `HSN-${i + 1}`,
        customerName: h.desc || 'General Goods/Services',
        customerGstin: `Qty: ${h.qty || 1} ${h.uqc || 'NOS'}`,
        taxableAmount: Number(h.txval || 0),
        igst: Number(h.iamt || h.igst || 0),
        cgst: Number(h.camt || h.cgst || 0),
        sgst: Number(h.samt || h.sgst || 0),
        grandTotal: Number(h.txval || 0) + Number(h.iamt || 0) + Number(h.camt || 0) + Number(h.samt || 0),
        isHsnRow: true,
        isPortal: true
      }));
    }
    return [];
  }, [liveGstr1Data]);

  const portalDocItems = useMemo(() => {
    if (!liveGstr1Data || portalB2bItems.length === 0) return [];
    const nums = portalB2bItems.map((i) => i.invoiceNumber).filter(Boolean);
    const from = nums[0] || 'INV-001';
    const to = nums[nums.length - 1] || 'INV-001';
    return [{
      _id: 'portal-doc-1',
      invoiceNumber: `${from} to ${to}`,
      customerName: 'Tax Invoices Serial Series',
      customerGstin: `${nums.length} Documents Issued`,
      taxableAmount: nums.length,
      grandTotal: nums.length,
      isDocRow: true,
      isPortal: true
    }];
  }, [liveGstr1Data, portalB2bItems]);

  const portalAllInvoices = useMemo(() => [
    ...portalB2bItems,
    ...portalB2clItems,
    ...portalB2csItems,
    ...portalExpItems,
    ...portalCdnrItems
  ], [portalB2bItems, portalB2clItems, portalB2csItems, portalExpItems, portalCdnrItems]);

  // Portal tax sums
  const portalB2clTaxable = useMemo(() => calculatePortalTaxable(portalB2clItems), [portalB2clItems]);
  const portalB2clTax = useMemo(() => portalB2clItems.reduce((acc, i) => acc + (i.igst || 0), 0), [portalB2clItems]);
  const portalB2csTaxable = useMemo(() => calculatePortalTaxable(portalB2csItems), [portalB2csItems]);
  const portalB2csTax = useMemo(() => calculatePortalTax(portalB2csItems), [portalB2csItems]);
  const portalCdnrTaxable = useMemo(() => calculatePortalTaxable(portalCdnrItems), [portalCdnrItems]);
  const portalCdnrTax = useMemo(() => calculatePortalTax(portalCdnrItems), [portalCdnrItems]);
  const portalExpTaxable = useMemo(() => calculatePortalTaxable(portalExpItems), [portalExpItems]);
  const portalExpTax = useMemo(() => portalExpItems.reduce((acc, i) => acc + (i.igst || 0), 0), [portalExpItems]);
  const portalHsnTaxable = useMemo(() => calculatePortalTaxable(portalHsnItems), [portalHsnItems]);
  const portalHsnTax = useMemo(() => calculatePortalTax(portalHsnItems), [portalHsnItems]);

  // Effective GSTR-1 figures
  const g1Taxable = isPortalGstr1Active ? Number(liveGstr1Data?.totals?.taxable || 0) : Number(summary?.totalTaxable || 0);
  const g1Igst = isPortalGstr1Active ? Number(liveGstr1Data?.totals?.igst || 0) : Number(summary?.totalIgst || 0);
  const g1Cgst = isPortalGstr1Active ? Number(liveGstr1Data?.totals?.cgst || 0) : Number(summary?.totalCgst || 0);
  const g1Sgst = isPortalGstr1Active ? Number(liveGstr1Data?.totals?.sgst || 0) : Number(summary?.totalSgst || 0);
  const g1TotalTax = isPortalGstr1Active ? Number((g1Igst + g1Cgst + g1Sgst).toFixed(2)) : Number(summary?.totalTax || 0);
  const g1InvoiceCount = isPortalGstr1Active ? (portalB2bItems.length || (g1Taxable > 0 ? 1 : 0)) : Number(summary?.totalInvoices || 0);

  // GSTR-2B & GSTR-3B figures
  const g2bTotals = gstr2bData?.totals || { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  const g2bTotalTax = Number(((g2bTotals.igst || 0) + (g2bTotals.cgst || 0) + (g2bTotals.sgst || 0) + (g2bTotals.cess || 0)).toFixed(2));
  const g2bCount = (gstr2bData?.invoices?.length || gstr2bData?.rows?.length) ?? 0;

  const g3bRows = Array.isArray(gstr3bData?.rows) ? gstr3bData.rows : [];
  const g3bOutwardRows = g3bRows.filter((row) => /^3\.1(?:\(|\s|$)/i.test(row.label || ''));
  const g3bItcRows = g3bRows.filter((row) => /^4(?:\s|\.|$)/i.test(row.label || ''));

  const outwardLiability = g3bOutwardRows.length ? totalTaxForRows(g3bOutwardRows) : null;
  const outwardTaxableTurnover = g3bOutwardRows.length ? Number(g3bOutwardRows.reduce((total, row) => total + Number(row.taxable || 0), 0).toFixed(2)) : null;
  const g3bItcAvailable = g3bItcRows.length ? totalTaxForRows(g3bItcRows) : null;
  const gstr2bListedItc = g2bTotalTax;

  return {
    // GSTR-1 State & Functions
    gstr1Loading,
    setGstr1Loading,
    gstr1Error,
    setGstr1Error,
    prepareData,
    setPrepareData,
    liveGstr1Data,
    setLiveGstr1Data,
    fetchGstr1Data,
    saveResult,
    setSaveResult,
    gstr1ViewMode,
    setGstr1ViewMode,
    excludedIds,
    setExcludedIds,

    // GSTR-2B State & Functions
    gstr2bData,
    setGstr2bData,
    fetchGstr2bData,
    g2bTotals,
    g2bTotalTax,
    g2bCount,
    gstr2bListedItc,

    // GSTR-3B State & Functions
    gstr3bData,
    setGstr3bData,
    fetchGstr3bData,
    g3bRows,
    g3bOutwardRows,
    g3bItcRows,
    outwardLiability,
    outwardTaxableTurnover,
    g3bItcAvailable,

    // Other returns status & combined fetch
    otherReturnsLoading,
    setOtherReturnsLoading,
    otherReturnsError,
    setOtherReturnsError,
    fetchOtherReturns,

    // Seeding
    seeding,
    seedSuccessMsg,
    setSeedSuccessMsg,
    handleSeedSampleInvoices,

    // Exclusions
    toggleExcludeInvoice,
    handleExcludeAll,
    handleIncludeAll,

    // Computations & summaries
    summary,
    sectionDetails,
    hasPortalGstr1,
    isPortalGstr1Active,
    portalB2bItems,
    portalB2clItems,
    portalB2csItems,
    portalCdnrItems,
    portalExpItems,
    portalHsnItems,
    portalDocItems,
    portalAllInvoices,
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
    g1Taxable,
    g1Igst,
    g1Cgst,
    g1Sgst,
    g1TotalTax,
    g1InvoiceCount,

    // Filing history & status
    filings,
    gstr1Filing,
    gstr3bFiling
  };
}

export default useReturnData;
