const axios = require('axios');
const Invoice = require('../models/Invoice');
const Workspace = require('../models/Workspace');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const config = require('../config/env');
const crypto = require('crypto');

class EInvoiceService {
  constructor() {
    this.tokenCache = new Map();
  }

  /**
   * Helper to format date as DD/MM/YYYY for NIC e-Invoice schema
   */
  formatNicDate(dateInput) {
    const d = dateInput ? new Date(dateInput) : new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Ensure 6-digit HSN code for goods / services
   */
  sanitizeHsn(hsn) {
    if (!hsn) return '100610';
    const cleaned = String(hsn).replace(/\D/g, '');
    if (cleaned.length < 4) return '100610';
    if (cleaned.length >= 8) return cleaned.slice(0, 8);
    if (cleaned.length === 5) return cleaned.padEnd(6, '0');
    if (cleaned.length === 7) return cleaned.padEnd(8, '0');
    return cleaned;
  }

  /**
   * Authenticate with TaxPro E-Invoice Decrypted Gateway
   */
  async getAuthToken(gstin) {
    const targetGstin = gstin || config.TAXPRO_EINV_GSTIN;
    const username = config.TAXPRO_EINV_USER;
    const password = config.TAXPRO_EINV_PASSWORD;
    const cacheKey = `${targetGstin}:${username}`;

    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.token && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
      return cached.token;
    }

    if (config.USE_MOCK) {
      const mockToken = 'mock_einv_' + crypto.randomBytes(12).toString('hex');
      this.tokenCache.set(cacheKey, {
        token: mockToken,
        expiresAt: Date.now() + 6 * 3600 * 1000
      });
      return mockToken;
    }

    const authUrl = `${config.TAXPRO_BASE_URL.replace(/\/$/, '')}/eivital/dec/v1.04/auth`;
    try {
      const res = await axios.get(authUrl, {
        params: {
          aspid: config.TAXPRO_ASPID,
          password: config.TAXPRO_PASSWORD,
          Gstin: targetGstin,
          User_name: username,
          eInvPwd: password
        },
        timeout: 15000
      });

      const body = res.data;
      if (body.Status !== 1 && body.Status !== '1') {
        const errMsg = body.ErrorDetails?.[0]?.ErrorMessage || 'TaxPro E-Invoice authentication failed.';
        logger.error(`[E-Invoice] Auth failed for ${targetGstin}: ${errMsg}`);
        throw ApiError.providerError(errMsg);
      }

      const authToken = body.Data?.AuthToken;
      if (!authToken) {
        throw ApiError.providerError('No AuthToken returned from E-Invoice gateway.');
      }

      // Default token expiry 6 hours if not explicitly parsable
      let expiresAt = Date.now() + 6 * 3600 * 1000;
      if (body.Data?.TokenExpiry) {
        const parsedExp = new Date(body.Data.TokenExpiry);
        if (!isNaN(parsedExp.getTime())) {
          expiresAt = parsedExp.getTime();
        }
      }

      this.tokenCache.set(cacheKey, { token: authToken, expiresAt });
      logger.info(`[E-Invoice] Successfully obtained AuthToken for ${targetGstin}`);
      return authToken;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const upstreamErr = err.response?.data?.ErrorDetails?.[0]?.ErrorMessage || err.message;
      logger.error(`[E-Invoice] Auth request error: ${upstreamErr}`);
      throw ApiError.providerError(`E-Invoice Gateway Error: ${upstreamErr}`);
    }
  }

