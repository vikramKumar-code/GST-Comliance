const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireSuperAdmin = require('../middleware/superAdmin');
const superAdminController = require('../controllers/superAdmin.controller');

// All Super Admin routes require authentication + SUPER_ADMIN platform authority
router.use(auth);
router.use(requireSuperAdmin);

// Platform Metrics & Revenue
router.get('/metrics', superAdminController.getMetrics);

// Tenant / Workspace Management
router.get('/workspaces', superAdminController.getWorkspaces);
router.patch('/workspaces/:id/status', superAdminController.updateWorkspaceStatus);
router.patch('/workspaces/:id/subscription', superAdminController.updateWorkspaceSubscription);
router.post('/workspaces/:id/impersonate', superAdminController.impersonateWorkspace);

// User & CA Governance
router.get('/users', superAdminController.getUsers);
router.patch('/users/:id/status', superAdminController.updateUserStatus);

// Live Comprehensive Activity Stream
router.get('/activities', superAdminController.getActivities);

// Institutional Financials, Razorpay Transactions & Bank Withdrawals
router.get('/financials', superAdminController.getFinancials);
router.post('/bank-withdrawals', superAdminController.createBankWithdrawal);

module.exports = router;
