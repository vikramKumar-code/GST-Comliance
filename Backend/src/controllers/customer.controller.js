const Customer = require('../models/Customer');
const ApiError = require('../utils/apiError');
const { resolveWorkspaceId, escapeRegex } = require('../utils/workspaceHelper');

exports.listCustomers = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const { q, page = 1, limit = 50, status } = req.query;
    const filter = { workspaceId };

    if (status) {
      filter.status = String(status).trim();
    }

    if (q) {
      const escaped = escapeRegex(String(q).trim());
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { name: regex },
        { companyName: regex },
        { gstin: regex },
        { phone: regex },
        { email: regex }
      ];
    }

    const skip = (Math.max(1, Number(page)) - 1) * Math.min(100, Math.max(1, Number(limit)));
    const actualLimit = Math.min(100, Math.max(1, Number(limit)));

    const [customers, total] = await Promise.all([
      Customer.find(filter).sort({ name: 1 }).skip(skip).limit(actualLimit).lean(),
      Customer.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: customers,
      pagination: {
        page: Number(page),
        limit: actualLimit,
        total,
        totalPages: Math.ceil(total / actualLimit)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getCustomer = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const customer = await Customer.findOne({ _id: req.params.id, workspaceId }).lean();
    if (!customer) {
      throw ApiError.notFound('Customer not found in this workspace.');
    }

    res.status(200).json({
      success: true,
      data: customer
    });
  } catch (error) {
    next(error);
  }
};

exports.createCustomer = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const {
      name,
      companyName,
      gstin,
      email,
      phone,
      gstType,
      placeOfSupply,
      billingAddress,
      shippingAddress,
      currency
    } = req.body;

    if (!name || !name.trim()) {
      throw ApiError.validationError('Customer name is required.');
    }

    const cleanGstin = gstin ? String(gstin).trim().toUpperCase() : '';
    let resolvedPos = placeOfSupply ? String(placeOfSupply).trim() : '';
    if (!resolvedPos && cleanGstin.length >= 2) {
      resolvedPos = cleanGstin.slice(0, 2);
    }

    const customer = await Customer.create({
      workspaceId,
      name: name.trim(),
      companyName: companyName ? companyName.trim() : '',
      gstin: cleanGstin,
      email: email ? email.trim().toLowerCase() : '',
      phone: phone ? phone.trim() : '',
      gstType: gstType || (cleanGstin ? 'Regular' : 'Consumer'),
      placeOfSupply: resolvedPos,
      billingAddress: billingAddress || {},
      shippingAddress: shippingAddress || {},
      currency: currency || 'INR'
    });

    res.status(201).json({
      success: true,
      data: customer
    });
  } catch (error) {
    next(error);
  }
};

exports.updateCustomer = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const existing = await Customer.findOne({ _id: req.params.id, workspaceId });
    if (!existing) {
      throw ApiError.notFound('Customer not found in this workspace.');
    }

    const fields = [
      'name',
      'companyName',
      'gstin',
      'email',
      'phone',
      'gstType',
      'placeOfSupply',
      'billingAddress',
      'shippingAddress',
      'currency',
      'status'
    ];

    fields.forEach((field) => {
      if (req.body[field] !== undefined) {
        if (field === 'gstin' && req.body[field]) {
          existing[field] = String(req.body[field]).trim().toUpperCase();
        } else {
          existing[field] = req.body[field];
        }
      }
    });

    await existing.save();

    res.status(200).json({
      success: true,
      data: existing
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteCustomer = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const deleted = await Customer.findOneAndDelete({ _id: req.params.id, workspaceId });
    if (!deleted) {
      throw ApiError.notFound('Customer not found in this workspace.');
    }

    res.status(200).json({
      success: true,
      message: 'Customer deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};
