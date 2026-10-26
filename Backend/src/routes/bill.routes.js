const express = require('express');
const router = express.Router();
const billController = require('../controllers/bill.controller');
const auth = require('../middleware/auth');
const workspaceRole = require('../middleware/workspaceRole');

router.use(auth);

router.get('/', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), billController.listBills);
router.get('/:id', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), billController.getBill);
router.post('/', workspaceRole('OWNER', 'ADMIN', 'MEMBER'), billController.createBill);
router.put('/:id', workspaceRole('OWNER', 'ADMIN', 'MEMBER'), billController.updateBill);
router.delete('/:id', workspaceRole('OWNER', 'ADMIN'), billController.deleteBill);

module.exports = router;
