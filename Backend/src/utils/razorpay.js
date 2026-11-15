const crypto = require('node:crypto');
const logger = require('./logger'); // ✅ Use structured logger instead of console

let Razorpay = null;
try {
  Razorpay = require('razorpay');
} catch (e) {
  logger.warn('[Razorpay] Module not available, using fallback mode');
}

// ✅ FIX 4: Configurable fee rates via environment variables
const RAZORPAY_FEE_RATE = parseFloat(process.env.RAZORPAY_FEE_RATE) || 0.02; // 2%
const GST_ON_FEE_RATE = parseFloat(process.env.GST_ON_FEE_RATE) || 0.18; // 18%

const keyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_candidtax_demo';
const keySecret = process.env.RAZORPAY_KEY_SECRET || 'demo_secret_key_candidtax_2026';
const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';

let razorpayClient = null;
if (Razorpay && keyId && !keyId.includes('xxxx') && keySecret && keySecret !== 'your_secret_key_here') {
  try {
    razorpayClient = new Razorpay({
      key_id: keyId,
      key_secret: keySecret
    });
    logger.info('[Razorpay] Client initialized successfully');
  } catch (err) {
    logger.warn('[Razorpay] Client initialization failed:', { error: err.message });
  }
}

/**
 * Create a Razorpay Order
 * @param {Object} params
 * @param {number} params.amount - Amount in INR (e.g., 999.00)
 * @param {string} params.currency - Currency code (default: 'INR')
 * @param {string} params.receipt - Receipt identifier
 * @param {Object} params.notes - Additional metadata
 */
