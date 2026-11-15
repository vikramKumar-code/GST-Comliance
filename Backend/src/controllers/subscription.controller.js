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
  calculateSettlement,
  getRazorpayKey
} = require('../utils/razorpay');

// ✅ FIX 3: Bank details from ENV (Fallback to HDFC for local dev)
const COMPANY_BANK_NAME = process.env.COMPANY_BANK_NAME || 'HDFC Bank Ltd';
const COMPANY_BANK_ACCOUNT_MASKED = process.env.COMPANY_BANK_ACCOUNT_MASKED || 'Current A/C Ending in **8492';

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
      workspace: { id: workspaceId, name: workspaceName, gstin },
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
      notes: { workspaceId: workspaceId.toString(), planId: plan.id, billingCycle }
    });

    await Workspace.findByIdAndUpdate(workspaceId, {
      $set: { 'subscription.orderId': rzpOrder.orderId }
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

    // ✅ FIX 2: Idempotency Check (Prevent duplicate subscription extension on webhook retry)
    const existingPayment = await Payment.findOne({
      $or: [{ razorpayPaymentId: paymentId }, { gatewayPaymentId: paymentId }]
    }).lean();

    if (existingPayment) {
      return res.status(200).json({
        success: true,
        message: 'Payment already verified and processed previously.',
        subscription: existingPayment.metadata?.subscriptionSnapshot || null,
        payment: {
          receiptNumber: existingPayment.receiptNumber,
          amount: existingPayment.amount,
          paymentId: existingPayment.razorpayPaymentId || existingPayment.gatewayPaymentId,
          status: existingPayment.status
        }
      });
    }

    const ws = await Workspace.findById(workspaceId);
    if (!ws) throw ApiError.notFound('Workspace not found.');

    // Signature Verification
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (secret && secret !== 'your_secret_key_here' && secret !== 'demo_secret_key_candidtax_2026') {
      if (!signature) throw ApiError.validationError('Payment signature is required.');

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
      if (ws.subscription?.orderId && ws.subscription.orderId !== orderId) {
        throw ApiError.validationError('orderId does not match current pending workspace order.');
      }
    }

    const daysToAdd = billingCycle === 'YEARLY' ? 365 : 30;
    const validUntil = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);
    const amount = billingCycle === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice;

    let updatedLimits = { maxClients: 1, maxInvoicesPerMonth: 50 };
    if (plan.id === 'PRO') updatedLimits = { maxClients: 10, maxInvoicesPerMonth: 1000 };
    else if (plan.id === 'ENTERPRISE') updatedLimits = { maxClients: 999999, maxInvoicesPerMonth: 999999 };

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

    const userDoc = req.userId ? await User.findById(req.userId).lean() : null;
    const userEmail = userDoc?.email || req.session?.email || 'user@candidtax.com';
    const userName = userDoc?.name || req.session?.name || 'Verified Taxpayer';

    const settlement = calculateSettlement(amount);
    const settlementId = `setl_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const utr = `UTR_RZP_${Date.now()}`;
    const receiptNumber = `INV-CT-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Create Payment Ledger Entry (Aligned with updated Payment.js model)
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
      gatewayProvider: 'RAZORPAY',
      gatewayOrderId: orderId,
      gatewayPaymentId: paymentId,
      gatewaySignature: signature || null,
      razorpayOrderId: orderId, // Legacy support
      razorpayPaymentId: paymentId, // Legacy support
      razorpaySignature: signature || null, // Legacy support
      paymentMethod: ['UPI', 'CARD', 'NETBANKING', 'WALLET'].includes(paymentMethod) ? paymentMethod : 'UPI',
      status: 'SUCCESS',
      receiptNumber,
      settlementStatus: 'SETTLED_TO_BANK',
      bankSettlement: {
        settlementId,
        utr,
        bankAccount: COMPANY_BANK_ACCOUNT_MASKED, // ✅ FIX 3
        grossAmount: settlement.grossAmount,
        gatewayFee: settlement.gatewayFee,
        gatewayTax: settlement.tax,
        netWithdrawnToBank: settlement.netWithdrawnToBank,
        settledAt: new Date()
      },
      metadata: {
        ipAddress: req.ip || '',
        userAgent: req.headers?.['user-agent'] || '',
        subscriptionSnapshot: updatedWs.subscription // For idempotency response
      }
    });

    // ✅ FIX 1: Added workspaceId to BankSettlement
    await BankSettlement.create({
      workspaceId: ws._id, // ✅ CRITICAL FIX
      settlementId,
      utr,
      bankName: COMPANY_BANK_NAME, // ✅ FIX 3
      accountMasked: COMPANY_BANK_ACCOUNT_MASKED, // ✅ FIX 3
      grossAmount: settlement.grossAmount,
      gatewayFees: settlement.gatewayFee,
      taxOnFees: settlement.tax,
      netAmount: settlement.netWithdrawnToBank,
      status: 'SETTLED',
      settledAt: new Date(),
      transactionCount: 1,
      notes: `Subscription payment for ${plan.name} (${billingCycle}) by ${userName} (${userEmail})`
    }).catch((err) => console.warn('[BankSettlement] Log warning:', err.message));

    await AuditLog.create({
      workspaceId,
      userId: req.userId || null,
      userName,
      userEmail,
      gstin: updatedWs?.gstin || 'UNKNOWN',
      action: 'SUBSCRIPTION_UPGRADED',
      status: 'SUCCESS',
      details: `Purchased ${plan.name} (${billingCycle}) for ₹${amount}. Receipt: ${receiptNumber}`,
      metadata: { amount, planId: plan.id, paymentId, orderId, utr }
    }).catch(() => { });

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
      { $set: { 'subscription.status': 'CANCELLED' } },
      { new: true }
    ).lean();

    await AuditLog.create({
      workspaceId,
      userId: req.userId || null,
      action: 'SUBSCRIPTION_CANCELLED',
      status: 'SUCCESS',
      details: 'User initiated subscription cancellation. Plan active until period end.'
    }).catch(() => { });

    res.status(200).json({
      success: true,
      message: 'Subscription has been cancelled. It will remain active until the end of the current billing period.',
      subscription: updatedWs.subscription
    });
  } catch (error) {
    next(error);
  }
};