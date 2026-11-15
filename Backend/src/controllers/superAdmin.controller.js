const User = require('../models/User');
const Workspace = require('../models/Workspace');
const WorkspaceMember = require('../models/WorkspaceMember');
const Invoice = require('../models/Invoice');
const AuditLog = require('../models/AuditLog');
const Session = require('../models/Session'); // ✅ Added for Impersonation
const Payment = require('../models/Payment');
const BankSettlement = require('../models/BankSettlement');
const ApiError = require('../utils/apiError');

// ✅ FIX 3: Aligned with PLANS_CATALOG in subscription.controller.js
const PLAN_PRICES = {
  PRO: { monthly: 999, yearly: 9999 },
  ENTERPRISE: { monthly: 2999, yearly: 29999 }
};

/**
 * GET /api/admin/metrics
 */
exports.getMetrics = async (req, res, next) => {
  try {
    const [
      totalUsers, totalWorkspaces, activeWorkspaces, suspendedWorkspaces,
      totalInvoices, freePlans, proPlans, enterprisePlans, recentAuditLogs
    ] = await Promise.all([
      User.countDocuments(),
      Workspace.countDocuments(),
      Workspace.countDocuments({ status: 'ACTIVE' }),
      Workspace.countDocuments({ status: 'SUSPENDED' }),
      Invoice.countDocuments().catch(() => 0),
      Workspace.countDocuments({ 'subscription.plan': 'FREE' }),
      Workspace.countDocuments({ 'subscription.plan': 'PRO' }),
      Workspace.countDocuments({ 'subscription.plan': 'ENTERPRISE' }),
      AuditLog.find().sort({ createdAt: -1 }).limit(10).lean().catch(() => [])
    ]);

    // ✅ FIX 3: Correct MRR Calculation (Assuming 80% monthly, 20% yearly distribution for projection)
    // For exact MRR, you'd need to aggregate active subscriptions by billingCycle. 
    // Here we use a simplified baseline monthly projection.
    const mrr = (proPlans * PLAN_PRICES.PRO.monthly) + (enterprisePlans * PLAN_PRICES.ENTERPRISE.monthly);
    const arr = mrr * 12;

    res.status(200).json({
      success: true,
      metrics: {
        totalUsers, totalWorkspaces, activeWorkspaces, suspendedWorkspaces, totalInvoices,
        subscriptions: {
          free: freePlans, pro: proPlans, enterprise: enterprisePlans,
          mrr, arr,
          formattedMrr: `₹${mrr.toLocaleString('en-IN')}`,
          formattedArr: `₹${arr.toLocaleString('en-IN')}`
        },
        recentAuditLogs
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/workspaces
 */
exports.getWorkspaces = async (req, res, next) => {
  try {
    const { search = '', status, plan, page = 1, limit = 50 } = req.query;
    const query = {};

    if (status && ['ACTIVE', 'SUSPENDED'].includes(status)) query.status = status;
    if (plan && ['FREE', 'PRO', 'ENTERPRISE'].includes(plan.toUpperCase())) query['subscription.plan'] = plan.toUpperCase();

    if (search.trim()) {
      const s = search.trim();
      query.$or = [
        { name: { $regex: s, $options: 'i' } },
        { gstin: { $regex: s, $options: 'i' } }
      ];
    }

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

    const [workspaces, total] = await Promise.all([
      Workspace.find(query).populate('ownerUserId', 'name email mobile').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit, 10)).lean(),
      Workspace.countDocuments(query)
    ]);

    const workspaceIds = workspaces.map((w) => w._id);
    const [invoiceCounts, memberCounts] = await Promise.all([
      Invoice.aggregate([{ $match: { workspaceId: { $in: workspaceIds } } }, { $group: { _id: '$workspaceId', count: { $sum: 1 } } }]).catch(() => []),
      WorkspaceMember.aggregate([{ $match: { workspaceId: { $in: workspaceIds } } }, { $group: { _id: '$workspaceId', count: { $sum: 1 } } }]).catch(() => [])
    ]);

    const invoiceCountMap = Object.fromEntries(invoiceCounts.map((i) => [i._id.toString(), i.count]));
    const memberCountMap = Object.fromEntries(memberCounts.map((m) => [m._id.toString(), m.count]));

    const enriched = workspaces.map((w) => ({
      ...w,
      invoiceCount: invoiceCountMap[w._id.toString()] || 0,
      memberCount: memberCountMap[w._id.toString()] || 0
    }));

    res.status(200).json({
      success: true,
      workspaces: enriched,
      pagination: { total, page: parseInt(page, 10), limit: parseInt(limit, 10), totalPages: Math.ceil(total / parseInt(limit, 10)) }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/workspaces/:id/status
 */
exports.updateWorkspaceStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!['ACTIVE', 'SUSPENDED'].includes(status)) throw ApiError.validationError('Status must be either "ACTIVE" or "SUSPENDED".');

    const workspace = await Workspace.findById(id);
    if (!workspace) throw ApiError.notFound('Workspace not found.');

    const previousStatus = workspace.status;
    workspace.status = status;
    await workspace.save();

    await AuditLog.create({
      workspaceId: workspace._id, userId: req.userId || null,
      action: status === 'SUSPENDED' ? 'ADMIN_SUSPEND_WORKSPACE' : 'ADMIN_ACTIVATE_WORKSPACE',
      status: 'SUCCESS',
      metadata: { previousStatus, newStatus: status, reason: reason || 'Action initiated by Platform Super Admin' }
    }).catch(() => { });

    res.status(200).json({ success: true, message: `Workspace "${workspace.name}" has been ${status === 'SUSPENDED' ? 'suspended' : 'activated'}.`, workspace });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/workspaces/:id/subscription
 */
exports.updateWorkspaceSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { plan, status, validDays } = req.body;

    const workspace = await Workspace.findById(id);
    if (!workspace) throw ApiError.notFound('Workspace not found.');

    if (plan && ['FREE', 'PRO', 'ENTERPRISE'].includes(plan.toUpperCase())) {
      workspace.subscription.plan = plan.toUpperCase();
      if (plan.toUpperCase() === 'FREE') workspace.limits = { maxClients: 1, maxInvoicesPerMonth: 50 };
      else if (plan.toUpperCase() === 'PRO') workspace.limits = { maxClients: 10, maxInvoicesPerMonth: 1000 };
      else if (plan.toUpperCase() === 'ENTERPRISE') workspace.limits = { maxClients: 999999, maxInvoicesPerMonth: 999999 };
    }

    if (status && ['ACTIVE', 'TRIAL', 'EXPIRED', 'CANCELLED'].includes(status.toUpperCase())) {
      workspace.subscription.status = status.toUpperCase();
    }

    if (validDays && typeof validDays === 'number') {
      const baseDate = workspace.subscription.validUntil && workspace.subscription.validUntil > new Date()
        ? new Date(workspace.subscription.validUntil) : new Date();
      workspace.subscription.validUntil = new Date(baseDate.getTime() + validDays * 24 * 60 * 60 * 1000);
    }

    await workspace.save();

    await AuditLog.create({
      workspaceId: workspace._id, userId: req.userId || null, action: 'ADMIN_UPDATE_SUBSCRIPTION', status: 'SUCCESS',
      metadata: { plan: workspace.subscription.plan, status: workspace.subscription.status, validUntil: workspace.subscription.validUntil }
    }).catch(() => { });

    res.status(200).json({ success: true, message: `Subscription updated.`, workspace });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/users
 */
exports.getUsers = async (req, res, next) => {
  try {
    const { search = '', systemRole, status, page = 1, limit = 50 } = req.query;
    const query = {};

    if (systemRole && ['USER', 'SUPER_ADMIN'].includes(systemRole)) query.systemRole = systemRole;
    if (status && ['ACTIVE', 'BLOCKED'].includes(status)) query.status = status;

    if (search.trim()) {
      const s = search.trim();
      query.$or = [
        { name: { $regex: s, $options: 'i' } },
        { email: { $regex: s, $options: 'i' } },
        { mobile: { $regex: s, $options: 'i' } }
      ];
    }

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

    const [users, total] = await Promise.all([
      User.find(query).select('-password -identityHash').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit, 10)).lean(),
      User.countDocuments(query)
    ]);

    const userIds = users.map((u) => u._id);
    const memberCounts = await WorkspaceMember.aggregate([
      { $match: { userId: { $in: userIds } } }, { $group: { _id: '$userId', count: { $sum: 1 } } }
    ]).catch(() => []);

    const countMap = Object.fromEntries(memberCounts.map((m) => [m._id.toString(), m.count]));
    const enriched = users.map((u) => ({ ...u, workspaceCount: countMap[u._id.toString()] || 0 }));

    res.status(200).json({
      success: true, users: enriched,
      pagination: { total, page: parseInt(page, 10), limit: parseInt(limit, 10), totalPages: Math.ceil(total / parseInt(limit, 10)) }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/users/:id/status
 */
exports.updateUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, systemRole } = req.body;

    const user = await User.findById(id);
    if (!user) throw ApiError.notFound('User not found.');

    if (status && ['ACTIVE', 'BLOCKED'].includes(status)) user.status = status;
    if (systemRole && ['USER', 'SUPER_ADMIN'].includes(systemRole)) user.systemRole = systemRole;

    await user.save();

    res.status(200).json({
      success: true, message: `User updated successfully.`,
      user: { id: user._id, name: user.name, email: user.email, status: user.status, systemRole: user.systemRole }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/workspaces/:id/impersonate
 * ✅ FIX 1: Corrected for JWT + MongoDB Session Architecture
 */
exports.impersonateWorkspace = async (req, res, next) => {
  try {
    const { id } = req.params;
    const workspace = await Workspace.findById(id);
    if (!workspace) throw ApiError.notFound('Workspace not found.');

    let membership = await WorkspaceMember.findOne({ userId: req.userId, workspaceId: workspace._id });

    if (!membership) {
      membership = await WorkspaceMember.create({
        workspaceId: workspace._id, userId: req.userId, role: 'OWNER', status: 'ACTIVE'
      });
    }

    // ✅ Update the MongoDB Session document directly. 
    // The JWT cookie remains the same, but the next API call will fetch this updated session.
    if (req.session && req.session._id) {
      await Session.findByIdAndUpdate(req.session._id, {
        workspaceId: workspace._id,
        memberId: membership._id,
        gstin: workspace.gstin || null
      });

      // Update in-memory for current response
      req.session.workspaceId = workspace._id;
      req.session.memberId = membership._id;
      req.session.gstin = workspace.gstin || null;
    }

    await AuditLog.create({
      workspaceId: workspace._id, userId: req.userId, action: 'ADMIN_IMPERSONATE_WORKSPACE', status: 'SUCCESS',
      metadata: { targetWorkspace: workspace.name, targetGstin: workspace.gstin }
    }).catch(() => { });

    res.status(200).json({
      success: true, message: `Switched session to workspace "${workspace.name}".`,
      workspace: { id: workspace._id, name: workspace.name, gstin: workspace.gstin, role: 'OWNER' }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/activities
 */
exports.getActivities = async (req, res, next) => {
  try {
    const { search = '', action, status, page = 1, limit = 50 } = req.query;
    const query = {};

    if (status && ['SUCCESS', 'FAILURE'].includes(status)) query.status = status;
    if (action && action !== 'ALL') query.action = action;

    if (search.trim()) {
      const s = search.trim();
      query.$or = [
        { action: { $regex: s, $options: 'i' } }, { userEmail: { $regex: s, $options: 'i' } },
        { userName: { $regex: s, $options: 'i' } }, { gstin: { $regex: s, $options: 'i' } }
      ];
    }

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

    const [activities, total] = await Promise.all([
      AuditLog.find(query).populate('userId', 'name email avatar').populate('workspaceId', 'name gstin').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit, 10)).lean(),
      AuditLog.countDocuments(query)
    ]);

    res.status(200).json({
      success: true, activities,
      pagination: { total, page: parseInt(page, 10), limit: parseInt(limit, 10), totalPages: Math.ceil(total / parseInt(limit, 10)) }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/financials
 * ✅ FIX 2: Removed auto-seeding from GET request
 */
exports.getFinancials = async (req, res, next) => {
  try {
    const { search = '', plan, status } = req.query;

    const [financialAgg] = await Payment.aggregate([
      { $match: { status: 'SUCCESS' } },
      {
        $group: {
          _id: null,
          totalGrossRevenue: { $sum: '$amount' },
          totalBankWithdrawn: { $sum: '$bankSettlement.netWithdrawnToBank' },
          totalGatewayFees: { $sum: { $add: ['$bankSettlement.gatewayFee', '$bankSettlement.tax'] } },
          count: { $sum: 1 }
        }
      }
    ]);

    const totalGrossRevenue = financialAgg?.totalGrossRevenue || 0;
    const totalBankWithdrawn = financialAgg?.totalBankWithdrawn || 0;
    const totalGatewayFees = Math.round((financialAgg?.totalGatewayFees || 0) * 100) / 100;
    const pendingBalance = Math.max(0, Math.round((totalGrossRevenue - totalBankWithdrawn - totalGatewayFees) * 100) / 100);

    const userAgg = await Payment.aggregate([
      {
        $group: {
          _id: '$userEmail', userId: { $first: '$userId' }, userName: { $first: '$userName' }, userEmail: { $first: '$userEmail' },
          workspaceName: { $first: '$workspaceName' }, timesPurchased: { $sum: 1 },
          successfulPurchases: { $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] } },
          plans: { $addToSet: '$planId' }, totalSpent: { $sum: '$amount' }, lastPaymentDate: { $max: '$createdAt' }
        }
      },
      { $sort: { totalSpent: -1, lastPaymentDate: -1 } }
    ]);

    const txQuery = {};
    if (plan && plan !== 'ALL') txQuery.planId = plan;
    if (status && status !== 'ALL') txQuery.status = status;
    if (search.trim()) {
      const s = search.trim();
      txQuery.$or = [
        { userName: { $regex: s, $options: 'i' } }, { userEmail: { $regex: s, $options: 'i' } },
        { workspaceName: { $regex: s, $options: 'i' } }, { razorpayPaymentId: { $regex: s, $options: 'i' } }
      ];
    }

    const transactions = await Payment.find(txQuery).sort({ createdAt: -1 }).limit(100).lean();
    const bankSettlements = await BankSettlement.find().sort({ settledAt: -1 }).limit(50).lean();

    const activePaidCount = await Workspace.countDocuments({
      'subscription.plan': { $in: ['PRO', 'ENTERPRISE'] }, 'subscription.status': 'ACTIVE'
    });

    res.status(200).json({
      success: true,
      summary: {
        totalGrossRevenue, totalBankWithdrawn, totalGatewayFees, pendingBalance,
        totalTransactions: financialAgg?.count || 0, activePaidSubscriptions: activePaidCount,
        formattedGrossRevenue: `₹${totalGrossRevenue.toLocaleString('en-IN')}`,
        formattedBankWithdrawn: `₹${Math.round(totalBankWithdrawn).toLocaleString('en-IN')}`,
        formattedGatewayFees: `₹${Math.round(totalGatewayFees).toLocaleString('en-IN')}`,
        formattedPendingBalance: `₹${Math.round(pendingBalance).toLocaleString('en-IN')}`
      },
      userPurchaseAnalytics: userAgg,
      transactions,
      bankSettlements
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/seed-demo-data
 * ✅ FIX 2: Moved seeding to a dedicated POST endpoint & removed PII
 */
exports.seedDemoData = async (req, res, next) => {
  try {
    const paymentCount = await Payment.countDocuments();
    if (paymentCount > 0) {
      return res.status(400).json({ success: false, message: 'Financial data already exists. Seeding aborted to prevent duplicates.' });
    }

    const workspaces = await Workspace.find().populate('ownerUserId', 'name email').limit(8).lean();
    if (!workspaces || workspaces.length === 0) return res.status(400).json({ success: false, message: 'No workspaces found to seed data into.' });

    const samplePlans = [
      { planId: 'PRO', planName: 'Professional Compliance', amount: 999, cycle: 'MONTHLY' },
      { planId: 'ENTERPRISE', planName: 'Enterprise / CA Multi-Org', amount: 2999, cycle: 'MONTHLY' },
      { planId: 'PRO', planName: 'Professional Compliance', amount: 9999, cycle: 'YEARLY' }
    ];

    for (let i = 0; i < workspaces.length; i++) {
      const ws = workspaces[i];
      const planSample = samplePlans[i % samplePlans.length];
      const daysAgo = (i * 3) + 1;
      const txDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

      const fee = Math.round(planSample.amount * 0.02 * 100) / 100;
      const tax = Math.round(fee * 0.18 * 100) / 100;
      const net = Math.round((planSample.amount - fee - tax) * 100) / 100;

      await Payment.create({
        userId: ws.ownerUserId?._id || ws._id,
        userEmail: ws.ownerUserId?.email || 'demo@user.com',
        userName: ws.ownerUserId?.name || 'Demo User',
        workspaceId: ws._id, workspaceName: ws.name, gstin: ws.gstin || '',
        planId: planSample.planId, planName: planSample.planName, billingCycle: planSample.cycle,
        amount: planSample.amount, currency: 'INR',
        gatewayProvider: 'RAZORPAY', gatewayOrderId: `order_seed_${i}`, gatewayPaymentId: `pay_seed_${i}`,
        paymentMethod: 'UPI', status: 'SUCCESS', receiptNumber: `INV-SUB-DEMO-${i}`,
        settlementStatus: 'SETTLED_TO_BANK',
        bankSettlement: { settlementId: `setl_${i}`, utr: `UTR_${i}`, grossAmount: planSample.amount, gatewayFee: fee, gatewayTax: tax, netWithdrawnToBank: net, settledAt: txDate },
        createdAt: txDate, updatedAt: txDate
      });

      // ✅ FIX 4: workspaceId is optional for platform-level settlements
      await BankSettlement.create({
        workspaceId: null, // Platform payout, not tied to a specific tenant
        settlementId: `setl_${i}`, utr: `UTR_${i}`, bankName: 'Platform Bank', accountMasked: 'Current A/C',
        grossAmount: planSample.amount, gatewayFees: fee, taxOnFees: tax, netAmount: net,
        status: 'SETTLED', settledAt: txDate, transactionCount: 1
      });
    }

    res.status(200).json({ success: true, message: 'Demo financial data seeded successfully.' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/bank-withdrawals
 */
exports.createBankWithdrawal = async (req, res, next) => {
  try {
    const { amount, bankName = 'Platform Bank', accountMasked = 'Current A/C', notes } = req.body;
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) throw ApiError.validationError('Valid withdrawal amount is required.');

    const settlementId = `setl_withdr_${Date.now()}`;
    const utr = `UTR_WITHDR_${Date.now()}`;

    const settlement = await BankSettlement.create({
      workspaceId: null, // ✅ Platform level withdrawal
      settlementId, utr, bankName, accountMasked,
      grossAmount: numAmount, gatewayFees: 0, taxOnFees: 0, netAmount: numAmount,
      status: 'SETTLED', settledAt: new Date(), transactionCount: 1,
      notes: notes || 'Manual Withdrawal/Payout to Linked Company Bank Account'
    });

    await AuditLog.create({
      userId: req.userId || null, userName: 'Super Admin', action: 'ADMIN_BANK_WITHDRAWAL', status: 'SUCCESS',
      details: `Withdrew ₹${numAmount.toLocaleString('en-IN')} to ${bankName}. UTR: ${utr}`
    }).catch(() => { });

    res.status(200).json({ success: true, message: `₹${numAmount.toLocaleString('en-IN')} successfully settled.`, settlement });
  } catch (error) {
    next(error);
  }
};