  /**
   * Prepares NIC E-Invoice JSON Schema v1.1
   */
  buildNicPayload(invoice, workspace) {
    const sellerGstin = config.TAXPRO_EINV_GSTIN || workspace?.gstin || '34AACCC1596Q002';
    const sellerState = sellerGstin.slice(0, 2);
    
    // Customer / Buyer details
    let buyerGstin = invoice.customerGstin ? invoice.customerGstin.trim().toUpperCase() : '';
    // For sandbox, if customer GSTIN is missing, fallback to sandbox buyer GSTIN
    if (!buyerGstin || buyerGstin.length !== 15) {
      buyerGstin = '29AWGPV7107B1Z1';
    }
    const buyerState = buyerGstin.slice(0, 2);
    const pos = (invoice.placeOfSupply && invoice.placeOfSupply.length === 2) ? invoice.placeOfSupply : buyerState;
    const isInterState = sellerState !== pos;

    const buyerPin = parseInt(invoice.billingAddress?.pincode, 10) || 562160;
    const sellerPin = 605001; // Sandbox registered pin for 34AACCC1596Q002

    const lineItems = (invoice.lineItems || []).map((it, idx) => {
      const qty = Math.max(0.001, Number(it.quantity) || 1);
      const rate = Math.max(0, Number(it.rate) || 0);
      const discount = Math.max(0, Number(it.discount) || 0);
      const taxable = Math.max(0, (qty * rate) - discount);
      const gstRate = Math.max(0, Number(it.gstRate) || 18);

      let cgst = 0;
      let sgst = 0;
      let igst = 0;

      if (isInterState) {
        igst = Math.round((taxable * (gstRate / 100)) * 100) / 100;
      } else {
        cgst = Math.round((taxable * ((gstRate / 2) / 100)) * 100) / 100;
        sgst = Math.round((taxable * ((gstRate / 2) / 100)) * 100) / 100;
      }

      const totalItemVal = Math.round((taxable + cgst + sgst + igst) * 100) / 100;

      return {
        SlNo: String(idx + 1),
        PrdDesc: (it.name || 'Goods').slice(0, 100),
        IsServc: (it.hsnSac && it.hsnSac.startsWith('99')) ? 'Y' : 'N',
        HsnCd: this.sanitizeHsn(it.hsnSac),
        Qty: qty,
        Unit: (it.unit || 'PCS').slice(0, 8).toUpperCase(),
        UnitPrice: rate,
        TotAmt: Math.round(qty * rate * 100) / 100,
        Discount: discount,
        AssAmt: taxable,
        GstRt: gstRate,
        IgstAmt: igst,
        CgstAmt: cgst,
        SgstAmt: sgst,
        TotItemVal: totalItemVal
      };
    });

    const assVal = Math.round(lineItems.reduce((acc, it) => acc + it.AssAmt, 0) * 100) / 100;
    const cgstVal = Math.round(lineItems.reduce((acc, it) => acc + it.CgstAmt, 0) * 100) / 100;
    const sgstVal = Math.round(lineItems.reduce((acc, it) => acc + it.SgstAmt, 0) * 100) / 100;
    const igstVal = Math.round(lineItems.reduce((acc, it) => acc + it.IgstAmt, 0) * 100) / 100;
    const totInvVal = Math.round((assVal + cgstVal + sgstVal + igstVal) * 100) / 100;

    return {
      Version: '1.1',
      TranDtls: {
        TaxSch: 'GST',
        SupTyp: 'B2B',
        RegRev: 'N',
        IgstOnIntra: 'N'
      },
      DocDtls: {
        Typ: 'INV',
        No: String(invoice.invoiceNumber).slice(0, 16),
        Dt: this.formatNicDate(invoice.invoiceDate)
      },
      SellerDtls: {
        Gstin: sellerGstin,
        LglNm: (workspace?.name || 'NIC company pvt ltd').slice(0, 100),
        TrdNm: (workspace?.name || 'NIC Industries').slice(0, 100),
        Addr1: '5th block, kuvempu layout',
        Loc: 'GANDHINAGAR',
        Pin: sellerPin,
        Stcd: sellerState,
        Ph: '9000000000',
        Em: 'billing@enterprise.com'
      },
      BuyerDtls: {
        Gstin: buyerGstin,
        LglNm: (invoice.customerName || 'XYZ company pvt ltd').slice(0, 100),
        TrdNm: (invoice.customerName || 'XYZ Industries').slice(0, 100),
        Pos: pos,
        Addr1: (invoice.billingAddress?.street || '7th block, kuvempu layout').slice(0, 100),
        Loc: (invoice.billingAddress?.city || 'Banagalore').slice(0, 50),
        Pin: buyerPin,
        Stcd: buyerState,
        Ph: '91111111111',
        Em: 'accounts@customer.com'
      },
      ItemList: lineItems,
      ValDtls: {
        AssVal: assVal,
        CgstVal: cgstVal,
        SgstVal: sgstVal,
        IgstVal: igstVal,
        TotInvVal: totInvVal
      }
    };
  }

