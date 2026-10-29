const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscription.controller');
const auth = require('../middleware/auth');
const workspaceRole = require('../middleware/workspaceRole');

router.get('/plans', auth, subscriptionController.getPlans);
router.post('/create-order', auth, workspaceRole('OWNER', 'ADMIN'), subscriptionController.createOrder);
router.post('/verify', auth, workspaceRole('OWNER', 'ADMIN'), subscriptionController.verifyPayment);
router.post('/cancel', auth, workspaceRole('OWNER', 'ADMIN'), subscriptionController.cancelSubscription);

module.exports = router;
