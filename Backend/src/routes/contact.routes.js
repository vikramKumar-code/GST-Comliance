const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contact.controller');
const { validate, contactSchema } = require('../middleware/validate');
const { contactLimiter } = require('../middleware/rateLimit');

router.post('/', contactLimiter, validate(contactSchema), contactController.submit);

module.exports = router;
