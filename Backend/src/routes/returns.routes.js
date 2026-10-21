const express = require('express');
const router = express.Router();
const returnsController = require('../controllers/returns.controller');
const auth = require('../middleware/auth');
const { validate, periodQuerySchema } = require('../middleware/validate');

router.get('/summary', auth, validate(periodQuerySchema, 'query'), returnsController.getSummary);
router.get('/gstr1', auth, validate(periodQuerySchema, 'query'), returnsController.getGstr1);
router.get('/gstr2b', auth, validate(periodQuerySchema, 'query'), returnsController.getGstr2b);
router.get('/gstr3b', auth, validate(periodQuerySchema, 'query'), returnsController.getGstr3b);

module.exports = router;
