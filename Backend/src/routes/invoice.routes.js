const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoice.controller');
const auth = require('../middleware/auth');
const workspaceRole = require('../middleware/workspaceRole');

router.use(auth);

router.get('/', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'CA'), invoiceController.listInvoices);
router.get('/:id', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'CA'), invoiceController.getInvoice);
router.post('/', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'CA'), invoiceController.createInvoice);
router.put('/:id', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'CA'), invoiceController.updateInvoice);
router.delete('/:id', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'CA'), invoiceController.deleteInvoice);

// E-Invoice (IRN) & E-Way Bill operations
router.post('/:id/einvoice/generate', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'CA'), invoiceController.generateEInvoice);
router.post('/:id/einvoice/cancel', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'CA'), invoiceController.cancelEInvoice);
router.post('/:id/ewaybill/generate', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'CA'), invoiceController.generateEwayBill);


module.exports = router;
