function isLiveFilingEnabled() {
  const isAllowedEnv = process.env.NODE_ENV === 'production' || process.env.ALLOW_DEV_LIVE_FILING === 'true';
  return isAllowedEnv &&
    process.env.FEATURE_FILING === 'true' &&
    process.env.PROVIDER?.trim().toLowerCase() === 'taxpro' &&
    process.env.USE_MOCK === 'false';
}

module.exports = { isLiveFilingEnabled };
