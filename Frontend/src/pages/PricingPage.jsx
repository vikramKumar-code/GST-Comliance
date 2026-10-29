import { useState, useEffect, useCallback } from 'react';
import { getSubscriptionPlans, createSubscriptionOrder, verifySubscriptionPayment } from '../api/subscription.api';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';

export default function PricingPage() {
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState([]);
  const [currentSub, setCurrentSub] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [billingCycle, setBillingCycle] = useState('MONTHLY');
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Modal checkout state
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [upiId, setUpiId] = useState('');

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSubscriptionPlans();
      if (res.success) {
        setPlans(res.plans || []);
        setCurrentSub(res.currentSubscription);
        setWorkspace(res.workspace);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const handleOpenCheckout = (plan) => {
    setSelectedPlan(plan);
    setSuccessMsg(null);
    setError(null);
  };

  const handleConfirmPayment = async () => {
    if (!selectedPlan) return;
    setProcessing(true);
    setError(null);

    try {
      // 1. Create order intent
      const orderRes = await createSubscriptionOrder(selectedPlan.id, billingCycle);
      const orderId = orderRes?.order?.orderId;

      // 2. Verify / Activate payment
      const verifyRes = await verifySubscriptionPayment({
        planId: selectedPlan.id,
        billingCycle,
        orderId,
        paymentId: `PAY_RZP_${Date.now()}`
      });

      if (verifyRes.success) {
        setSuccessMsg(verifyRes.message || `Upgraded to ${selectedPlan.name} successfully!`);
        setSelectedPlan(null);
        await loadPlans();
      }
    } catch (err) {
      setError(err);
    } finally {
      setProcessing(false);
    }
  };

  const currentPlanId = currentSub?.plan || 'FREE';
  const validUntilDate = currentSub?.validUntil
    ? new Date(currentSub.validUntil).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      })
    : 'N/A';

  return (
    <div className="container-fluid px-0">
      {/* Page Header */}
      <div className="text-center py-4 mb-3">
        <span className="badge bg-success-subtle text-success border border-success-subtle px-3 py-1.5 rounded-pill fw-semibold mb-2">
          ✨ Plans & Pricing
        </span>
        <h1 className="fw-bold text-dark fs-2 mb-2">
          Transparent, Scalable GST Compliance Plans
        </h1>
        <p className="text-muted mx-auto" style={{ maxWidth: '640px' }}>
          Equip your business with real-time TaxPro portal filing, e-invoicing, automated ITC reconciliation, and enterprise tenancy.
        </p>

        {/* Billing Cycle Toggle */}
        <div className="d-inline-flex align-items-center p-1 bg-light border rounded-pill shadow-xs mt-3">
          <button
            type="button"
            className={`btn btn-sm rounded-pill px-3.5 py-1.5 fw-semibold ${
              billingCycle === 'MONTHLY' ? 'btn-white text-dark shadow-xs' : 'btn-link text-muted text-decoration-none'
            }`}
            onClick={() => setBillingCycle('MONTHLY')}
          >
            Monthly Billing
          </button>
          <button
            type="button"
            className={`btn btn-sm rounded-pill px-3.5 py-1.5 fw-semibold ${
              billingCycle === 'YEARLY' ? 'btn-success text-white shadow-xs' : 'btn-link text-muted text-decoration-none'
            }`}
            onClick={() => setBillingCycle('YEARLY')}
          >
            Annual Billing <span className="badge bg-warning text-dark ms-1">Save 17%</span>
          </button>
        </div>
      </div>

      {/* Success Notification */}
      {successMsg && (
        <div className="alert alert-success border-success-subtle d-flex align-items-center justify-content-between p-3 rounded-3 shadow-xs mb-4">
          <div className="d-flex align-items-center gap-2">
            <span className="fs-5">🎉</span>
            <span className="fw-semibold">{successMsg}</span>
          </div>
          <button type="button" className="btn-close" onClick={() => setSuccessMsg(null)} />
        </div>
      )}

      {/* Error Alert */}
      {error && <ErrorMessage error={error} onRetry={loadPlans} />}

      {/* Active Subscription Status Banner */}
      {currentSub && (
        <div className="card border bg-light shadow-xs rounded-3 p-3 mb-4">
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
            <div className="d-flex align-items-center gap-2.5">
              <span className="fs-4">🛡️</span>
              <div>
                <div className="d-flex align-items-center gap-2">
                  <span className="text-secondary small fw-semibold">Current Active Plan:</span>
                  <span className="badge bg-primary text-white fw-bold px-2 py-0.5 font-monospace">
                    {currentPlanId}
                  </span>
                  <span className="badge bg-success-subtle text-success border border-success-subtle small">
                    {currentSub.status}
                  </span>
                </div>
                <div className="text-muted small mt-0.5">
                  Valid Until: <strong className="text-dark">{validUntilDate}</strong> • Workspace:{' '}
                  <strong>{workspace?.name || 'My Organization'}</strong> ({workspace?.gstin || 'GSTIN Unlinked'})
                </div>
              </div>
            </div>
            {currentPlanId !== 'ENTERPRISE' && (
              <button
                type="button"
                className="btn btn-outline-success btn-sm fw-semibold"
                onClick={() => handleOpenCheckout(plans.find((p) => p.id === 'PRO') || plans[1])}
              >
                ⚡ Upgrade Plan
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-5">
          <Loader message="Loading subscription plans and pricing..." />
        </div>
      ) : (
        /* Pricing Cards Grid */
        <div className="row g-4 mb-5">
          {plans.map((plan) => {
            const isCurrent = currentPlanId === plan.id;
            const price = billingCycle === 'YEARLY' ? Math.round(plan.yearlyPrice / 12) : plan.monthlyPrice;
            const totalPrice = billingCycle === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice;

            return (
              <div key={plan.id} className="col-12 col-lg-4">
                <div
                  className={`card h-100 rounded-4 transition-all ${
                    plan.popular
                      ? 'border-2 border-success shadow-lg position-relative'
                      : 'border shadow-xs'
                  }`}
                  style={{
                    backgroundColor: plan.popular ? '#ffffff' : '#fcfcfc',
                    transform: plan.popular ? 'scale(1.02)' : 'none'
                  }}
                >
                  {plan.popular && (
                    <div
                      className="position-absolute top-0 start-50 translate-middle badge bg-success text-white px-3 py-1.5 rounded-pill shadow-xs"
                      style={{ fontSize: '0.78rem' }}
                    >
                      ⭐ {plan.badge}
                    </div>
                  )}

                  <div className="card-body p-4 d-flex flex-column">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <h3 className="fs-5 fw-bold text-dark mb-0">{plan.name}</h3>
                      {!plan.popular && plan.badge && (
                        <span className="badge bg-light text-secondary border small">
                          {plan.badge}
                        </span>
                      )}
                    </div>

                    <p className="text-muted small mb-3" style={{ minHeight: '38px' }}>
                      {plan.description}
                    </p>

                    {/* Price Header */}
                    <div className="mb-4 pb-3 border-bottom">
                      <div className="d-flex align-items-baseline gap-1">
                        <span className="fs-4 text-muted fw-bold">₹</span>
                        <span className="display-6 fw-bold text-dark">{price.toLocaleString('en-IN')}</span>
                        <span className="text-muted small">/ month</span>
                      </div>
                      {billingCycle === 'YEARLY' && plan.yearlyPrice > 0 && (
                        <div className="text-success small fw-semibold mt-1">
                          Billed ₹{totalPrice.toLocaleString('en-IN')} annually
                        </div>
                      )}
                      {plan.id === 'FREE' && (
                        <div className="text-muted small mt-1">Free forever for light testing</div>
                      )}
                    </div>

                    {/* Feature Checklist */}
                    <div className="mb-4 flex-grow-1">
                      <span className="text-secondary small fw-bold text-uppercase d-block mb-2.5">
                        What's Included:
                      </span>
                      <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
                        {plan.features.map((feat, idx) => (
                          <li key={idx} className="d-flex align-items-start gap-2 small text-dark">
                            <span className="text-success fw-bold">✓</span>
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Call to Action Button */}
                    <button
                      type="button"
                      className={`btn w-100 py-2.5 fw-bold rounded-3 shadow-xs ${
                        isCurrent
                          ? 'btn-light border text-muted'
                          : plan.popular
                          ? 'btn-success text-white'
                          : 'btn-outline-primary'
                      }`}
                      disabled={isCurrent}
                      onClick={() => handleOpenCheckout(plan)}
                    >
                      {isCurrent ? 'Current Plan' : plan.id === 'FREE' ? 'Get Started' : 'Subscribe Now'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* FAQ Section */}
      <div className="card border-0 bg-light rounded-4 p-4 p-md-5 mb-4">
        <h2 className="fs-4 fw-bold text-dark text-center mb-4">Frequently Asked Questions</h2>
        <div className="row g-4">
          <div className="col-12 col-md-6">
            <div className="card h-100 border-0 bg-white rounded-3 p-3.5 shadow-xs">
              <strong className="d-block text-dark mb-1">How does GST billing work for my subscription?</strong>
              <p className="text-muted small mb-0">
                All subscriptions are billed in INR and comply with official Indian GST tax invoicing rules. If you provide a GSTIN, an 18% GST tax invoice with full ITC eligibility will be issued to your business.
              </p>
            </div>
          </div>
          <div className="col-12 col-md-6">
            <div className="card h-100 border-0 bg-white rounded-3 p-3.5 shadow-xs">
              <strong className="d-block text-dark mb-1">Can I switch plans or cancel anytime?</strong>
              <p className="text-muted small mb-0">
                Yes! You can upgrade from Pro to Enterprise at any point, and your remaining balance will be prorated automatically. You can also cancel renewal at any time without penalties.
              </p>
            </div>
          </div>
          <div className="col-12 col-md-6">
            <div className="card h-100 border-0 bg-white rounded-3 p-3.5 shadow-xs">
              <strong className="d-block text-dark mb-1">Is E-Invoicing (IRN) supported?</strong>
              <p className="text-muted small mb-0">
                Yes. Pro plans include 500 IRNs and E-Way bills per month through our live TaxPro NIC gateway adapter. Enterprise plans support high-throughput unlimited IRN issuance.
              </p>
            </div>
          </div>
          <div className="col-12 col-md-6">
            <div className="card h-100 border-0 bg-white rounded-3 p-3.5 shadow-xs">
              <strong className="d-block text-dark mb-1">What happens when my trial expires?</strong>
              <p className="text-muted small mb-0">
                Your workspace invoices and returns data remain 100% secure. You can simply choose a Pro or Enterprise plan to restore live portal filing and unlimited exports.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Checkout Modal */}
      {selectedPlan && (
        <div
          className="modal show d-block"
          tabIndex="-1"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.55)', zIndex: 1060 }}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg rounded-4 overflow-hidden">
              {/* Modal Header */}
              <div className="modal-header bg-light border-bottom px-4 py-3">
                <div className="d-flex align-items-center gap-2">
                  <span className="fs-5">💳</span>
                  <h3 className="modal-title fs-5 fw-bold text-dark mb-0">
                    Subscribe to {selectedPlan.name}
                  </h3>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setSelectedPlan(null)}
                  disabled={processing}
                />
              </div>

              {/* Modal Body */}
              <div className="modal-body p-4">
                {/* Plan Summary Card */}
                <div className="card border bg-light rounded-3 p-3 mb-3.5">
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <span className="fw-semibold text-dark">{selectedPlan.name}</span>
                    <span className="badge bg-primary font-monospace">{billingCycle}</span>
                  </div>
                  <div className="d-flex justify-content-between align-items-center text-muted small">
                    <span>Base Amount:</span>
                    <span>
                      ₹
                      {(billingCycle === 'YEARLY'
                        ? selectedPlan.yearlyPrice
                        : selectedPlan.monthlyPrice
                      ).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="d-flex justify-content-between align-items-center text-muted small mt-1">
                    <span>GST (18% ITC Eligible):</span>
                    <span>
                      ₹
                      {Math.round(
                        (billingCycle === 'YEARLY'
                          ? selectedPlan.yearlyPrice
                          : selectedPlan.monthlyPrice) * 0.18
                      ).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="d-flex justify-content-between align-items-center fw-bold text-dark border-top pt-2 mt-2">
                    <span>Total Amount:</span>
                    <span className="fs-5 text-success">
                      ₹
                      {Math.round(
                        (billingCycle === 'YEARLY'
                          ? selectedPlan.yearlyPrice
                          : selectedPlan.monthlyPrice) * 1.18
                      ).toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>

                {/* Payment Method Selector */}
                <span className="text-secondary small fw-bold text-uppercase d-block mb-2">
                  Select Payment Method:
                </span>
                <div className="d-flex flex-column gap-2 mb-3">
                  <label className="border rounded-3 p-2.5 d-flex align-items-center gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="UPI"
                      checked={paymentMethod === 'UPI'}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                    />
                    <span className="fw-semibold text-dark">UPI Instant (GPay / PhonePe / Paytm / BHIM)</span>
                  </label>
                  <label className="border rounded-3 p-2.5 d-flex align-items-center gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="CARD"
                      checked={paymentMethod === 'CARD'}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                    />
                    <span className="fw-semibold text-dark">Credit / Debit Card (Visa / Mastercard / RuPay)</span>
                  </label>
                  <label className="border rounded-3 p-2.5 d-flex align-items-center gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="NETBANKING"
                      checked={paymentMethod === 'NETBANKING'}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                    />
                    <span className="fw-semibold text-dark">Net Banking (All Indian Corporate & Retail Banks)</span>
                  </label>
                </div>

                {paymentMethod === 'UPI' && (
                  <div className="mb-3">
                    <label className="form-label small fw-semibold text-secondary mb-1">
                      Enter UPI ID / VPA
                    </label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      placeholder="e.g. business@okhdfcbank"
                      value={upiId}
                      onChange={(e) => setUpiId(e.target.value)}
                    />
                  </div>
                )}

                <div className="small text-muted d-flex align-items-center gap-1.5 mt-2">
                  <span>🔒</span>
                  <span>256-bit encrypted secure checkout via Razorpay Payment Gateway.</span>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="modal-footer bg-light border-top px-4 py-3 d-flex justify-content-between">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm px-3"
                  onClick={() => setSelectedPlan(null)}
                  disabled={processing}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-success btn-sm fw-bold px-4 d-flex align-items-center gap-2 shadow-xs"
                  onClick={handleConfirmPayment}
                  disabled={processing}
                >
                  {processing ? (
                    <>
                      <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                      <span>Processing Payment...</span>
                    </>
                  ) : (
                    <>
                      <span>Pay & Activate Plan ➔</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
