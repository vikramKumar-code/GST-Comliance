const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const OTP_REGEX = /^\d{4,8}$/;
const PERIOD_REGEX = /^(0[1-9]|1[0-2])(20\d{2})$/;

function normalizeGstin(gstin) {
  if (!gstin || typeof gstin !== 'string') return '';
  return gstin.trim().toUpperCase();
}

function isValidGstin(gstin) {
  const normalized = normalizeGstin(gstin);
  return GSTIN_REGEX.test(normalized);
}

function isValidOtp(otp) {
  if (!otp || typeof otp !== 'string') return false;
  return OTP_REGEX.test(otp.trim());
}

function isValidPeriod(period) {
  if (!period || typeof period !== 'string') return false;
  const match = period.trim().match(PERIOD_REGEX);
  if (!match) return false;

  const month = parseInt(match[1], 10);
  const year = parseInt(match[2], 10);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  // Return true if period is within past or current month
  if (year > currentYear || (year === currentYear && month > currentMonth)) {
    return false;
  }

  return true;
}

module.exports = {
  GSTIN_REGEX,
  OTP_REGEX,
  PERIOD_REGEX,
  normalizeGstin,
  isValidGstin,
  isValidOtp,
  isValidPeriod
};
