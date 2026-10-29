const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const importController = require('../controllers/import.controller');
const auth = require('../middleware/auth');
const workspaceRole = require('../middleware/workspaceRole');

router.get('/template/:type', (req, res) => {
  const { type } = req.params;
  const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
  const filename = type === 'bills'
    ? `purchase_bills_sample_template.${format}`
    : `sales_invoices_sample_template.${format}`;
  const filePath = path.resolve(__dirname, '../../templates', filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Template not found' });
  }

  res.setHeader(
    'Content-Type',
    format === 'csv'
      ? 'text/csv; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  return res.download(filePath, filename);
});

router.post(
  '/invoices',
  auth,
  workspaceRole('OWNER', 'ADMIN', 'MEMBER'),
  importController.importInvoices
);

router.post(
  '/bills',
  auth,
  workspaceRole('OWNER', 'ADMIN', 'MEMBER'),
  importController.importBills
);

module.exports = router;

