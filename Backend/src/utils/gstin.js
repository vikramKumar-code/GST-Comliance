const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const OTP_REGEX = /^\d{4,8}$/;
const EVC_OTP_REGEX = /^[A-Za-z0-9]{4,8}$/;
// ✅ FIX 1: Updated to allow years 2017-2099 (GST implementation year onwards)
const PERIOD_REGEX = /^(0[1-9]|1[0-2])(201[7-9]|20[2-9]\d)$/;

// ✅ FIX 2: Valid Indian state codes (01-37)
const VALID_STATE_CODES = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
  '31', '32', '33', '34', '35', '36', '37', '97', '99' // 97=Other Territory, 99=Jurisdictional
]);

function normalizeGstin(gstin) {
  if (!gstin || typeof gstin !== 'string') return '';
  return gstin.trim().toUpperCase();
}

function isValidGstin(gstin) {
  const normalized = normalizeGstin(gstin);
  if (!GSTIN_REGEX.test(normalized)) return false;

  // ✅ Optional: Validate state code
  const stateCode = normalized.slice(0, 2);
  return VALID_STATE_CODES.has(stateCode);
}

function isValidOtp(otp) {
  if (!otp || typeof otp !== 'string') return false;
  return OTP_REGEX.test(otp.trim());
}

function isValidEvcOtp(otp) {
  if (!otp || typeof otp !== 'string') return false;
  return EVC_OTP_REGEX.test(otp.trim());
}

function isValidPeriod(period) {
  if (!period || typeof period !== 'string') return false;
  const trimmed = period.trim();
  const match = trimmed.match(PERIOD_REGEX);
  if (!match) return false;

  const month = parseInt(match[1], 10);
  const year = parseInt(match[2], 10);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  // Return true if period is within past or current month (not future)
  if (year > currentYear || (year === currentYear && month > currentMonth)) {
    return false;
  }

  return true;
}

/**
 * Extract state code from GSTIN (first 2 digits)
 */
function getStateCode(gstin) {
  const normalized = normalizeGstin(gstin);
  if (!isValidGstin(normalized)) return null;
  return normalized.slice(0, 2);
}

/**
 * Check if two GSTINs belong to the same state (for intra-state vs inter-state logic)
 */
function isSameState(gstin1, gstin2) {
  const state1 = getStateCode(gstin1);
  const state2 = getStateCode(gstin2);
  if (!state1 || !state2) return false;
  return state1 === state2;
}

module.exports = {
  GSTIN_REGEX,
  OTP_REGEX,
  EVC_OTP_REGEX,
  PERIOD_REGEX,
  normalizeGstin,
  isValidGstin,
  isValidOtp,
  isValidEvcOtp,
  isValidPeriod,
  getStateCode,
  isSameState
};