  /**
   * Generates IRN for a sales invoice
   */
  async generateIrn(invoiceId, workspaceId) {
    const invoice = await Invoice.findOne({ _id: invoiceId, workspaceId });
    if (!invoice) {
      throw ApiError.notFound('Invoice not found in this workspace.');
    }

    if (invoice.einvoiceStatus === 'Generated') {
      throw ApiError.validationError(`E-Invoice already generated for ${invoice.invoiceNumber}. IRN: ${invoice.irn}`);
    }

    const workspace = await Workspace.findById(workspaceId).lean();
    const sellerGstin = config.TAXPRO_EINV_GSTIN || workspace?.gstin || '34AACCC1596Q002';
    const payload = this.buildNicPayload(invoice, workspace);

    if (config.USE_MOCK) {
      const mockIrn = crypto.randomBytes(32).toString('hex');
      const mockAckNo = '1526' + Math.floor(10000000000 + Math.random() * 90000000000);
      const ackDt = new Date();

      invoice.irn = mockIrn;
      invoice.ackNo = mockAckNo;
      invoice.ackDate = ackDt;
      invoice.signedInvoice = 'mock_signed_jwt_' + mockIrn.slice(0, 16);
      invoice.signedQrCode = 'mock_qr_jwt_' + mockIrn.slice(0, 16);
      // Generate a mini 1x1 transparent PNG data or placeholder base64
      invoice.qrCodeImage = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      invoice.einvoiceStatus = 'Generated';
      invoice.einvoiceError = '';
      await invoice.save();

      return invoice;
    }

    const authToken = await this.getAuthToken(sellerGstin);
    const invoiceUrl = `${config.TAXPRO_BASE_URL.replace(/\/$/, '')}/eicore/dec/v1.03/Invoice`;

    try {
      const res = await axios.post(invoiceUrl, payload, {
        params: {
          aspid: config.TAXPRO_ASPID,
          password: config.TAXPRO_PASSWORD,
          Gstin: sellerGstin,
          AuthToken: authToken,
          User_name: config.TAXPRO_EINV_USER,
          QrCodeSize: 250
        },
        headers: { 'Content-Type': 'application/json' },
        timeout: 25000
      });

      const body = res.data;
      if (body.Status !== 1 && body.Status !== '1') {
        const errorDetails = body.ErrorDetails || [];
        const errMsg = errorDetails.map(e => `[${e.ErrorCode}] ${e.ErrorMessage}`).join('; ') || 'E-Invoice generation failed.';
        logger.error(`[E-Invoice] Generate IRN error: ${errMsg}`);
        invoice.einvoiceStatus = 'Failed';
        invoice.einvoiceError = errMsg;
        await invoice.save();
        throw ApiError.providerError(errMsg);
      }

      let parsedData = body.Data;
      if (typeof parsedData === 'string') {
        try {
          parsedData = JSON.parse(parsedData);
        } catch {
          // Keep as is
        }
      }

      invoice.irn = parsedData?.Irn || '';
      invoice.ackNo = String(parsedData?.AckNo || '');
      invoice.ackDate = parsedData?.AckDt ? new Date(parsedData.AckDt) : new Date();
      invoice.signedInvoice = parsedData?.SignedInvoice || '';
      invoice.signedQrCode = parsedData?.SignedQRCode || '';
      invoice.qrCodeImage = parsedData?.QrCodeImage || '';
      invoice.einvoiceStatus = 'Generated';
      invoice.einvoiceError = '';

      if (parsedData?.EwbNo) {
        invoice.ewayBillNo = String(parsedData.EwbNo);
        invoice.ewayBillDate = parsedData.EwbDt ? new Date(parsedData.EwbDt) : new Date();
        invoice.ewayBillValidUpto = parsedData.EwbValidTill ? new Date(parsedData.EwbValidTill) : null;
      }

      await invoice.save();
      logger.info(`[E-Invoice] Successfully generated IRN ${invoice.irn} for invoice ${invoice.invoiceNumber}`);
      return invoice;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const upstreamErr = err.response?.data?.ErrorDetails?.[0]?.ErrorMessage || err.message;
      logger.error(`[E-Invoice] IRN call failed: ${upstreamErr}`);
      invoice.einvoiceStatus = 'Failed';
      invoice.einvoiceError = upstreamErr;
      await invoice.save();
      throw ApiError.providerError(`E-Invoice Generation Failed: ${upstreamErr}`);
    }
  }

