const express = require('express');
const router = express.Router();
const importController = require('../controllers/import.controller');
const auth = require('../middleware/auth');
const workspaceRole = require('../middleware/workspaceRole');

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
