const crypto = require('node:crypto');
const Workspace = require('../models/Workspace');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/apiError');
const { resolveWorkspaceId } = require('../utils/workspaceHelper');

const PLANS_CATALOG = [
  {
    id: 'FREE',
    name: 'Starter Trial',
    badge: '14-Day Trial',
    monthlyPrice: 0,
    yearlyPrice: 0,
    description: 'Perfect for small retailers and evaluating GST compliance workflows.',
    features: [
      '1 GSTIN / Workspace',
      'Up to 20 Invoices per month',
      'GSTR-1, 2B, and 3B Previews',
      'Basic Sales & Purchase Registers',
      'Community Support'
    ],
    limits: {
      invoicesPerMonth: 20,
      gstinsAllowed: 1,
      livePortalUpload: false,
      einvoiceAllowed: false
    }
  },
  {
    id: 'PRO',
    name: 'Professional Compliance',
    badge: 'Most Popular',
    popular: true,
    monthlyPrice: 999,
    yearlyPrice: 9999,
    description: 'Ideal for growing businesses requiring live portal filing & e-invoicing.',
    features: [
      'Up to 3 Linked GSTINs',
      'Unlimited Sales Invoices & Bills',
      'Live GSTR-1 Portal Upload (RETSAVE)',
      'Automated E-Invoicing & IRN Generation (500/mo)',
      'GSTR-2B vs Books ITC Matching',
      'Audit Trail & History Tracking',
      'Priority Email & Chat Support'
    ],
    limits: {
      invoicesPerMonth: Infinity,
      gstinsAllowed: 3,
      livePortalUpload: true,
      einvoiceAllowed: true
    }
  },
  {
    id: 'ENTERPRISE',
    name: 'Enterprise / CA Multi-Org',
    badge: 'Full Power',
    monthlyPrice: 2999,
    yearlyPrice: 29999,
    description: 'Complete multi-organization suite for CAs, tax practitioners, and enterprises.',
    features: [
      'Unlimited GSTINs & Workspaces',
      'Unlimited Team Members with RBAC',
      'Bulk Excel & Tally Data Ingestion',
      'Automated ITC Refund Estimation',
      'High-throughput E-Invoice & E-Way Bill APIs',
      'Multi-tenant Group Compliance Reports',
      'Dedicated CA Account Manager'
    ],
    limits: {
      invoicesPerMonth: Infinity,
      gstinsAllowed: Infinity,
      livePortalUpload: true,
      einvoiceAllowed: true
    }
  }
];

exports.getPlans = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    let activeSub = null;
    let workspaceName = '';
    let gstin = '';

    if (workspaceId) {
      const ws = await Workspace.findById(workspaceId).lean();
      if (ws) {
        activeSub = ws.subscription || {
          plan: 'FREE',
          status: 'TRIAL',
          billingCycle: 'MONTHLY',
          validUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
        };
        workspaceName = ws.name;
        gstin = ws.gstin;
      }
    }

    res.status(200).json({
      success: true,
      plans: PLANS_CATALOG,
      currentSubscription: activeSub,
      workspace: {
        id: workspaceId,
        name: workspaceName,
        gstin
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.createOrder = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const { planId, billingCycle = 'MONTHLY' } = req.body;
    const plan = PLANS_CATALOG.find((p) => p.id === planId);
    if (!plan || plan.id === 'FREE') {
      throw ApiError.validationError('Please select a valid paid plan (PRO or ENTERPRISE).');
    }

    const amount = billingCycle === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice;
    const currency = 'INR';
    const orderId = `order_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Store order intent on workspace
    await Workspace.findByIdAndUpdate(workspaceId, {
      $set: {
        'subscription.orderId': orderId
      }
    });

    res.status(200).json({
      success: true,
      order: {
        orderId,
        amount,
        currency,
        planId: plan.id,
        planName: plan.name,
        billingCycle,
        key: process.env.RAZORPAY_KEY_ID || 'rzp_test_candidtax_sandbox'
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.verifyPayment = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const { planId, billingCycle = 'MONTHLY', paymentId, orderId } = req.body;
    const plan = PLANS_CATALOG.find((p) => p.id === planId);
    if (!plan) throw ApiError.validationError('Invalid plan ID.');

    const finalPaymentId = paymentId || `pay_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const daysToAdd = billingCycle === 'YEARLY' ? 365 : 30;
    const validUntil = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);

    const updatedWs = await Workspace.findByIdAndUpdate(
      workspaceId,
      {
        $set: {
          'subscription.plan': plan.id,
          'subscription.status': 'ACTIVE',
          'subscription.billingCycle': billingCycle,
          'subscription.validUntil': validUntil,
          'subscription.paymentId': finalPaymentId,
          'subscription.orderId': orderId || ''
        }
      },
      { new: true }
    ).lean();

    await AuditLog.create({
      workspaceId,
      gstin: updatedWs?.gstin || 'UNKNOWN',
      action: 'SUBSCRIPTION_UPGRADED',
      status: 'SUCCESS'
    }).catch(() => {});

    res.status(200).json({
      success: true,
      message: `Successfully upgraded to ${plan.name}! Your subscription is active until ${validUntil.toLocaleDateString('en-IN')}.`,
      subscription: updatedWs.subscription
    });
  } catch (error) {
    next(error);
  }
};

exports.cancelSubscription = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const updatedWs = await Workspace.findByIdAndUpdate(
      workspaceId,
      {
        $set: {
          'subscription.status': 'CANCELLED'
        }
      },
      { new: true }
    ).lean();

    res.status(200).json({
      success: true,
      message: 'Subscription has been cancelled. It will remain active until the end of the current billing period.',
      subscription: updatedWs.subscription
    });
  } catch (error) {
    next(error);
  }
};
