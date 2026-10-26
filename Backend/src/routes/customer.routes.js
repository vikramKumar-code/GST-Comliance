const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customer.controller');
const auth = require('../middleware/auth');
const workspaceRole = require('../middleware/workspaceRole');

router.use(auth);

router.get('/', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), customerController.listCustomers);
router.get('/:id', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), customerController.getCustomer);
router.post('/', workspaceRole('OWNER', 'ADMIN', 'MEMBER'), customerController.createCustomer);
router.put('/:id', workspaceRole('OWNER', 'ADMIN', 'MEMBER'), customerController.updateCustomer);
router.delete('/:id', workspaceRole('OWNER', 'ADMIN'), customerController.deleteCustomer);

module.exports = router;
