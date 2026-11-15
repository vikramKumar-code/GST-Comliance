const express = require('express');
const router = express.Router();
const billController = require('../controllers/bill.controller');
const auth = require('../middleware/auth');
const workspaceRole = require('../middleware/workspaceRole');

router.use(auth);

router.get('/', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'CA'), billController.listBills);
router.get('/:id', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'CA'), billController.getBill);
router.post('/', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'CA'), billController.createBill);
router.put('/:id', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'CA'), billController.updateBill);
router.delete('/:id', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'CA'), billController.deleteBill);

module.exports = router;
