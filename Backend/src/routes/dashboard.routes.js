const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const auth = require('../middleware/auth');
const workspaceRole = require('../middleware/workspaceRole');
const { validate, periodQuerySchema } = require('../middleware/validate');

router.get('/', auth, workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), validate(periodQuerySchema, 'query'), dashboardController.getDashboard);

module.exports = router;
