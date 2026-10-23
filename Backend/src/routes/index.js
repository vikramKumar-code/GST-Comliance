const express = require('express');
const router = express.Router();

const gstinRoutes = require('./gstin.routes');
const authRoutes = require('./auth.routes');
const returnsRoutes = require('./returns.routes');
const dashboardRoutes = require('./dashboard.routes');
const contactRoutes = require('./contact.routes');

router.use('/gstin', gstinRoutes);
router.use('/auth', authRoutes);
router.use('/returns', returnsRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/contact', contactRoutes);

module.exports = router;
