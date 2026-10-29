import client from './client';

export async function getSubscriptionPlans() {
  return client.get('/subscription/plans');
}

export async function createSubscriptionOrder(planId, billingCycle = 'MONTHLY') {
  return client.post('/subscription/create-order', { planId, billingCycle });
}

export async function verifySubscriptionPayment(paymentData) {
  return client.post('/subscription/verify', paymentData);
}

export async function cancelSubscription() {
  return client.post('/subscription/cancel');
}
