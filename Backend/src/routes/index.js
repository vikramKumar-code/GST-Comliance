const express = require('express');
const router = express.Router();

const gstinRoutes = require('./gstin.routes');
const authRoutes = require('./auth.routes');
const returnsRoutes = require('./returns.routes');
const dashboardRoutes = require('./dashboard.routes');
const contactRoutes = require('./contact.routes');
const customerRoutes = require('./customer.routes');
const itemRoutes = require('./item.routes');
const invoiceRoutes = require('./invoice.routes');
const billRoutes = require('./bill.routes');
const reconciliationRoutes = require('./reconciliation.routes');
const reportRoutes = require('./report.routes');
const importRoutes = require('./import.routes');

router.use('/gstin', gstinRoutes);
router.use('/auth', authRoutes);
router.use('/returns', returnsRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/contact', contactRoutes);
router.use('/customers', customerRoutes);
router.use('/items', itemRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/bills', billRoutes);
router.use('/reconciliation', reconciliationRoutes);
router.use('/reports', reportRoutes);
router.use('/import', importRoutes);

module.exports = router;
