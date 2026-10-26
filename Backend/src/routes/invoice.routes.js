const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoice.controller');
const auth = require('../middleware/auth');
const workspaceRole = require('../middleware/workspaceRole');

router.use(auth);

router.get('/', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), invoiceController.listInvoices);
router.get('/:id', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), invoiceController.getInvoice);
router.post('/', workspaceRole('OWNER', 'ADMIN', 'MEMBER'), invoiceController.createInvoice);
router.put('/:id', workspaceRole('OWNER', 'ADMIN', 'MEMBER'), invoiceController.updateInvoice);
router.delete('/:id', workspaceRole('OWNER', 'ADMIN'), invoiceController.deleteInvoice);

module.exports = router;
