const express = require('express');
const router = express.Router();
const returnsController = require('../controllers/returns.controller');
const auth = require('../middleware/auth');
const workspaceRole = require('../middleware/workspaceRole');
const { validate, periodQuerySchema } = require('../middleware/validate');

router.get('/summary', auth, workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), validate(periodQuerySchema, 'query'), returnsController.getSummary);
router.get('/gstr1', auth, workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), validate(periodQuerySchema, 'query'), returnsController.getGstr1);
router.get('/gstr1/prepare', auth, workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), validate(periodQuerySchema, 'query'), returnsController.prepareGstr1);
router.post('/gstr1/save', auth, workspaceRole('OWNER', 'ADMIN'), validate(periodQuerySchema, 'query'), returnsController.saveGstr1);
router.get('/gstr2b', auth, workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), validate(periodQuerySchema, 'query'), returnsController.getGstr2b);
router.get('/gstr3b', auth, workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), validate(periodQuerySchema, 'query'), returnsController.getGstr3b);

module.exports = router;
