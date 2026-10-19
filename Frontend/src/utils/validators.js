/**
 * GSTIN Regex: 2 digits state code, 5 uppercase letters PAN, 4 digits PAN, 1 letter PAN,
 * 1 entity number, 'Z' default, 1 check digit.
 */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export const isValidGstin = (gstin) => {
  if (!gstin || typeof gstin !== 'string') return false;
  return GSTIN_REGEX.test(gstin.trim().toUpperCase());
};

export const isValidOtp = (otp) => {
  if (!otp || typeof otp !== 'string') return false;
  return /^[0-9]{4,8}$/.test(otp.trim());
};

export const isValidPeriod = (period) => {
  if (!period || typeof period !== 'string' || !/^\d{6}$/.test(period)) return false;
  const month = parseInt(period.slice(0, 2), 10);
  const year = parseInt(period.slice(2, 6), 10);
  if (month < 1 || month > 12) return false;
  
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  
  if (year > currentYear || (year === currentYear && month > currentMonth)) {
    return false;
  }
  return true;
};
