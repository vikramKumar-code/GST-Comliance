const express = require('express');
const router = express.Router();
const reconciliationController = require('../controllers/reconciliation.controller');
const auth = require('../middleware/auth');
const workspaceRole = require('../middleware/workspaceRole');
const { validate, periodQuerySchema } = require('../middleware/validate');

router.get(
  '/itc',
  auth,
  workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'),
  validate(periodQuerySchema, 'query'),
  reconciliationController.getItcReconciliation
);

router.get(
  '/refund-estimate',
  auth,
  workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'),
  validate(periodQuerySchema, 'query'),
  reconciliationController.getRefundEstimate
);

module.exports = router;
