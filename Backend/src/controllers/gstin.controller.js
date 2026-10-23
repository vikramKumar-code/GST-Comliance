const mongoose = require('mongoose');
const FinaggService = require('../services/finagg.service');
const GstinCache = require('../models/GstinCache');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/apiError');
const { isValidGstin } = require('../utils/gstin');

exports.search = async (req, res, next) => {
  try {
    const rawGstin = req.body?.gstin;
    const gstin = typeof rawGstin === 'string' ? rawGstin.trim().toUpperCase() : '';

    if (!isValidGstin(gstin)) {
      throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
    }

    if (FinaggService.getProviderName() === 'taxpro') {
      const result = await FinaggService.searchGstin(gstin);
      if (mongoose.connection?.readyState === 1) {
        await AuditLog.create({
          gstin,
          action: 'GSTIN_SEARCH',
          status: 'SUCCESS'
        }).catch(() => {});
      }

      return res.status(200).json({
        success: true,
        ...result,
        verified: true
      });
    }

    // In mock mode: keep today's behaviour and add verified: true
    // Check MongoDB cache
    const cached = await GstinCache.findOne({ gstin });
    if (cached && !cached.isExpired()) {
      return res.status(200).json({
        success: true,
        ...cached.result,
        verified: true
      });
    }

    const result = await FinaggService.searchGstin(gstin);

    // Save in cache (TTL 6 hours)
    await GstinCache.findOneAndUpdate(
      { gstin },
      {
        result,
        expiresAt: new Date(Date.now() + 6 * 3600 * 1000)
      },
      { upsert: true }
    );

    await AuditLog.create({
      gstin,
      action: 'GSTIN_SEARCH',
      status: 'SUCCESS'
    });

    res.status(200).json({
      success: true,
      ...result,
      verified: true
    });
  } catch (error) {
    if (req.body?.gstin && mongoose.connection?.readyState === 1) {
      await AuditLog.create({
        gstin: String(req.body.gstin).trim().toUpperCase(),
        action: 'GSTIN_SEARCH',
        status: 'FAILURE'
      }).catch(() => {});
    }
    next(error);
  }
};
