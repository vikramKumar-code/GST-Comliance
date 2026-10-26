const Item = require('../models/Item');
const ApiError = require('../utils/apiError');
const { resolveWorkspaceId } = require('../utils/workspaceHelper');

exports.listItems = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const { q, type, status } = req.query;
    const filter = { workspaceId };

    if (type) filter.type = type;
    if (status) filter.status = status;

    if (q) {
      const regex = new RegExp(String(q).trim(), 'i');
      filter.$or = [
        { name: regex },
        { hsnSac: regex },
        { description: regex }
      ];
    }

    const items = await Item.find(filter).sort({ name: 1 }).lean();

    res.status(200).json({
      success: true,
      data: items
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
    if (!item) {
      throw ApiError.notFound('Item not found in this workspace.');
    }

    res.status(200).json({
      success: true,
      data: item
    });
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
      type = 'goods',
      hsnSac = '',
      unit = 'PCS',
      sellingPrice = 0,
      purchasePrice = 0,
      gstRate = 18,
      cessRate = 0,
      description = ''
    } = req.body;

    if (!name || !name.trim()) {
      throw ApiError.validationError('Item/Service name is required.');
    }

    const item = await Item.create({
      workspaceId,
      name: name.trim(),
      type: type === 'service' ? 'service' : 'goods',
      hsnSac: String(hsnSac).trim(),
      unit: String(unit).trim().toUpperCase() || 'PCS',
      sellingPrice: Number(sellingPrice) || 0,
      purchasePrice: Number(purchasePrice) || 0,
      gstRate: Number(gstRate) || 0,
      cessRate: Number(cessRate) || 0,
      description: String(description).trim()
    });

    res.status(201).json({
      success: true,
      data: item
    });
  } catch (error) {
    next(error);
  }
};

exports.updateItem = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const existing = await Item.findOne({ _id: req.params.id, workspaceId });
    if (!existing) {
      throw ApiError.notFound('Item not found in this workspace.');
    }

    const fields = [
      'name',
      'type',
      'hsnSac',
      'unit',
      'sellingPrice',
      'purchasePrice',
      'gstRate',
      'cessRate',
      'description',
      'status'
    ];

    fields.forEach((field) => {
      if (req.body[field] !== undefined) {
        existing[field] = req.body[field];
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

exports.deleteItem = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const deleted = await Item.findOneAndDelete({ _id: req.params.id, workspaceId });
    if (!deleted) {
      throw ApiError.notFound('Item not found in this workspace.');
    }

    res.status(200).json({
      success: true,
      message: 'Item deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};
