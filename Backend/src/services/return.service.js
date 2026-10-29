const FinaggService = require('./finagg.service');
const Return = require('../models/Return');
const Filing = require('../models/Filing');
const { encrypt, decrypt } = require('../utils/crypto');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const SessionService = require('./session.service');
const Session = require('../models/Session');

class ReturnService {
  /**
   * Helper to sum numerical fields across rows
   */
  static _calculateTotals(rows) {
    return rows.reduce(
      (acc, row) => ({
        taxable: acc.taxable + (Number(row.taxable) || 0),
        igst: acc.igst + (Number(row.igst) || 0),
        cgst: acc.cgst + (Number(row.cgst) || 0),
        sgst: acc.sgst + (Number(row.sgst) || 0),
        cess: acc.cess + (Number(row.cess) || 0)
      }),
      { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
    );
  }

  /**
   * Map raw provider GSTR-1 payload to internal ReturnData shape
   */
  static mapGstr1(raw, period, provider) {
    if (!raw || typeof raw !== 'object') {
      throw ApiError.providerError('TaxPro GSTR-1 mapper received invalid payload', 502);
    }

    const isTaxPro = provider === 'taxpro' || (!provider && FinaggService.getProviderName() === 'taxpro');

    // 1. Real TaxPro B2B Invoices payload (e.g., action=B2B)
    if (Array.isArray(raw.b2b)) {
      const rows = [];
      for (const buyer of raw.b2b) {
        const ctin = buyer.ctin || 'Registered Buyer';
        let buyerTaxable = 0;
        let buyerIgst = 0;
        let buyerCgst = 0;
        let buyerSgst = 0;
        let buyerCess = 0;

        for (const inv of (buyer.inv || [])) {
          for (const itm of (inv.itms || [])) {
            const det = itm.itm_det || itm;
            buyerTaxable += Number(det.txval || 0);
            buyerIgst += Number(det.iamt || 0);
            buyerCgst += Number(det.camt || 0);
            buyerSgst += Number(det.samt || 0);
            buyerCess += Number(det.csamt || 0);
          }
        }

        rows.push({
          label: `4A - B2B Supplies (${ctin})`,
          taxable: Math.round(buyerTaxable * 100) / 100,
          igst: Math.round(buyerIgst * 100) / 100,
          cgst: Math.round(buyerCgst * 100) / 100,
          sgst: Math.round(buyerSgst * 100) / 100,
          cess: Math.round(buyerCess * 100) / 100
        });
      }

      // Map Table 7 B2CS supplies if present
      if (Array.isArray(raw.b2cs)) {
        for (const item of raw.b2cs) {
          const pos = item.pos ? ` (POS: ${item.pos})` : '';
          const rt = item.rt !== undefined ? ` @${item.rt}%` : '';
          rows.push({
            label: `7 - B2C Supplies${pos}${rt}`,
            taxable: Math.round(Number(item.txval || 0) * 100) / 100,
            igst: Math.round(Number(item.iamt || 0) * 100) / 100,
            cgst: Math.round(Number(item.camt || 0) * 100) / 100,
            sgst: Math.round(Number(item.samt || 0) * 100) / 100,
            cess: Math.round(Number(item.csamt || 0) * 100) / 100
          });
        }
      }

      const totals = ReturnService._calculateTotals(rows);
      return {
        type: 'GSTR1',
        period,
        rows,
        totals,
        fetchedAt: new Date().toISOString()
      };
    }

    // 2. Real TaxPro GSTR-1 Summary payload (action=RETSUM)
    if (Array.isArray(raw.sec_sum)) {
      const rows = raw.sec_sum.map((sec) => ({
        label: sec.sec_nm ? `${sec.sec_nm} - Outward Supplies` : (sec.table || 'Outward Supplies'),
        taxable: Number(sec.ttl_taxable ?? sec.ttl_val ?? 0),
        igst: Number(sec.ttl_igst ?? 0),
        cgst: Number(sec.ttl_cgst ?? 0),
        sgst: Number(sec.ttl_sgst ?? 0),
        cess: Number(sec.ttl_cess ?? 0)
      }));

      const totals = ReturnService._calculateTotals(rows);
      return {
        type: 'GSTR1',
        period,
        rows,
        totals,
        fetchedAt: new Date().toISOString()
      };
    }

    // 3. Mock mode sections
    if (Array.isArray(raw.sections)) {
      const rows = raw.sections.map((sec) => ({
        label: sec.table || sec.name || 'Outward Supplies',
        taxable: Number(sec.taxable_value ?? sec.taxable ?? 0),
        igst: Number(sec.igst_amount ?? sec.igst ?? 0),
        cgst: Number(sec.cgst_amount ?? sec.cgst ?? 0),
        sgst: Number(sec.sgst_amount ?? sec.sgst ?? 0),
        cess: Number(sec.cess_amount ?? sec.cess ?? 0)
      }));

      const totals = ReturnService._calculateTotals(rows);
      return {
        type: 'GSTR1',
        period,
        rows,
        totals,
        fetchedAt: new Date().toISOString()
      };
    }

    // In taxpro mode without recognized return data, fail-closed per Test 14
    if (isTaxPro) {
      throw ApiError.providerError('TaxPro GSTR-1 mapper needs real sample', 502);
    }

    return {
      type: 'GSTR1',
      period,
      rows: [],
      totals: { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 },
      fetchedAt: new Date().toISOString()
    };
  }

  /**
   * Map raw provider GSTR-2B payload to internal ReturnData shape
   */
  static mapGstr2b(raw, period, provider) {
    if (!raw || typeof raw !== 'object') {
      throw ApiError.providerError('TaxPro GSTR-2B mapper received invalid payload', 502);
    }

    const isTaxPro = provider === 'taxpro' || (!provider && FinaggService.getProviderName() === 'taxpro');

    // 1. Real TaxPro / GSTN GSTR-2B (data.docdata or itc_elg)
    const docData = raw.data?.docdata || raw.docdata || raw.data;
    const itcElg = raw.data?.itc_elg || raw.itc_elg;

    if (docData || itcElg) {
      const rows = [];

      // Inward B2B supplies
      const b2bSupplies = docData?.b2b || [];
      if (Array.isArray(b2bSupplies) && b2bSupplies.length > 0) {
        let b2bTaxable = 0, b2bIgst = 0, b2bCgst = 0, b2bSgst = 0, b2bCess = 0;
        for (const sup of b2bSupplies) {
          for (const inv of (sup.inv || [])) {
            for (const itm of (inv.itms || [])) {
              const det = itm.itm_det || itm;
              b2bTaxable += Number(det.txval || 0);
              b2bIgst += Number(det.iamt || 0);
              b2bCgst += Number(det.camt || 0);
              b2bSgst += Number(det.samt || 0);
              b2bCess += Number(det.csamt || 0);
            }
          }
        }
        rows.push({
          label: 'B2B - Inward supplies from registered persons',
          taxable: Math.round(b2bTaxable * 100) / 100,
          igst: Math.round(b2bIgst * 100) / 100,
          cgst: Math.round(b2bCgst * 100) / 100,
          sgst: Math.round(b2bSgst * 100) / 100,
          cess: Math.round(b2bCess * 100) / 100
        });
      }

      // ITC summary table if present
      if (itcElg && typeof itcElg === 'object') {
        const eligible = itcElg.itc_avl || itcElg.itc_available || itcElg;
        rows.push({
          label: 'Part A - ITC Available (All other ITC)',
          taxable: Number(eligible.txval || 0),
          igst: Number(eligible.iamt || eligible.igst || 0),
          cgst: Number(eligible.camt || eligible.cgst || 0),
          sgst: Number(eligible.samt || eligible.sgst || 0),
          cess: Number(eligible.csamt || eligible.cess || 0)
        });
      }

      const totals = ReturnService._calculateTotals(rows);
      return {
        type: 'GSTR2B',
        period,
        rows,
        totals,
        fetchedAt: new Date().toISOString()
      };
    }

    // 2. Mock mode categories
    if (Array.isArray(raw.itc_categories)) {
      const rows = raw.itc_categories.map((cat) => ({
        label: cat.heading || cat.name || 'Inward Supplies',
        taxable: Number(cat.taxable_value ?? cat.taxable ?? 0),
        igst: Number(cat.igst_amount ?? cat.igst ?? 0),
        cgst: Number(cat.cgst_amount ?? cat.cgst ?? 0),
        sgst: Number(cat.sgst_amount ?? cat.sgst ?? 0),
        cess: Number(cat.cess_amount ?? cat.cess ?? 0)
      }));

      const totals = ReturnService._calculateTotals(rows);
      return {
        type: 'GSTR2B',
        period,
        rows,
        totals,
        fetchedAt: new Date().toISOString()
      };
    }

    // In taxpro mode without recognized return data, fail-closed per Test 14
    if (isTaxPro) {
      throw ApiError.providerError('TaxPro GSTR-2B mapper needs real sample', 502);
    }

    return {
      type: 'GSTR2B',
      period,
      rows: [],
      totals: { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 },
      fetchedAt: new Date().toISOString()
    };
  }

  /**
   * Map raw provider GSTR-3B payload to internal ReturnData shape
   */
  static mapGstr3b(raw, period, provider) {
    if (!raw || typeof raw !== 'object') {
      throw ApiError.providerError('TaxPro GSTR-3B mapper received invalid payload', 502);
    }

    const isTaxPro = provider === 'taxpro' || (!provider && FinaggService.getProviderName() === 'taxpro');

    // 1. Real TaxPro / GSTN GSTR-3B structure (sup_details, itc_elg, inter_sup)
    if (raw.sup_details || raw.itc_elg || raw.inter_sup) {
      const rows = [];

      if (raw.sup_details?.osup_det) {
        const o = raw.sup_details.osup_det;
        rows.push({
          label: '3.1(a) - Outward Taxable Supplies (other than zero rated, nil and exempted)',
          taxable: Number(o.txval || 0),
          igst: Number(o.iamt || 0),
          cgst: Number(o.camt || 0),
          sgst: Number(o.samt || 0),
          cess: Number(o.csamt || 0)
        });
      }

      if (raw.sup_details?.osup_zero) {
        const z = raw.sup_details.osup_zero;
        rows.push({
          label: '3.1(b) - Outward Taxable Supplies (zero rated / exports)',
          taxable: Number(z.txval || 0),
          igst: Number(z.iamt || 0),
          cgst: Number(z.camt || 0),
          sgst: Number(z.samt || 0),
          cess: Number(z.csamt || 0)
        });
      }

      if (raw.sup_details?.isup_rev) {
        const r = raw.sup_details.isup_rev;
        rows.push({
          label: '3.1(d) - Inward Supplies (liable to reverse charge)',
          taxable: Number(r.txval || 0),
          igst: Number(r.iamt || 0),
          cgst: Number(r.camt || 0),
          sgst: Number(r.samt || 0),
          cess: Number(r.csamt || 0)
        });
      }

      if (raw.itc_elg) {
        let itcTaxable = 0, itcIgst = 0, itcCgst = 0, itcSgst = 0, itcCess = 0;
        const itcItems = Array.isArray(raw.itc_elg.itc_avl) ? raw.itc_elg.itc_avl : [raw.itc_elg.itc_avl || raw.itc_elg];
        for (const item of itcItems) {
          if (item) {
            itcTaxable += Number(item.txval || 0);
            itcIgst += Number(item.iamt || 0);
            itcCgst += Number(item.camt || 0);
            itcSgst += Number(item.samt || 0);
            itcCess += Number(item.csamt || 0);
          }
        }
        rows.push({
          label: '4 - Eligible ITC (Integrated, Central, State & Cess)',
          taxable: itcTaxable,
          igst: itcIgst,
          cgst: itcCgst,
          sgst: itcSgst,
          cess: itcCess
        });
      }

      const totals = ReturnService._calculateTotals(rows);
      return {
        type: 'GSTR3B',
        period,
        rows,
        totals,
        fetchedAt: new Date().toISOString()
      };
    }

    // 2. Mock mode structure
    if (raw.outward_supplies || raw.inward_supplies || raw.eligible_itc) {
      const rows = [];

      if (raw.outward_supplies) {
        rows.push({
          label: '3.1 - Outward Taxable Supplies (other than zero rated, nil and exempted)',
          taxable: Number(raw.outward_supplies.taxable_value || 0),
          igst: Number(raw.outward_supplies.igst_amount || 0),
          cgst: Number(raw.outward_supplies.cgst_amount || 0),
          sgst: Number(raw.outward_supplies.sgst_amount || 0),
          cess: Number(raw.outward_supplies.cess_amount || 0)
        });
      }

      if (raw.inward_supplies) {
        rows.push({
          label: '3.2 - Inward supplies (liable to reverse charge)',
          taxable: Number(raw.inward_supplies.taxable_value || 0),
          igst: Number(raw.inward_supplies.igst_amount || 0),
          cgst: Number(raw.inward_supplies.cgst_amount || 0),
          sgst: Number(raw.inward_supplies.sgst_amount || 0),
          cess: Number(raw.inward_supplies.cess_amount || 0)
        });
      }

      if (raw.eligible_itc) {
        const itcAmount = Number(raw.eligible_itc.total_itc_available || 0);
        rows.push({
          label: '4 - Eligible ITC (Integrated, Central, State & Cess)',
          taxable: 0,
          igst: Math.round(itcAmount * 0.5),
          cgst: Math.round(itcAmount * 0.25),
          sgst: Math.round(itcAmount * 0.25),
          cess: 0
        });
      }

      const totals = ReturnService._calculateTotals(rows);
      return {
        type: 'GSTR3B',
        period,
        rows,
        totals,
        fetchedAt: new Date().toISOString()
      };
    }

    // In taxpro mode without recognized return data, fail-closed per Test 14
    if (isTaxPro) {
      throw ApiError.providerError('TaxPro GSTR-3B mapper needs real sample', 502);
    }

    return {
      type: 'GSTR3B',
      period,
      rows: [],
      totals: { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 },
      fetchedAt: new Date().toISOString()
    };
  }

  /**
   * Fetch return data, encrypt and persist to MongoDB, or return cached with stale: true on downtime
   */
  static async getReturn(type, gstin, period, gstToken, options = {}) {
    const normType = (type || '').toUpperCase();
    const normGstin = (gstin || '').toUpperCase();

    // If workspace does not have a linked GSTIN, return cached return or clean empty shape
    if (!normGstin) {
      if (options.workspaceId) {
        const cached = await Return.findOne({ workspaceId: options.workspaceId, type: normType, period });
        if (cached && cached.dataEnc) {
          try {
            const data = decrypt(cached.dataEnc, true);
            return data;
          } catch (decErr) {
            logger.error('Failed to decrypt cached return data');
          }
        }
      }
      return {
        type: normType,
        period,
        rows: [],
        totals: { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 },
        unlinked: true,
        fetchedAt: new Date().toISOString()
      };
    }

    // Each workspace owns exactly one GSTIN. Missing workspaceId matches legacy
    // rows for that same GSTIN so rollout does not orphan encrypted cache data.
    const scope = options.workspaceId
      ? { gstin: normGstin, $or: [{ workspaceId: options.workspaceId }, { workspaceId: null }] }
      : { gstin: normGstin };

    try {
      const raw = await FinaggService.getReturn(normType, normGstin, period, gstToken, options.username, options);

      let mapped;
      if (normType === 'GSTR1') mapped = ReturnService.mapGstr1(raw, period);
      else if (normType === 'GSTR2B') mapped = ReturnService.mapGstr2b(raw, period);
      else if (normType === 'GSTR3B') mapped = ReturnService.mapGstr3b(raw, period);
      else throw ApiError.validationError(`Unsupported return type: ${type}`);

      // Encrypt and persist to MongoDB
      const dataEnc = encrypt(mapped);
      await Return.findOneAndUpdate(
        { ...scope, type: normType, period },
        {
          $set: {
            dataEnc,
            fetchedAt: new Date(),
            ...(options.workspaceId ? { workspaceId: options.workspaceId } : {})
          }
        },
        { upsert: true }
      );

      return mapped;
    } catch (error) {
      if (error.code === 'SESSION_EXPIRED' && options.sessionId) {
        await Session.findByIdAndUpdate(options.sessionId, { $set: { gstTokenEnc: null } }).catch(() => {});
      }
      // If provider is down or upstream error occurs, check for cached copy in MongoDB
      if (
        error.code === 'PROVIDER_DOWN' ||
        error.statusCode === 503 ||
        error.code === 'PROVIDER_ERROR' ||
        error.statusCode === 502 ||
        error.statusCode === 504
      ) {
        const cached = await Return.findOne({ ...scope, type: normType, period });
        if (cached && cached.dataEnc) {
          try {
            const data = decrypt(cached.dataEnc, true);
            data.stale = true;
            if (!data.fetchedAt && cached.fetchedAt) {
              data.fetchedAt = cached.fetchedAt.toISOString();
            }
            return data;
          } catch (decErr) {
            logger.error('Failed to decrypt cached return data');
          }
        }

        // When upstream portal has no return filed or returns error, synthesize GSTR-1 from workspace sales invoices
        if (normType === 'GSTR1' && options.workspaceId) {
          try {
            const Gstr1Service = require('./gstr1.service');
            const prepared = await Gstr1Service.preparePayload(options.workspaceId, normGstin, period);
            if (prepared && prepared.payload) {
              const mapped = ReturnService.mapGstr1(prepared.payload, period);
              return {
                ...mapped,
                source: 'local_invoices'
              };
            }
          } catch (prepErr) {
            logger.warn('Failed to synthesize GSTR-1 from workspace invoices', prepErr);
          }
        }
      }
      throw error;
    }
  }

  /**
   * Fetch returns summary (available periods and filing status), fallback to stale cache if down
   */
  static async getReturnsSummary(gstin, period, gstToken, options = {}) {
    const normGstin = (gstin || '').toUpperCase();
    if (!normGstin) {
      return {
        gstin: 'UNLINKED',
        availablePeriods: [],
        filings: [],
        returns: [],
        unlinked: true
      };
    }
    const scope = options.workspaceId
      ? { gstin: normGstin, $or: [{ workspaceId: options.workspaceId }, { workspaceId: null }] }
      : { gstin: normGstin };

    let summary = {
      gstin: normGstin,
      availablePeriods: [],
      filings: [],
      returns: []
    };

    try {
      const upstream = await FinaggService.getReturnsSummary(normGstin, period, gstToken, options.username, options);
      if (upstream && typeof upstream === 'object') {
        summary = {
          ...summary,
          ...upstream,
          filings: Array.isArray(upstream.filings) ? upstream.filings : [],
          availablePeriods: Array.isArray(upstream.availablePeriods) ? upstream.availablePeriods : []
        };
      }

      // Attach return breakdown comparison for the requested period if available
      if (period) {
        try {
          const [g1Res, g2bRes, g3bRes] = await Promise.allSettled([
            ReturnService.getReturn('GSTR1', normGstin, period, gstToken, options),
            ReturnService.getReturn('GSTR2B', normGstin, period, gstToken, options),
            ReturnService.getReturn('GSTR3B', normGstin, period, gstToken, options)
          ]);

          const returns = [];
          if (g1Res.status === 'fulfilled' && g1Res.value) {
            returns.push({
              type: 'GSTR-1 (Outward Supplies)',
              period,
              totals: g1Res.value.totals || { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
            });
          }
          if (g2bRes.status === 'fulfilled' && g2bRes.value) {
            returns.push({
              type: 'GSTR-2B (Inward Supplies / ITC)',
              period,
              totals: g2bRes.value.totals || { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
            });
          }
          if (g3bRes.status === 'fulfilled' && g3bRes.value) {
            returns.push({
              type: 'GSTR-3B (Monthly Summary)',
              period,
              totals: g3bRes.value.totals || { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
            });
          }

          if (returns.length > 0) {
            summary.returns = returns;
          }
        } catch {
          // Non-blocking: summary continues even if return fetching fails
        }
      }
    } catch (error) {
      if (error.code === 'SESSION_EXPIRED' && options.sessionId) {
        await Session.findByIdAndUpdate(options.sessionId, { $set: { gstTokenEnc: null } }).catch(() => {});
      }
      if (
        error.code === 'PROVIDER_DOWN' ||
        error.statusCode === 503 ||
        error.code === 'PROVIDER_ERROR' ||
        error.statusCode === 502 ||
        error.statusCode === 504 ||
        error.statusCode === 400
      ) {
        summary.stale = true;
        const cachedReturns = await Return.find(scope).sort({ period: -1 });
        if (cachedReturns && cachedReturns.length > 0) {
          const periodsSet = new Set(cachedReturns.map((r) => r.period));
          summary.availablePeriods = Array.from(periodsSet).map((p) => ({
            period: p,
            financialYear: `20${p.slice(4)}-${Number(p.slice(4)) + 1}`,
            gstr1: 'FILED',
            gstr2b: 'GENERATED',
            gstr3b: 'FILED'
          }));
        }
      } else {
        throw error;
      }
    }

    // Merge local filing records (e.g. Nil returns or recorded filings)
    if (options.workspaceId) {
      try {
        const localFilings = await Filing.find({ workspaceId: options.workspaceId }).sort({ filingDate: -1 });
        if (localFilings && localFilings.length > 0) {
          const localFormatted = localFilings.map((f) => ({
            type: f.type,
            period: f.period,
            arn: f.arn,
            date: f.dateStr || (f.filingDate ? f.filingDate.toLocaleDateString('en-GB') : ''),
            status: f.status || 'Filed',
            mode: f.mode || (f.isNil ? 'NIL_ONLINE' : 'ONLINE'),
            isNil: f.isNil
          }));
          const localArns = new Set(localFormatted.map((f) => f.arn));
          summary.filings = [
            ...localFormatted,
            ...(summary.filings || []).filter((f) => !localArns.has(f.arn))
          ];

          // Also ensure availablePeriods contains all filed periods
          const existingPeriods = new Set((summary.availablePeriods || []).map((p) => p.period));
          for (const f of localFilings) {
            if (!existingPeriods.has(f.period)) {
              existingPeriods.add(f.period);
              const p = f.period;
              summary.availablePeriods.push({
                period: p,
                financialYear: `20${p.slice(4)}-${Number(p.slice(4)) + 1}`,
                gstr1: f.type === 'GSTR1' ? 'FILED' : 'NOT_FILED',
                gstr2b: 'GENERATED',
                gstr3b: f.type === 'GSTR3B' ? 'FILED' : 'NOT_FILED'
              });
            }
          }
        }
      } catch (localErr) {
        logger.warn('Failed to load local filings', localErr);
      }
    }

    return summary;
  }

  /**
   * Build consolidated Dashboard data shape from GSTR-1, GSTR-2B, and GSTR-3B
   */
  static async getDashboard(gstin, period, gstToken, options = {}) {
    if (!gstin) {
      return {
        period,
        sales: { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, total: 0 },
        purchases: { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, total: 0 },
        itc: { available: 0, claimed: 0 },
        taxPayable: 0,
        updatedAt: new Date().toISOString(),
        noGstin: true
      };
    }

    const normGstin = gstin.toUpperCase();

    const results = await Promise.allSettled([
      ReturnService.getReturn('GSTR1', normGstin, period, gstToken, options),
      ReturnService.getReturn('GSTR2B', normGstin, period, gstToken, options),
      ReturnService.getReturn('GSTR3B', normGstin, period, gstToken, options)
    ]);

    const defaultTotals = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    const gstr1 = results[0].status === 'fulfilled' && results[0].value ? results[0].value : { totals: defaultTotals, stale: true };
    const gstr2b = results[1].status === 'fulfilled' && results[1].value ? results[1].value : { totals: defaultTotals, stale: true };
    const gstr3b = results[2].status === 'fulfilled' && results[2].value ? results[2].value : { totals: defaultTotals, stale: true };

    const hasFailed = results.some((r) => r.status === 'rejected');
    const isStale = Boolean(hasFailed || gstr1.stale || gstr2b.stale || gstr3b.stale);

    const salesTotal =
      (gstr1.totals?.taxable || 0) +
      (gstr1.totals?.igst || 0) +
      (gstr1.totals?.cgst || 0) +
      (gstr1.totals?.sgst || 0) +
      (gstr1.totals?.cess || 0);

    const purchasesTotal =
      (gstr2b.totals?.taxable || 0) +
      (gstr2b.totals?.igst || 0) +
      (gstr2b.totals?.cgst || 0) +
      (gstr2b.totals?.sgst || 0) +
      (gstr2b.totals?.cess || 0);

    const itcAmount =
      (gstr2b.totals?.igst || 0) +
      (gstr2b.totals?.cgst || 0) +
      (gstr2b.totals?.sgst || 0) +
      (gstr2b.totals?.cess || 0);

    const outwardTax =
      (gstr1.totals?.igst || 0) + (gstr1.totals?.cgst || 0) + (gstr1.totals?.sgst || 0) + (gstr1.totals?.cess || 0);
    const taxPayable = Math.max(0, outwardTax - itcAmount);

    const dashboard = {
      period,
      sales: {
        taxable: gstr1.totals?.taxable || 0,
        igst: gstr1.totals?.igst || 0,
        cgst: gstr1.totals?.cgst || 0,
        sgst: gstr1.totals?.sgst || 0,
        cess: gstr1.totals?.cess || 0,
        total: salesTotal
      },
      purchases: {
        taxable: gstr2b.totals?.taxable || 0,
        igst: gstr2b.totals?.igst || 0,
        cgst: gstr2b.totals?.cgst || 0,
        sgst: gstr2b.totals?.sgst || 0,
        cess: gstr2b.totals?.cess || 0,
        total: purchasesTotal
      },
      itc: {
        available: itcAmount,
        claimed: itcAmount
      },
      taxPayable,
      updatedAt: new Date().toISOString()
    };

    if (isStale) {
      dashboard.stale = true;
    }

    return dashboard;
  }
}

module.exports = ReturnService;