  /**
   * Cancel an existing IRN (within 24 hours per GST rules)
   */
  async cancelIrn(invoiceId, workspaceId, { reasonCode = '1', remarks = 'Order cancelled' }) {
    const invoice = await Invoice.findOne({ _id: invoiceId, workspaceId });
    if (!invoice) {
      throw ApiError.notFound('Invoice not found in this workspace.');
    }

    if (invoice.einvoiceStatus !== 'Generated' || !invoice.irn) {
      throw ApiError.validationError('Invoice does not have an active IRN to cancel.');
    }

    const sellerGstin = config.TAXPRO_EINV_GSTIN || '34AACCC1596Q002';

    if (config.USE_MOCK) {
      invoice.einvoiceStatus = 'Cancelled';
      invoice.cancelReason = reasonCode;
      invoice.cancelRemarks = remarks;
      invoice.cancelledAt = new Date();
      await invoice.save();
      return invoice;
    }

    const authToken = await this.getAuthToken(sellerGstin);
    const cancelUrl = `${config.TAXPRO_BASE_URL.replace(/\/$/, '')}/eicore/dec/v1.03/Invoice/Cancel`;

    try {
      const res = await axios.post(
        cancelUrl,
        {
          Irn: invoice.irn,
          CnlRsn: String(reasonCode),
          CnlRem: remarks.slice(0, 100)
        },
        {
          params: {
            aspid: config.TAXPRO_ASPID,
            password: config.TAXPRO_PASSWORD,
            Gstin: sellerGstin,
            User_name: config.TAXPRO_EINV_USER,
            AuthToken: authToken
          },
          headers: { 'Content-Type': 'application/json' },
          timeout: 20000
        }
      );

      const body = res.data;
      if (body.Status !== 1 && body.Status !== '1') {
        const errorDetails = body.ErrorDetails || [];
        const errMsg = errorDetails.map(e => `[${e.ErrorCode}] ${e.ErrorMessage}`).join('; ') || 'Cancellation failed.';
        logger.error(`[E-Invoice] Cancel IRN error: ${errMsg}`);
        throw ApiError.providerError(errMsg);
      }

      invoice.einvoiceStatus = 'Cancelled';
      invoice.cancelReason = reasonCode;
      invoice.cancelRemarks = remarks;
      invoice.cancelledAt = new Date();
      await invoice.save();

      logger.info(`[E-Invoice] Cancelled IRN ${invoice.irn} for invoice ${invoice.invoiceNumber}`);
      return invoice;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const upstreamErr = err.response?.data?.ErrorDetails?.[0]?.ErrorMessage || err.message;
      logger.error(`[E-Invoice] Cancel call failed: ${upstreamErr}`);
      throw ApiError.providerError(`IRN Cancellation Failed: ${upstreamErr}`);
    }
  }

