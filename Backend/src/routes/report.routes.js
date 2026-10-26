const express = require('express');
const router = express.Router();
const reportController = require('../controllers/report.controller');
const auth = require('../middleware/auth');
const workspaceRole = require('../middleware/workspaceRole');

router.get(
  '/gstr-comparison',
  auth,
  workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'),
  reportController.getGstrComparison
);

router.get(
  '/sales-register',
  auth,
  workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'),
  reportController.getSalesRegister
);

router.get(
  '/purchase-register',
  auth,
  workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'),
  reportController.getPurchaseRegister
);

module.exports = router;
