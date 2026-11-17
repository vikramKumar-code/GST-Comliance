/**
 * Frontend validators aligned with backend GST filing rules.
 *
 * IMPORTANT:
 * - GSTIN/PAN/period normalization is done before validation.
 * - Period validation is IST-aware.
 * - Future periods are rejected.
 * - excludedInvoiceIds must be MongoDB ObjectIds, not invoice numbers.
 * - Invoice numbers follow GSTN `inum` restrictions.
 * - HSN/SAC must be 2 to 8 digits.
 */

const viteEnv =
  (typeof import.meta !== 'undefined' && import.meta.env) || {};

function envNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

/**
 * IST offset in minutes.
 * Backend default is 330 (UTC+05:30).
 */
const GST_TZ_OFFSET_MIN = envNumber(viteEnv.VITE_GST_TZ_OFFSET_MIN, 330);
const IST_OFFSET_MS = GST_TZ_OFFSET_MIN * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Regex constants                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Official GSTIN format:
 * 2-digit state code
 * + 10-character PAN
 * + 1-digit entity number
 * + Z
 * + 1 alphanumeric check digit
 */
export const GSTIN_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/**
 * GST return period:
 * MMYYYY with month 01-12 and plausible century 19xx/20xx.
 */
export const PERIOD_REGEX = /^(0[1-9]|1[0-2])(19|20)\d{2}$/;

/**
 * PAN format:
 * 5 letters + 4 digits + 1 letter.
 */
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * Normal numeric OTP, e.g. GST portal login OTP.
 */
export const OTP_REGEX = /^[0-9]{4,8}$/;

/**
 * EVC OTP can be alphanumeric.
 */
export const EVC_OTP_REGEX = /^[A-Za-z0-9]{4,8}$/;

/**
 * MongoDB ObjectId string.
 */
export const OBJECT_ID_REGEX = /^[a-fA-F0-9]{24}$/;

/**
 * Backend-valid idempotency key.
 */
export const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9:_-]{8,128}$/;

/**
 * GSTN invoice/document number:
 * 1-16 chars, allowed: letters, digits, slash, hyphen.
 * Must contain at least one letter or non-zero digit.
 */
export const INVOICE_NUMBER_REGEX = /^[A-Za-z0-9\/-]{1,16}$/;

/**
 * HSN/SAC code:
 * 2 to 8 digits.
 */
export const HSN_SAC_REGEX = /^[0-9]{2,8}$/;

/**
 * Place of Supply:
 * 01-38 Indian states/UTs,
 * 96 Other country,
 * 97 SEZ.
 */
export const PLACE_OF_SUPPLY_REGEX =
  /^(0[1-9]|[1-2][0-9]|3[0-8]|96|97)$/;

/**
 * Export shipping bill number:
 * 3 to 7 digits.
 */
export const SHIPPING_BILL_NUMBER_REGEX = /^[0-9]{3,7}$/;

/**
 * Export port code:
 * 1 to 6 alphanumeric characters.
 */
export const PORT_CODE_REGEX = /^[A-Za-z0-9]{1,6}$/;

/**
 * Export type:
 * WPAY = With payment of tax
 * WOPAY = Without payment of tax
 */
export const EXPORT_TYPE_REGEX = /^(WPAY|WOPAY)$/;

/**
 * IRN is generally a 64-character alphanumeric identifier.
 */
export const IRN_REGEX = /^[A-Za-z0-9]{64}$/;

/**
 * GSTN source type values commonly used in invoice/e-invoice context.
 * I = Invoice, B = Bill of Supply, R = Receipt, P = Payment,
 * E = E-waybill related, M = Manual/other depending on provider schema.
 */
export const SOURCE_TYPE_REGEX = /^[IBRPEM]$/;

/**
 * Internal document type canonical values.
 */
export const DOCUMENT_TYPE_REGEX =
  /^(INVOICE|CREDIT_NOTE|DEBIT_NOTE)$/;

/**
 * Nil return supported types.
 */
export const NIL_RETURN_TYPES = ['GSTR1', 'GSTR3B'];

/**
 * EVC form types accepted by backend/auth flow.
 */
export const EVC_FORM_TYPES = [
  'R1',
  'GSTR1',
  'GSTR-1',
  'R3B',
  'GSTR3B',
  'GSTR-3B'
];

/**
 * General verification modes.
 * Current nil provider flow supports EVC only.
 */