  /**
   * Generate E-Way Bill for an IRN
   */
  async generateEwayBill(invoiceId, workspaceId, transportDetails = {}) {
    const invoice = await Invoice.findOne({ _id: invoiceId, workspaceId });
    if (!invoice) {
      throw ApiError.notFound('Invoice not found in this workspace.');
    }

    if (invoice.einvoiceStatus !== 'Generated' || !invoice.irn) {
      throw ApiError.validationError('An active IRN is required before generating an E-Way Bill.');
    }

    const sellerGstin = config.TAXPRO_EINV_GSTIN || '34AACCC1596Q002';
    const distance = transportDetails.distance ? Number(transportDetails.distance) : 0; // 0 = auto pin-pin calculation
    const vehNo = (transportDetails.vehicleNo || 'KA12ER1234').toUpperCase().replace(/\s+/g, '');
    const transMode = transportDetails.transportMode || '1'; // 1 = Road
    const transId = transportDetails.transporterId || '29AWGPV7107B1Z1';
    const transName = transportDetails.transporterName || 'Rapid Transport';

    if (config.USE_MOCK) {
      invoice.ewayBillNo = '58100' + Math.floor(1000000 + Math.random() * 9000000);
      invoice.ewayBillDate = new Date();
      invoice.ewayBillValidUpto = new Date(Date.now() + 2 * 24 * 3600 * 1000);
      invoice.transporterId = transId;
      invoice.transporterName = transName;
      invoice.vehicleNo = vehNo;
      invoice.transportMode = transMode;
      await invoice.save();
      return invoice;
    }

    const authToken = await this.getAuthToken(sellerGstin);
    const ewbUrl = `${config.TAXPRO_BASE_URL.replace(/\/$/, '')}/eiewb/dec/v1.03/ewaybill`;

    try {
      const res = await axios.post(
        ewbUrl,
        {
          Irn: invoice.irn,
          Distance: distance,
          TransMode: transMode,
          TransId: transId,
          TransName: transName,
          TransDocDt: this.formatNicDate(new Date()),
          TransDocNo: transportDetails.transDocNo || `TRN-${invoice.invoiceNumber}`,
          VehNo: vehNo,
          VehType: transportDetails.vehType || 'R'
        },
        {
          params: {
            aspid: config.TAXPRO_ASPID,
            password: config.TAXPRO_PASSWORD,
            Gstin: sellerGstin,
            User_name: config.TAXPRO_EINV_USER,
            AuthToken: authToken
          },
          headers: { 'Content-Type': 'application/json' },
          timeout: 25000
        }
      );

      const body = res.data;
      if (body.Status !== 1 && body.Status !== '1') {
        const errorDetails = body.ErrorDetails || [];
        const firstError = errorDetails[0];
        const code = String(firstError?.ErrorCode || '');
        if (code === '4002') {
          throw ApiError.validationError('E-Way Bill is already generated for this IRN on the government portal.');
        }
        if (code === '4013') {
          throw ApiError.validationError('Distance between pincodes is too high or low. Please enter 0 for automatic Pin-to-Pin distance.');
        }
        const errMsg = errorDetails.map(e => `[${e.ErrorCode}] ${e.ErrorMessage}`).join('; ') || 'E-Way Bill generation failed.';
        logger.error(`[E-WayBill] Generation error: ${errMsg}`);
        throw ApiError.providerError(errMsg);
      }

      let parsedData = body.Data;
      if (typeof parsedData === 'string') {
        try {
          parsedData = JSON.parse(parsedData);
        } catch {
          // Keep as is
        }
      }

      invoice.ewayBillNo = String(parsedData?.EwbNo || '');
      invoice.ewayBillDate = parsedData?.EwbDt ? new Date(parsedData.EwbDt) : new Date();
      invoice.ewayBillValidUpto = parsedData?.EwbValidTill ? new Date(parsedData.EwbValidTill) : null;
      invoice.transporterId = transId;
      invoice.transporterName = transName;
      invoice.vehicleNo = vehNo;
      invoice.transportMode = transMode;
      await invoice.save();

      logger.info(`[E-WayBill] Generated EWB ${invoice.ewayBillNo} for IRN ${invoice.irn}`);
      return invoice;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const upstreamErr = err.response?.data?.ErrorDetails?.[0]?.ErrorMessage || err.message;
      logger.error(`[E-WayBill] Call failed: ${upstreamErr}`);
      throw ApiError.providerError(`E-Way Bill Failed: ${upstreamErr}`);
    }
  }
}

module.exports = new EInvoiceService();
