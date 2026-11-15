const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

// ✅ Import route modules with error handling
const routeModules = {
    gstin: () => require('./gstin.routes'),
    auth: () => require('./auth.routes'),
    returns: () => require('./returns.routes'),
    dashboard: () => require('./dashboard.routes'),
    contact: () => require('./contact.routes'),
    customer: () => require('./customer.routes'),
    item: () => require('./item.routes'),
    invoice: () => require('./invoice.routes'),
    bill: () => require('./bill.routes'),
    reconciliation: () => require('./reconciliation.routes'),
    report: () => require('./report.routes'),
    import: () => require('./import.routes'),
    subscription: () => require('./subscription.routes'),
    superAdmin: () => require('./superAdmin.routes')
};

// Helper function to safely load route modules
function loadRoute(name, loader) {
    try {
        return loader();
    } catch (error) {
        logger.error(`Failed to load route module: ${name}`, { error: error.message });
        return express.Router();
    }
}

// Public Routes (No authentication required)
router.use('/gstin', loadRoute('gstin', routeModules.gstin));
router.use('/auth', loadRoute('auth', routeModules.auth));
router.use('/contact', loadRoute('contact', routeModules.contact));

// Protected Routes (Authentication required)
router.use('/returns', loadRoute('returns', routeModules.returns));
router.use('/dashboard', loadRoute('dashboard', routeModules.dashboard));
router.use('/customers', loadRoute('customer', routeModules.customer));
router.use('/items', loadRoute('item', routeModules.item));
router.use('/invoices', loadRoute('invoice', routeModules.invoice));
router.use('/bills', loadRoute('bill', routeModules.bill));
router.use('/reconciliation', loadRoute('reconciliation', routeModules.reconciliation));
router.use('/reports', loadRoute('report', routeModules.report));
router.use('/import', loadRoute('import', routeModules.import));
router.use('/subscription', loadRoute('subscription', routeModules.subscription));

// Super Admin Routes (Protected inside superAdmin.routes.js via auth + requireSuperAdmin)
router.use('/admin', loadRoute('superAdmin', routeModules.superAdmin));

// 404 Handler for unmatched routes
router.use((req, res) => {
    res.status(404).json({
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: `Route ${req.method} ${req.path} not found`
    });
});

module.exports = router;