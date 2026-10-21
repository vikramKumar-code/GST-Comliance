const FinaggService = require('./finagg.service');
const Return = require('../models/Return');
const { encrypt, decrypt } = require('../utils/crypto');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

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
    if (provider === 'taxpro' || FinaggService.getProviderName() === 'taxpro') {
      // TODO: mapper needs real sample
      throw ApiError.providerError('TaxPro GSTR-1 mapper needs real sample', 502);
    }

    const rows = (raw.sections || []).map((sec) => ({
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

  /**
   * Map raw provider GSTR-2B payload to internal ReturnData shape
   */
  static mapGstr2b(raw, period, provider) {
    if (provider === 'taxpro' || FinaggService.getProviderName() === 'taxpro') {
      // TODO: mapper needs real sample
      throw ApiError.providerError('TaxPro GSTR-2B mapper needs real sample', 502);
    }

    const rows = (raw.itc_categories || []).map((cat) => ({
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

  /**
   * Map raw provider GSTR-3B payload to internal ReturnData shape
   */
  static mapGstr3b(raw, period, provider) {
    if (provider === 'taxpro' || FinaggService.getProviderName() === 'taxpro') {
      // TODO: mapper needs real sample
      throw ApiError.providerError('TaxPro GSTR-3B mapper needs real sample', 502);
    }

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

  /**
   * Fetch return data, encrypt and persist to MongoDB, or return cached with stale: true on downtime
   */
  static async getReturn(type, gstin, period, gstToken, options = {}) {
    const normType = type.toUpperCase();
    const normGstin = gstin.toUpperCase();

    try {
      const raw = await FinaggService.getReturn(normType, normGstin, period, gstToken, options);

      let mapped;
      if (normType === 'GSTR1') mapped = ReturnService.mapGstr1(raw, period);
      else if (normType === 'GSTR2B') mapped = ReturnService.mapGstr2b(raw, period);
      else if (normType === 'GSTR3B') mapped = ReturnService.mapGstr3b(raw, period);
      else throw ApiError.validationError(`Unsupported return type: ${type}`);

      // Encrypt and persist to MongoDB
      const dataEnc = encrypt(mapped);
      await Return.findOneAndUpdate(
        { gstin: normGstin, type: normType, period },
        { dataEnc, fetchedAt: new Date() },
        { upsert: true, new: true }
      );

      return mapped;
    } catch (error) {
      // If provider is down, check for cached copy in MongoDB
      if (error.code === 'PROVIDER_DOWN' || error.statusCode === 503) {
        const cached = await Return.findOne({ gstin: normGstin, type: normType, period });
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
      }
      throw error;
    }
  }

  /**
   * Fetch returns summary (available periods and filing status), fallback to stale cache if down
   */
  static async getReturnsSummary(gstin, period, gstToken, options = {}) {
    const normGstin = gstin.toUpperCase();

    try {
      const summary = await FinaggService.getReturnsSummary(normGstin, period, gstToken, options);
      return summary;
    } catch (error) {
      if (error.code === 'PROVIDER_DOWN' || error.statusCode === 503) {
        const cachedReturns = await Return.find({ gstin: normGstin }).sort({ period: -1 });
        if (cachedReturns && cachedReturns.length > 0) {
          const periodsSet = new Set(cachedReturns.map((r) => r.period));
          const availablePeriods = Array.from(periodsSet).map((p) => ({
            period: p,
            financialYear: `20${p.slice(4)}-${Number(p.slice(4)) + 1}`,
            gstr1: 'FILED',
            gstr2b: 'GENERATED',
            gstr3b: 'FILED'
          }));

          return {
            gstin: normGstin,
            availablePeriods,
            stale: true
          };
        }
      }
      throw error;
    }
  }

  /**
   * Build consolidated Dashboard data shape from GSTR-1, GSTR-2B, and GSTR-3B
   */
  static async getDashboard(gstin, period, gstToken, options = {}) {
    const normGstin = gstin.toUpperCase();

    const [gstr1, gstr2b, gstr3b] = await Promise.all([
      ReturnService.getReturn('GSTR1', normGstin, period, gstToken, options),
      ReturnService.getReturn('GSTR2B', normGstin, period, gstToken, options),
      ReturnService.getReturn('GSTR3B', normGstin, period, gstToken, options)
    ]);

    const isStale = Boolean(gstr1.stale || gstr2b.stale || gstr3b.stale);

    const salesTotal =
      gstr1.totals.taxable +
      gstr1.totals.igst +
      gstr1.totals.cgst +
      gstr1.totals.sgst +
      gstr1.totals.cess;

    const purchasesTotal =
      gstr2b.totals.taxable +
      gstr2b.totals.igst +
      gstr2b.totals.cgst +
      gstr2b.totals.sgst +
      gstr2b.totals.cess;

    const itcAmount =
      gstr2b.totals.igst +
      gstr2b.totals.cgst +
      gstr2b.totals.sgst +
      gstr2b.totals.cess;

    const outwardTax =
      gstr1.totals.igst + gstr1.totals.cgst + gstr1.totals.sgst + gstr1.totals.cess;
    const taxPayable = Math.max(0, outwardTax - itcAmount);

    const dashboard = {
      period,
      sales: {
        taxable: gstr1.totals.taxable,
        igst: gstr1.totals.igst,
        cgst: gstr1.totals.cgst,
        sgst: gstr1.totals.sgst,
        cess: gstr1.totals.cess,
        total: salesTotal
      },
      purchases: {
        taxable: gstr2b.totals.taxable,
        igst: gstr2b.totals.igst,
        cgst: gstr2b.totals.cgst,
        sgst: gstr2b.totals.sgst,
        cess: gstr2b.totals.cess,
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