async function createRazorpayOrder({ amount, currency = 'INR', receipt, notes = {} }) {
  // ✅ FIX 3: Input validation
  if (typeof amount !== 'number' || amount <= 0) {
    throw new Error('Invalid amount: must be a positive number');
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error('Invalid currency: must be a 3-letter ISO code (e.g., INR, USD)');
  }

  const amountInPaise = Math.round(amount * 100);

  // If live/test client is available, use official Razorpay API
  if (razorpayClient) {
    try {
      const order = await razorpayClient.orders.create({
        amount: amountInPaise,
        currency,
        receipt: receipt || `rcpt_${Date.now()}`,
        notes
      });

      logger.info('[Razorpay] Order created successfully', { orderId: order.id, amount });

      return {
        orderId: order.id,
        amount: order.amount / 100,
        currency: order.currency,
        key: keyId,
        isLive: true
      };
    } catch (err) {
      logger.error('[Razorpay] API call failed', {
        error: err.message,
        amount,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });

      // In production, don't fallback - throw error
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Payment gateway unavailable. Please try again later.');
      }

      logger.warn('[Razorpay] Falling back to secure local order generation (dev mode only)');
    }
  }

  // Robust test/sandbox generation (dev mode only)
  const orderId = `order_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  logger.debug('[Razorpay] Generated local test order', { orderId });

  return {
    orderId,
    amount,
    currency,
    key: keyId,
    isLive: false
  };
}

/**
 * Verify Razorpay payment signature (client-side payment verification)
 * @param {Object} params
 * @param {string} params.orderId - Razorpay order ID
 * @param {string} params.paymentId - Razorpay payment ID
 * @param {string} params.signature - HMAC-SHA256 signature from client
 */
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!orderId || !paymentId) {
    logger.warn('[Razorpay] Missing orderId or paymentId for signature verification');
    return false;
  }

  // ✅ FIX 1: Strict signature verification in all environments
  const isProduction = process.env.NODE_ENV === 'production';
  const hasValidSecret = keySecret && keySecret !== 'your_secret_key_here' && keySecret !== 'demo_secret_key_candidtax_2026';

  if (isProduction && !hasValidSecret) {
    logger.error('[Razorpay] CRITICAL: Production environment without valid secret key');
    return false;
  }

  if (hasValidSecret) {
    if (!signature) {
      logger.warn('[Razorpay] Signature missing for payment verification', { orderId, paymentId });
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (sigBuffer.length !== expectedBuffer.length) {
      logger.warn('[Razorpay] Signature length mismatch', { orderId, paymentId });
      return false;
    }

    const isValid = crypto.timingSafeEqual(sigBuffer, expectedBuffer);

    if (!isValid) {
      logger.warn('[Razorpay] Invalid payment signature', { orderId, paymentId });
    }

    return isValid;
  }

  // Development mode without secret: log warning and reject
  logger.warn('[Razorpay] DEV MODE: No secret configured, rejecting payment verification', { orderId, paymentId });
  return false;
}

/**
 * Verify Razorpay webhook signature (server-to-server notifications)
 * @param {string} webhookBody - Raw request body as string
 * @param {string} webhookSignature - X-Razorpay-Signature header value
 */
function verifyWebhookSignature(webhookBody, webhookSignature) {
  if (!webhookSecret) {
    logger.warn('[Razorpay] Webhook secret not configured');
    return false;
  }

  if (!webhookBody || !webhookSignature) {
    logger.warn('[Razorpay] Missing webhook body or signature');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(webhookBody)
    .digest('hex');

  const sigBuffer = Buffer.from(webhookSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length) {
    logger.warn('[Razorpay] Webhook signature length mismatch');
    return false;
  }

  const isValid = crypto.timingSafeEqual(sigBuffer, expectedBuffer);

  if (!isValid) {
    logger.warn('[Razorpay] Invalid webhook signature');
  }

  return isValid;
}

/**
 * Calculate gateway fee (configurable % + GST on fee) and net settlement to bank
 * @param {number} grossAmount - Total payment amount in INR
 * @returns {Object} Settlement breakdown
 */
function calculateSettlement(grossAmount) {
  // ✅ FIX 3: Input validation
  if (typeof grossAmount !== 'number' || grossAmount < 0) {
    throw new Error('Invalid grossAmount: must be a non-negative number');
  }

  // ✅ FIX 4: Use configurable fee rates
  const gatewayFee = Math.round(grossAmount * RAZORPAY_FEE_RATE * 100) / 100;
  const tax = Math.round(gatewayFee * GST_ON_FEE_RATE * 100) / 100;
  const netWithdrawnToBank = Math.round((grossAmount - gatewayFee - tax) * 100) / 100;

  return {
    grossAmount,
    gatewayFee,
    tax,
    netWithdrawnToBank,
    feeRate: RAZORPAY_FEE_RATE,
    gstRate: GST_ON_FEE_RATE
  };
}

/**
 * Calculate refund amount with proportional fee refund
 * @param {number} originalAmount - Original payment amount
 * @param {number} refundAmount - Amount to refund
 * @param {boolean} refundFee - Whether to refund gateway fee (Razorpay policy varies)
 */
function calculateRefund(originalAmount, refundAmount, refundFee = false) {
  if (typeof originalAmount !== 'number' || originalAmount <= 0) {
    throw new Error('Invalid originalAmount');
  }
  if (typeof refundAmount !== 'number' || refundAmount <= 0 || refundAmount > originalAmount) {
    throw new Error('Invalid refundAmount: must be between 0 and originalAmount');
  }

  const originalFee = Math.round(originalAmount * RAZORPAY_FEE_RATE * 100) / 100;
  const originalTax = Math.round(originalFee * GST_ON_FEE_RATE * 100) / 100;

  let feeRefund = 0;
  let taxRefund = 0;

  if (refundFee) {
    // Proportional fee refund based on refund percentage
    const refundPercentage = refundAmount / originalAmount;
    feeRefund = Math.round(originalFee * refundPercentage * 100) / 100;
    taxRefund = Math.round(originalTax * refundPercentage * 100) / 100;
  }

  const netRefundToCustomer = refundAmount;
  const netImpactOnBank = refundAmount - feeRefund - taxRefund;

  return {
    refundAmount,
    feeRefund,
    taxRefund,
    netRefundToCustomer,
    netImpactOnBank
  };
}

module.exports = {
  createRazorpayOrder,
  verifyPaymentSignature,
  verifyWebhookSignature, // ✅ FIX 2: Added webhook verification
  calculateSettlement,
  calculateRefund, // ✅ Added refund calculation
  getRazorpayKey: () => keyId
};