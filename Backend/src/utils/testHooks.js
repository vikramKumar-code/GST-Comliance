/**
 * Test Hook Helper for Provider Downtime Simulation
 *
 * Security & Fail-Closed Rules per Task 8 / docs/ARCHITECTURE.md:
 * - The test-only downtime header may ONLY be honoured when ALL of the following are true:
 *   1. Raw process.env.NODE_ENV is explicitly "development" or "test" (an unset NODE_ENV must NOT count as development).
 *   2. The active provider is mock (USE_MOCK=true or PROVIDER=mock).
 *   3. Either "x-simulate-provider-down" or "x-test-provider-down" header is "true".
 * - In all other cases (e.g. production, unset NODE_ENV, or taxpro provider), return false.
 */

function isMockProviderActive() {
  if (process.env.USE_MOCK === 'true') {
    return true;
  }
  const prov = (process.env.PROVIDER || 'mock').toLowerCase();
  return prov !== 'taxpro' && prov === 'mock';
}

function shouldSimulateDown(req) {
  // 1. Raw process.env.NODE_ENV must be explicitly "development" or "test"
  const rawNodeEnv = process.env.NODE_ENV;
  if (rawNodeEnv !== 'development' && rawNodeEnv !== 'test') {
    return false;
  }

  // 2. Active provider must be mock
  if (!isMockProviderActive()) {
    return false;
  }

  // 3. Header check
  const headers = req?.headers;
  if (!headers) {
    return false;
  }

  return (
    headers['x-simulate-provider-down'] === 'true' ||
    headers['x-test-provider-down'] === 'true'
  );
}

module.exports = {
  shouldSimulateDown,
  isMockProviderActive
};