export const VERIFICATION_MODES = ['EVC', 'DSC', 'ONLINE'];

/**
 * Nil filing currently supports EVC only.
 */
export const NIL_VERIFICATION_MODES = ['EVC'];

/**
 * GSTN date format used in many payload fields.
 */
export const DATE_DD_MM_YYYY_REGEX = /^(\d{2})-(\d{2})-(\d{4})$/;

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* -------------------------------------------------------------------------- */

function toTrimmedString(value) {
  return String(value ?? '').trim();
}

function toUpper(value) {
  return toTrimmedString(value).toUpperCase();
}

function compactAlphaNumeric(value) {
  return toUpper(value).replace(/[^A-Z0-9]/g, '');
}

/* -------------------------------------------------------------------------- */
/* IST period helpers                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Current IST Date object.
 * We shift UTC time by IST offset and then read UTC components.
 */
export function nowIst() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

/**
 * Current GST return period in IST.
 * Example: Nov 2026 => "112026"
 */
export function getCurrentIstPeriod() {
  const d = nowIst();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${month}${year}`;
}

/**
 * Last completed month in IST.
 * Example: current Nov 2026 => "102026"
 */
export function getLastMonthPeriod() {
  const d = nowIst();

  let monthIndex = d.getUTCMonth(); // 0 = Jan
  let year = d.getUTCFullYear();

  monthIndex -= 1;

  if (monthIndex < 0) {
    monthIndex = 11;
    year -= 1;
  }

  const month = String(monthIndex + 1).padStart(2, '0');
  return `${month}${year}`;
}

/**
 * Normalize period string.
 */
export function normalizePeriod(value) {
  return toTrimmedString(value).toUpperCase();
}

/**
 * Returns true if period is strictly future compared to current IST period.
 * Current period is NOT considered future.
 */
export function isFuturePeriod(value) {
  const period = normalizePeriod(value);

  if (!PERIOD_REGEX.test(period)) return false;

  const periodMonth = Number(period.slice(0, 2));
  const periodYear = Number(period.slice(2));

  const current = getCurrentIstPeriod();
  const currentMonth = Number(current.slice(0, 2));
  const currentYear = Number(current.slice(2));

  if (periodYear > currentYear) return true;
  if (periodYear === currentYear && periodMonth > currentMonth) return true;

  return false;
}

/**
 * Returns true if selected period is the current IST month.
 */
export function isCurrentPeriod(value) {
  const period = normalizePeriod(value);
  return PERIOD_REGEX.test(period) && period === getCurrentIstPeriod();
}

/* -------------------------------------------------------------------------- */
/* GSTIN                                                                      */
/* -------------------------------------------------------------------------- */

export function normalizeGstin(value) {
  return toUpper(value);
}

export function isValidGstin(value) {
  const gstin = normalizeGstin(value);
  return GSTIN_REGEX.test(gstin);
}

/* -------------------------------------------------------------------------- */
/* PAN                                                                        */
/* -------------------------------------------------------------------------- */

export function normalizePan(value) {
  return toUpper(value);
}

export function isValidPan(value) {
  const pan = normalizePan(value);
  return PAN_REGEX.test(pan);
}

/**
 * For EVC filing, GST portal generally requires personal PAN of
 * authorized signatory. 4th letter should be 'P'.
 */
export function isPersonalPan(value) {
  const pan = normalizePan(value);
  return PAN_REGEX.test(pan) && pan[3] === 'P';
}

/* -------------------------------------------------------------------------- */
/* OTP                                                                        */
/* -------------------------------------------------------------------------- */

export function normalizeOtp(value) {
  return toTrimmedString(value);
}

export function isValidOtp(value) {
  return OTP_REGEX.test(normalizeOtp(value));
}

export function normalizeEvcOtp(value) {
  return toTrimmedString(value);
}

export function isValidEvcOtp(value) {
  return EVC_OTP_REGEX.test(normalizeEvcOtp(value));
}

/* -------------------------------------------------------------------------- */
/* Period                                                                     */
/* -------------------------------------------------------------------------- */

export function isValidPeriod(value) {
  const period = normalizePeriod(value);
  return PERIOD_REGEX.test(period) && !isFuturePeriod(period);
}

/* -------------------------------------------------------------------------- */
/* MongoDB ObjectId / excluded invoice IDs                                    */
/* -------------------------------------------------------------------------- */

export function normalizeObjectId(value) {
  return toTrimmedString(value);
}

export function isValidObjectId(value) {
  return OBJECT_ID_REGEX.test(normalizeObjectId(value));
}

/**
 * Normalize excluded invoice IDs.
 *
 * Accepts:
 * - Array<string>
 * - comma-separated string
 * - single string
 * - Set<string>
 *
 * Returns:
 * {
 *   ok: boolean,
 *   ids: string[],
 *   invalid: string[],
 *   error: string | null
 * }
 */
export function normalizeObjectIdList(value, max = 5000) {
  if (value === undefined || value === null || value === '') {
    return {
      ok: true,
      ids: [],
      invalid: [],
      error: null
    };
  }

  let raw;

  if (value instanceof Set) {
    raw = Array.from(value);
  } else if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === 'string') {
    raw = value.split(',');
  } else {
    raw = [value];
  }

  if (raw.length > max) {
    return {
      ok: false,
      ids: [],
      invalid: [],
      error: `excludedInvoiceIds cannot contain more than ${max} entries.`
    };
  }

  const seen = new Set();
  const ids = [];
  const invalid = [];

  for (const item of raw) {
    const id = normalizeObjectId(item);

    if (!id) continue;
    if (seen.has(id)) continue;

    if (OBJECT_ID_REGEX.test(id)) {
      seen.add(id);
      ids.push(id);
    } else {
      seen.add(id);
      invalid.push(id);
    }
  }

  if (invalid.length > 0) {
    return {
      ok: false,
      ids,
      invalid,
      error:
        `Invalid excluded invoice id(s): ${invalid
          .slice(0, 3)
          .join(', ')}. excludedInvoiceIds must be 24-character MongoDB ObjectIds.`
    };
  }

  return {
    ok: true,
    ids,
    invalid: [],
    error: null
  };
}

/* -------------------------------------------------------------------------- */
/* Idempotency key                                                            */
/* -------------------------------------------------------------------------- */

export function normalizeIdempotencyKey(value) {
  return toTrimmedString(value);
}

export function isValidIdempotencyKey(value) {
  const key = normalizeIdempotencyKey(value);
  return IDEMPOTENCY_KEY_REGEX.test(key);
}

/* -------------------------------------------------------------------------- */
/* Invoice number                                                             */
/* -------------------------------------------------------------------------- */

/**
 * GSTN invoice/document number normalization.
 * Do NOT uppercase forcibly because GSTN allows lowercase too.
 */
export function normalizeInvoiceNumber(value) {
  return toTrimmedString(value);
}

/**
 * GSTN `inum` rules:
 * - 1 to 16 characters
 * - allowed characters: A-Z, a-z, 0-9, /, -
 * - must contain at least one letter or non-zero digit
 *
 * Invalid examples:
 * "000000", "----", "///", "invoice@123", "invoice 2026/001"
 */
export function isValidInvoiceNumber(value) {
  const invoiceNumber = normalizeInvoiceNumber(value);

  if (!INVOICE_NUMBER_REGEX.test(invoiceNumber)) {
    return false;
  }

  return /[A-Za-z1-9]/.test(invoiceNumber);
}

/* -------------------------------------------------------------------------- */
/* HSN/SAC                                                                    */
/* -------------------------------------------------------------------------- */

export function normalizeHsnSac(value) {
  return toTrimmedString(value);
}

export function isValidHsnSac(value) {
  return HSN_SAC_REGEX.test(normalizeHsnSac(value));
}

/* -------------------------------------------------------------------------- */
/* Place of Supply                                                            */
/* -------------------------------------------------------------------------- */

export function normalizePlaceOfSupply(value) {
  const raw = toTrimmedString(value);

  if (/^\d{1,2}$/.test(raw)) {
    return raw.padStart(2, '0');
  }

  return raw.toUpperCase();
}

export function isValidPlaceOfSupply(value) {
  return PLACE_OF_SUPPLY_REGEX.test(normalizePlaceOfSupply(value));
}

/* -------------------------------------------------------------------------- */
/* Export fields                                                              */
/* -------------------------------------------------------------------------- */

export function normalizeShippingBillNumber(value) {
  return toTrimmedString(value);
}

export function isValidShippingBillNumber(value) {
  return SHIPPING_BILL_NUMBER_REGEX.test(normalizeShippingBillNumber(value));
}

export function normalizePortCode(value) {
  return toTrimmedString(value).toUpperCase();
}

export function isValidPortCode(value) {
  return PORT_CODE_REGEX.test(normalizePortCode(value));
}

export function normalizeExportType(value) {
  return toUpper(value).replace(/[\s_-]+/g, '');
}

export function isValidExportType(value) {
  return EXPORT_TYPE_REGEX.test(normalizeExportType(value));
}

/* -------------------------------------------------------------------------- */
/* IRN / Source type                                                          */
/* -------------------------------------------------------------------------- */

export function normalizeIrn(value) {
  return toTrimmedString(value);
}

export function isValidIrn(value) {
  return IRN_REGEX.test(normalizeIrn(value));
}

export function normalizeSourceType(value) {
  return toUpper(value);
}

export function isValidSourceType(value) {
  return SOURCE_TYPE_REGEX.test(normalizeSourceType(value));
}

/* -------------------------------------------------------------------------- */
/* Document type                                                              */
/* -------------------------------------------------------------------------- */

export function normalizeDocumentType(value) {
  const raw = toUpper(value).replace(/[\s-]+/g, '_');

  const map = {
    INVOICE: 'INVOICE',
    TAX_INVOICE: 'INVOICE',
    SALES_INVOICE: 'INVOICE',

    CREDIT_NOTE: 'CREDIT_NOTE',
    CREDIT: 'CREDIT_NOTE',
    CN: 'CREDIT_NOTE',
    CREDITNOTE: 'CREDIT_NOTE',

    DEBIT_NOTE: 'DEBIT_NOTE',
    DEBIT: 'DEBIT_NOTE',
    DN: 'DEBIT_NOTE',
    DEBITNOTE: 'DEBIT_NOTE'
  };

  return map[raw] || raw;
}

export function isValidDocumentType(value) {
  return DOCUMENT_TYPE_REGEX.test(normalizeDocumentType(value));
}

export function isCreditNote(value) {
  return normalizeDocumentType(value) === 'CREDIT_NOTE';
}

export function isDebitNote(value) {
  return normalizeDocumentType(value) === 'DEBIT_NOTE';
}

/* -------------------------------------------------------------------------- */
/* Nil return type                                                            */
/* -------------------------------------------------------------------------- */

export function normalizeNilReturnType(value) {
  const compact = compactAlphaNumeric(value);

  if (compact === 'GSTR1' || compact === 'R1') {
    return 'GSTR1';
  }

  if (
    compact === 'GSTR3B' ||
    compact === 'GSTR3' ||
    compact === 'R3B'
  ) {
    return 'GSTR3B';
  }

  return compact;
}

export function isValidNilReturnType(value) {
  return NIL_RETURN_TYPES.includes(normalizeNilReturnType(value));
}

/* -------------------------------------------------------------------------- */
/* EVC form type                                                              */
/* -------------------------------------------------------------------------- */

export function normalizeEvcFormType(value) {
  const compact = compactAlphaNumeric(value);

  if (compact === 'R1' || compact === 'GSTR1') {
    return 'R1';
  }

  if (compact === 'R3B' || compact === 'GSTR3B') {
    return 'R3B';
  }

  return toUpper(value);
}

export function isValidEvcFormType(value) {
  const raw = toUpper(value);
  const normalized = normalizeEvcFormType(value);

  return (
    EVC_FORM_TYPES.includes(raw) ||
    normalized === 'R1' ||
    normalized === 'R3B'
  );
}

/* -------------------------------------------------------------------------- */
/* Verification mode                                                          */
/* -------------------------------------------------------------------------- */

export function normalizeVerificationMode(value) {
  return toUpper(value).replace(/[\s_-]+/g, '');
}

export function isValidVerificationMode(value) {
  return VERIFICATION_MODES.includes(normalizeVerificationMode(value));
}

export function isValidNilVerificationMode(value) {
  return NIL_VERIFICATION_MODES.includes(normalizeVerificationMode(value));
}

/* -------------------------------------------------------------------------- */
/* Amount / rate validation                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Checks whether value is a valid number representable in 2 decimal places.
 * Example valid: 100, 100.5, 100.55
 * Example invalid: 100.555
 */
export function isMultipleOf01(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) return false;

  const scaled = Math.round(n * 100);
  return Math.abs(n * 100 - scaled) < 1e-8;
}

/**
 * Monetary value validator.
 *
 * Options:
 * - allowNegative: default true, because credit notes can have negative values
 * - min: optional minimum value
 * - max: optional maximum value
 */
export function isValidMonetaryValue(
  value,
  { allowNegative = true, min = null, max = null } = {}
) {
  const raw = toTrimmedString(value);

  if (!raw) return false;

  const n = Number(raw);

  if (!Number.isFinite(n)) return false;
  if (!isMultipleOf01(n)) return false;
  if (!allowNegative && n < 0) return false;
  if (min !== null && n < min) return false;
  if (max !== null && n > max) return false;

  return true;
}

/**
 * Tax rate validator.
 * Generally 0 to 100, two decimal places.
 */
export function isValidTaxRate(value) {
  const raw = toTrimmedString(value);
  if (!raw) return false;

  const n = Number(raw);

  return (
    Number.isFinite(n) &&
    n >= 0 &&
    n <= 100 &&
    isMultipleOf01(n)
  );
}

/* -------------------------------------------------------------------------- */
/* GSTN date DD-MM-YYYY                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Validates GSTN-style date: DD-MM-YYYY.
 *
 * Options:
 * - allowFuture: default false
 */
export function isValidGstnDate(value, { allowFuture = false } = {}) {
  const raw = toTrimmedString(value);
  const match = raw.match(DATE_DD_MM_YYYY_REGEX);

  if (!match) return false;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  if (month < 1 || month > 12) return false;
  if (year < 1900 || year > 2100) return false;

  const d = new Date(Date.UTC(year, month - 1, day));

  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return false;
  }

  if (!allowFuture) {
    const today = nowIst();
    const todayUtc = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate()
    );

    if (d.getTime() > todayUtc) return false;
  }

  return true;
}

/* -------------------------------------------------------------------------- */
/* Default export for convenience                                             */
/* -------------------------------------------------------------------------- */

export default {
  GSTIN_REGEX,
  PERIOD_REGEX,
  PAN_REGEX,
  OTP_REGEX,
  EVC_OTP_REGEX,
  OBJECT_ID_REGEX,
  IDEMPOTENCY_KEY_REGEX,
  INVOICE_NUMBER_REGEX,
  HSN_SAC_REGEX,
  PLACE_OF_SUPPLY_REGEX,
  SHIPPING_BILL_NUMBER_REGEX,
  PORT_CODE_REGEX,
  EXPORT_TYPE_REGEX,
  IRN_REGEX,
  SOURCE_TYPE_REGEX,
  DOCUMENT_TYPE_REGEX,
  NIL_RETURN_TYPES,
  EVC_FORM_TYPES,
  VERIFICATION_MODES,
  NIL_VERIFICATION_MODES,
  DATE_DD_MM_YYYY_REGEX,

  nowIst,
  getCurrentIstPeriod,
  getLastMonthPeriod,
  normalizePeriod,
  isFuturePeriod,
  isCurrentPeriod,

  normalizeGstin,
  isValidGstin,

  normalizePan,
  isValidPan,
  isPersonalPan,

  normalizeOtp,
  isValidOtp,

  normalizeEvcOtp,
  isValidEvcOtp,

  isValidPeriod,

  normalizeObjectId,
  isValidObjectId,
  normalizeObjectIdList,

  normalizeIdempotencyKey,
  isValidIdempotencyKey,

  normalizeInvoiceNumber,
  isValidInvoiceNumber,

  normalizeHsnSac,
  isValidHsnSac,

  normalizePlaceOfSupply,
  isValidPlaceOfSupply,

  normalizeShippingBillNumber,
  isValidShippingBillNumber,

  normalizePortCode,
  isValidPortCode,

  normalizeExportType,
  isValidExportType,

  normalizeIrn,
  isValidIrn,

  normalizeSourceType,
  isValidSourceType,

  normalizeDocumentType,
  isValidDocumentType,
  isCreditNote,
  isDebitNote,

  normalizeNilReturnType,
  isValidNilReturnType,

  normalizeEvcFormType,
  isValidEvcFormType,

  normalizeVerificationMode,
  isValidVerificationMode,
  isValidNilVerificationMode,

  isMultipleOf01,
  isValidMonetaryValue,
  isValidTaxRate,

  isValidGstnDate
};