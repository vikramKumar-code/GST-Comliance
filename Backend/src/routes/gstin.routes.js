const express = require('express');
const router = express.Router();
const gstinController = require('../controllers/gstin.controller');
const { validate, searchGstinSchema } = require('../middleware/validate');

router.post('/search', validate(searchGstinSchema), gstinController.search);

module.exports = router;
