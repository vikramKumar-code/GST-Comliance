const crypto = require('node:crypto');
const Workspace = require('../models/Workspace');
const User = require('../models/User');
const Payment = require('../models/Payment');
const BankSettlement = require('../models/BankSettlement');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/apiError');
const { resolveWorkspaceId } = require('../utils/workspaceHelper');
const {
  createRazorpayOrder,
  verifyPaymentSignature,
  calculateSettlement,
  getRazorpayKey
} = require('../utils/razorpay');

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

    // Get user's past payment history for this workspace
    let pastPayments = [];
    if (workspaceId) {
      pastPayments = await Payment.find({ workspaceId })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean()
        .catch(() => []);
    }

    res.status(200).json({
      success: true,
      plans: PLANS_CATALOG,
      currentSubscription: activeSub,
      workspace: {
        id: workspaceId,
        name: workspaceName,
        gstin
      },
      pastPayments,
      razorpayKey: getRazorpayKey()
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
    const receipt = `rcpt_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;

    const rzpOrder = await createRazorpayOrder({
      amount,
      currency: 'INR',
      receipt,
      notes: {
        workspaceId: workspaceId.toString(),
        planId: plan.id,
        billingCycle
      }
    });

    // Store pending order intent on workspace
    await Workspace.findByIdAndUpdate(workspaceId, {
      $set: {
        'subscription.orderId': rzpOrder.orderId
      }
    });

    res.status(200).json({
      success: true,
      order: {
        orderId: rzpOrder.orderId,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency,
        planId: plan.id,
        planName: plan.name,
        billingCycle,
        key: rzpOrder.key,
        isLive: rzpOrder.isLive
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

    const { planId, billingCycle = 'MONTHLY', paymentId, orderId, signature, paymentMethod = 'UPI' } = req.body;
    const plan = PLANS_CATALOG.find((p) => p.id === planId);
    if (!plan || plan.id === 'FREE') throw ApiError.validationError('Invalid plan ID.');

    if (!paymentId || !orderId) {
      throw ApiError.validationError('Both paymentId and orderId are required for payment verification.');
    }

    const ws = await Workspace.findById(workspaceId);
    if (!ws) throw ApiError.notFound('Workspace not found.');

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (secret && secret !== 'your_secret_key_here' && secret !== 'demo_secret_key_candidtax_2026') {
      if (!signature) {
        throw ApiError.validationError('Payment signature is required.');
      }
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      const sigBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expectedSignature);
      if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
        throw ApiError.validationError('Payment verification failed: invalid signature.');
      }
    } else if (process.env.NODE_ENV === 'production') {
      throw ApiError.serverError('Payment gateway secret is not configured in production.');
    } else {
      // In dev/test when secret is not configured, verify that orderId matches active workspace order
      if (ws.subscription?.orderId && ws.subscription.orderId !== orderId) {
        throw ApiError.validationError('orderId does not match current pending workspace order.');
      }
    }

    const daysToAdd = billingCycle === 'YEARLY' ? 365 : 30;
    const validUntil = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);
    const amount = billingCycle === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice;

    // Determine plan limits
    let updatedLimits = { maxClients: 1, maxInvoicesPerMonth: 50 };
    if (plan.id === 'PRO') {
      updatedLimits = { maxClients: 10, maxInvoicesPerMonth: 1000 };
    } else if (plan.id === 'ENTERPRISE') {
      updatedLimits = { maxClients: 999999, maxInvoicesPerMonth: 999999 };
    }

    // Update Workspace
    const updatedWs = await Workspace.findByIdAndUpdate(
      workspaceId,
      {
        $set: {
          'subscription.plan': plan.id,
          'subscription.status': 'ACTIVE',
          'subscription.billingCycle': billingCycle,
          'subscription.validUntil': validUntil,
          'subscription.paymentId': paymentId,
          'subscription.orderId': orderId,
          limits: updatedLimits
        }
      },
      { new: true }
    ).lean();

    // Fetch User details who initiated this payment
    const userDoc = req.userId ? await User.findById(req.userId).lean() : null;
    const userEmail = userDoc?.email || req.session?.email || 'user@candidtax.com';
    const userName = userDoc?.name || req.session?.name || 'Verified Taxpayer';

    // Calculate Financial settlement (Razorpay 2% fee + 18% GST deduction)
    const settlement = calculateSettlement(amount);
    const settlementId = `setl_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const utr = `UTR_RZP_${Date.now()}`;
    const receiptNumber = `INV-CT-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Create durable Payment transaction ledger entry
    const paymentRecord = await Payment.create({
      userId: req.userId || userDoc?._id || ws.ownerUserId || ws.createdById || null,
      userEmail,
      userName,
      workspaceId: ws._id,
      workspaceName: ws.name,
      gstin: ws.gstin || '',
      planId: plan.id,
      planName: plan.name,
      billingCycle,
      amount,
      currency: 'INR',
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature || null,
      paymentMethod: ['UPI', 'CARD', 'NETBANKING', 'WALLET'].includes(paymentMethod) ? paymentMethod : 'UPI',
      status: 'SUCCESS',
      receiptNumber,
      settlementStatus: 'SETTLED_TO_BANK',
      bankSettlement: {
        settlementId,
        utr,
        bankAccount: 'HDFC Bank - Current A/C **8492',
        grossAmount: settlement.grossAmount,
        gatewayFee: settlement.gatewayFee,
        tax: settlement.tax,
        netWithdrawnToBank: settlement.netWithdrawnToBank,
        settledAt: new Date()
      },
      metadata: {
        ipAddress: req.ip || '',
        userAgent: req.headers?.['user-agent'] || ''
      }
    });

    // Create or append Bank Settlement payout record
    await BankSettlement.create({
      settlementId,
      utr,
      bankName: 'HDFC Bank Ltd',
      accountMasked: 'Current A/C Ending in **8492',
      grossAmount: settlement.grossAmount,
      gatewayFees: settlement.gatewayFee,
      taxOnFees: settlement.tax,
      netAmount: settlement.netWithdrawnToBank,
      status: 'SETTLED',
      settledAt: new Date(),
      transactionCount: 1,
      notes: `Subscription payment for ${plan.name} (${billingCycle}) by ${userName} (${userEmail})`
    }).catch((err) => console.warn('[BankSettlement] Log warning:', err.message));

    // Audit log
    await AuditLog.create({
      workspaceId,
      userId: req.userId || null,
      userName,
      userEmail,
      gstin: updatedWs?.gstin || 'UNKNOWN',
      action: 'SUBSCRIPTION_UPGRADED',
      status: 'SUCCESS',
      details: `Purchased ${plan.name} (${billingCycle}) for ₹${amount}. Receipt: ${receiptNumber}, Bank Settled: ₹${settlement.netWithdrawnToBank}.`,
      metadata: {
        amount,
        planId: plan.id,
        paymentId,
        orderId,
        utr
      }
    }).catch(() => {});

    res.status(200).json({
      success: true,
      message: `Successfully upgraded to ${plan.name}! Your subscription is active until ${validUntil.toLocaleDateString('en-IN')}.`,
      subscription: updatedWs.subscription,
      payment: {
        receiptNumber,
        amount,
        currency: 'INR',
        paymentId,
        status: 'SUCCESS',
        settledToBank: settlement.netWithdrawnToBank,
        utr
      }
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

    await AuditLog.create({
      workspaceId,
      userId: req.userId || null,
      action: 'SUBSCRIPTION_CANCELLED',
      status: 'SUCCESS',
      details: 'User initiated subscription cancellation. Plan active until period end.'
    }).catch(() => {});

    res.status(200).json({
      success: true,
      message: 'Subscription has been cancelled. It will remain active until the end of the current billing period.',
      subscription: updatedWs.subscription
    });
  } catch (error) {
    next(error);
  }
};
