const Item = require('../models/Item');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/apiError');
const { resolveWorkspaceId, escapeRegex } = require('../utils/workspaceHelper');

exports.listItems = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const { q, type, status, page = 1, limit = 100 } = req.query;
    const filter = { workspaceId };

    if (type) filter.type = String(type).trim();
    if (status) filter.status = String(status).trim();

    if (q) {
      const escaped = escapeRegex(String(q).trim());
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { name: regex },
        { sku: regex },
        { hsnSac: regex },
        { description: regex }
      ];
    }

    const skip = (Math.max(1, Number(page)) - 1) * Math.min(200, Math.max(1, Number(limit)));
    const actualLimit = Math.min(200, Math.max(1, Number(limit)));

    const [items, total] = await Promise.all([
      Item.find(filter)
        .sort({ name: 1 })
        .skip(skip)
        .limit(actualLimit)
        .lean(),
      Item.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: items,
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

exports.getItem = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const item = await Item.findOne({ _id: req.params.id, workspaceId }).lean();
    if (!item) throw ApiError.notFound('Item not found in this workspace.');

    res.status(200).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

exports.createItem = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const {
      name,
      sku = '',
      type = 'goods',
      hsnSac = '',
      unit = 'PCS',
      sellingPrice = 0,
      purchasePrice = 0,
      gstRate = 18,
      cessRate = 0,
      description = '',
      taxPreference = 'TAXABLE',
      trackInventory = false,
      openingStock = 0
    } = req.body;

    if (!name || !name.trim()) {
      throw ApiError.validationError('Item/Service name is required.');
    }

    // Validate HSN format if provided
    const cleanHsnSac = String(hsnSac).trim();
    if (cleanHsnSac && !/^[0-9]{4,8}$/.test(cleanHsnSac)) {
      throw ApiError.validationError('HSN/SAC code must be 4 to 8 digits (e.g., 998313 or 850110).');
    }

    const itemData = {
      workspaceId,
      name: name.trim(),
      sku: String(sku).trim().toUpperCase(),
      type: type === 'service' ? 'service' : 'goods',
      hsnSac: cleanHsnSac,
      unit: String(unit).trim().toUpperCase() || 'PCS',
      sellingPrice: Number(sellingPrice) || 0,
      purchasePrice: Number(purchasePrice) || 0,
      gstRate: Number(gstRate) || 0,
      cessRate: Number(cessRate) || 0,
      description: String(description).trim(),
      taxPreference: taxPreference || 'TAXABLE',
      trackInventory: Boolean(trackInventory),
      openingStock: Number(openingStock) || 0
    };

    let item;
    try {
      item = await Item.create(itemData);
    } catch (dbError) {
      // ✅ Handle duplicate SKU error gracefully
      if (dbError.code === 11000) {
        throw ApiError.validationError(`SKU "${itemData.sku}" already exists in this workspace. Please use a unique SKU.`);
      }
      throw dbError;
    }

    // ✅ Audit Log
    await AuditLog.create({
      workspaceId,
      userId: req.user?._id || req.userId || null,
      action: 'ITEM_CREATE',
      status: 'SUCCESS',
      metadata: { itemId: item._id, itemName: item.name, sku: item.sku }
    }).catch(() => { });

    res.status(201).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

exports.updateItem = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const existing = await Item.findOne({ _id: req.params.id, workspaceId });
    if (!existing) throw ApiError.notFound('Item not found in this workspace.');

    const {
      name, sku, type, hsnSac, unit, sellingPrice, purchasePrice,
      gstRate, cessRate, description, status, taxPreference,
      trackInventory, openingStock
    } = req.body;

    // Update fields if provided
    if (name !== undefined) existing.name = name.trim();
    if (sku !== undefined) existing.sku = String(sku).trim().toUpperCase();
    if (type !== undefined) existing.type = type === 'service' ? 'service' : 'goods';
    if (hsnSac !== undefined) {
      const cleanHsnSac = String(hsnSac).trim();
      if (cleanHsnSac && !/^[0-9]{4,8}$/.test(cleanHsnSac)) {
        throw ApiError.validationError('HSN/SAC code must be 4 to 8 digits.');
      }
      existing.hsnSac = cleanHsnSac;
    }
    if (unit !== undefined) existing.unit = String(unit).trim().toUpperCase() || 'PCS';
    if (sellingPrice !== undefined) existing.sellingPrice = Number(sellingPrice) || 0;
    if (purchasePrice !== undefined) existing.purchasePrice = Number(purchasePrice) || 0;
    if (gstRate !== undefined) existing.gstRate = Number(gstRate) || 0;
    if (cessRate !== undefined) existing.cessRate = Number(cessRate) || 0;
    if (description !== undefined) existing.description = String(description).trim();
    if (status !== undefined) existing.status = status;
    if (taxPreference !== undefined) existing.taxPreference = taxPreference;
    if (trackInventory !== undefined) existing.trackInventory = Boolean(trackInventory);
    if (openingStock !== undefined) existing.openingStock = Number(openingStock) || 0;

    try {
      await existing.save();
    } catch (dbError) {
      // ✅ Handle duplicate SKU error gracefully
      if (dbError.code === 11000) {
        throw ApiError.validationError(`SKU "${existing.sku}" already exists in this workspace. Please use a unique SKU.`);
      }
      throw dbError;
    }

    // ✅ Audit Log
    await AuditLog.create({
      workspaceId,
      userId: req.user?._id || req.userId || null,
      action: 'ITEM_UPDATE',
      status: 'SUCCESS',
      metadata: { itemId: existing._id, itemName: existing.name, sku: existing.sku }
    }).catch(() => { });

    res.status(200).json({ success: true, data: existing });
  } catch (error) {
    next(error);
  }
};

exports.deleteItem = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const deleted = await Item.findOneAndDelete({ _id: req.params.id, workspaceId });
    if (!deleted) throw ApiError.notFound('Item not found in this workspace.');

    // ✅ Audit Log
    await AuditLog.create({
      workspaceId,
      userId: req.user?._id || req.userId || null,
      action: 'ITEM_DELETE',
      status: 'SUCCESS',
      metadata: { itemId: deleted._id, itemName: deleted.name, sku: deleted.sku }
    }).catch(() => { });

    res.status(200).json({ success: true, message: 'Item deleted successfully.' });
  } catch (error) {
    next(error);
  }
};