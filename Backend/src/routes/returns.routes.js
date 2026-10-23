const express = require('express');
const router = express.Router();
const returnsController = require('../controllers/returns.controller');
const auth = require('../middleware/auth');
const workspaceRole = require('../middleware/workspaceRole');
const { validate, periodQuerySchema } = require('../middleware/validate');

router.get('/summary', auth, workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), validate(periodQuerySchema, 'query'), returnsController.getSummary);
router.get('/gstr1', auth, workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), validate(periodQuerySchema, 'query'), returnsController.getGstr1);
router.get('/gstr2b', auth, workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), validate(periodQuerySchema, 'query'), returnsController.getGstr2b);
router.get('/gstr3b', auth, workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), validate(periodQuerySchema, 'query'), returnsController.getGstr3b);

module.exports = router;
