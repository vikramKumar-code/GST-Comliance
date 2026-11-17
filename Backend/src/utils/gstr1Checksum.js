const crypto = require('node:crypto');

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Official GSTN GSTR-1 checksum algorithm (v0.4-style):
 *
 * 1. Recursively sort object keys in ASCII ascending order.
 * 2. Sort item arrays by numeric 'num' ascending when all items have 'num'.
 * 3. For item-level objects, emit 'num' first, then remaining sorted keys.
 * 4. Format monetary/rate numbers with exactly 2 decimal places.
 * 5. Keep integer-like fields such as num/doc_num/totnum/cancel/net_issue as integers.
 * 6. Concatenate values only, separated by commas.
 * 7. Hash the final string using SHA-256 and return uppercase hex.
 *
 * NOTE:
 * Some older/internal implementations use "key=value" tokens.
 * That mode is retained behind GSTN_CHECKSUM_FORMAT=keyvalue for compatibility.
 */

const VALUE_FORMAT = 'values';
const KEYVALUE_FORMAT = 'keyvalue';

const SKIP_KEYS = new Set([
  'chksum',
  'checksum',
  'hash'
]);

// Fields that must remain integer-formatted in checksum string.
const INTEGER_KEYS = new Set([
  'num',
  'doc_num',
  'totnum',
  'cancel',
  'net_issue',
  'tnum',
  'sbnum'
]);

// Fields that should be rendered as 2-digit strings if received as numbers.
const TWO_DIGIT_KEYS = new Set([
  'pos'
]);

function normalizeFormat(format) {
  const raw = String(format || '').trim().toLowerCase();

  if (raw === 'kv' || raw === 'keyvalue' || raw === 'key-value') {
    return KEYVALUE_FORMAT;
  }

  if (
    raw === 'values' ||
    raw === 'value' ||
    raw === 'vals' ||
    raw === ''
  ) {
    return VALUE_FORMAT;
  }

  // Unknown format: fail safe to official/default values mode.
  return VALUE_FORMAT;
}

function resolveFormat() {
  return normalizeFormat(process.env.GSTN_CHECKSUM_FORMAT);
}

/* -------------------------------------------------------------------------- */
/* Generic helpers                                                            */
/* -------------------------------------------------------------------------- */

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function compareAscii(a, b) {
  const sa = String(a);
  const sb = String(b);

  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

function sortedKeys(obj) {
  return Object.keys(obj)
    .filter((key) => !SKIP_KEYS.has(key))
    .sort(compareAscii);
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatInteger(value) {
  const n = toFiniteNumber(value);

  if (n === null) return '';

  const truncated = Math.trunc(n);
  return String(truncated);
}

function formatTwoDigit(value) {
  const n = toFiniteNumber(value);

  if (n === null) return '';

  const truncated = Math.trunc(n);
  const abs = Math.abs(truncated);

  return String(abs).padStart(2, '0');
}

function formatDecimal(value) {
  const n = toFiniteNumber(value);

  if (n === null) return '';

  const fixed = n.toFixed(2);

  // Avoid "-0.00".
  return fixed === '-0.00' ? '0.00' : fixed;
}

function formatNumber(value, key) {
  if (INTEGER_KEYS.has(key)) {
    return formatInteger(value);
  }

  if (TWO_DIGIT_KEYS.has(key)) {
    return formatTwoDigit(value);
  }

  return formatDecimal(value);
}

/**
 * Returns:
 * - null  => field should be skipped entirely
 * - ''    => field exists but renders as empty token
 * - string => primitive token
 */
function formatPrimitive(value, key = '') {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    const formatted = formatNumber(value, key);
    return formatted === '' ? null : formatted;
  }

  if (typeof value === 'bigint') {
    const formatted = formatNumber(Number(value), key);
    return formatted === '' ? null : formatted;
  }

  if (typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    // Empty strings are normally removed by normalizeGstr1Payload().
    // Skipping them keeps checksum stable and avoids stray commas.
    return trimmed === '' ? null : trimmed;
  }

  // Symbols/functions are not expected in GSTN JSON.
  // Convert defensively but skip empty.
  const str = String(value).trim();
  return str === '' ? null : str;
}

function shouldSortByNum(array) {
  if (!Array.isArray(array) || array.length === 0) return false;

  return array.every(
    (item) => isPlainObject(item) && hasOwn(item, 'num')
  );
}

function sortItemArray(array) {
  if (!Array.isArray(array)) return array;

  if (!shouldSortByNum(array)) return array;

  return [...array].sort((a, b) => {
    const an = toFiniteNumber(a.num);
    const bn = toFiniteNumber(b.num);

    if (an !== null && bn !== null && an !== bn) {
      return an - bn;
    }

    return compareAscii(a.num ?? '', b.num ?? '');
  });
}

/* -------------------------------------------------------------------------- */
/* Value-only builder (official/default)                                      */
/* -------------------------------------------------------------------------- */

/**
 * Builds GSTN checksum string by concatenating values only.
 *
 * Example:
 * {
 *   num: 1,
 *   itm_det: { rt: 18, txval: 100 }
 * }
 *
 * becomes:
 * 1,18.00,100.00
 */
function buildValueString(node, seen = new WeakSet()) {
  if (node === null || node === undefined) {
    return '';
  }

  if (typeof node === 'object') {
    if (seen.has(node)) {
      throw new Error('Circular reference detected while building GSTN checksum string.');
    }

    seen.add(node);

    let result = '';

    if (Array.isArray(node)) {
      const sorted = sortItemArray(node);
      const parts = [];

      for (const item of sorted) {
        const child = buildValueString(item, seen);
        if (child !== '') parts.push(child);
      }

      result = parts.join(',');
    } else if (isPlainObject(node)) {
      const keys = sortedKeys(node);
      const parts = [];

      const orderedKeys = hasOwn(node, 'num')
        ? ['num', ...keys.filter((key) => key !== 'num')]
        : keys;

      for (const key of orderedKeys) {
        const value = node[key];

        if (value === null || value === undefined) {
          continue;
        }

        if (typeof value === 'object') {
          const child = buildValueString(value, seen);
          if (child !== '') parts.push(child);
          continue;
        }

        const formatted = formatPrimitive(value, key);
        if (formatted !== null && formatted !== '') {
          parts.push(formatted);
        }
      }

      result = parts.join(',');
    } else {
      // Rare: object-like but not plain object/array, e.g. Date.
      const formatted = formatPrimitive(node, '');
      result = formatted === null ? '' : formatted;
    }

    seen.delete(node);
    return result;
  }

  const formatted = formatPrimitive(node, '');
  return formatted === null ? '' : formatted;
}

/* -------------------------------------------------------------------------- */
/* Legacy key=value builder                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Legacy/internal compatibility mode.
 *
 * Example:
 * {
 *   num: 1,
 *   itm_det: { rt: 18, txval: 100 }
 * }
 *
 * becomes:
 * num=1,itm_det=rt=18.00,txval=100.00
 *
 * Do NOT use this unless your TaxPro/GSTN integration explicitly requires it.
 */
function buildKeyValueString(node, seen = new WeakSet()) {
  if (node === null || node === undefined) {
    return '';
  }

  if (typeof node === 'object') {
    if (seen.has(node)) {
      throw new Error('Circular reference detected while building GSTN checksum string.');
    }

    seen.add(node);

    let result = '';

    if (Array.isArray(node)) {
      const sorted = sortItemArray(node);
      const parts = [];

      for (const item of sorted) {
        const child = buildKeyValueString(item, seen);
        if (child !== '') parts.push(child);
      }

      result = parts.join(',');
    } else if (isPlainObject(node)) {
      const keys = sortedKeys(node);
      const parts = [];

      const orderedKeys = hasOwn(node, 'num')
        ? ['num', ...keys.filter((key) => key !== 'num')]
        : keys;

      for (const key of orderedKeys) {
        const value = node[key];

        if (value === null || value === undefined) {
          continue;
        }

        if (typeof value === 'object') {
          const child = buildKeyValueString(value, seen);
          if (child !== '') {
            parts.push(`${key}=${child}`);
          }
          continue;
        }

        const formatted = formatPrimitive(value, key);
        if (formatted !== null && formatted !== '') {
          parts.push(`${key}=${formatted}`);
        }
      }

      result = parts.join(',');
    } else {
      const formatted = formatPrimitive(node, '');
      result = formatted === null ? '' : formatted;
    }

    seen.delete(node);
    return result;
  }

  const formatted = formatPrimitive(node, '');
  return formatted === null ? '' : formatted;
}

/* -------------------------------------------------------------------------- */
/* Public builders                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Build raw checksum string using configured/default format.
 *
 * @param {*} obj
 * @param {{ format?: 'values'|'keyvalue'|'kv' }} [options]
 */
function buildChecksumString(obj, options = {}) {
  const format = normalizeFormat(options.format || resolveFormat());

  return format === KEYVALUE_FORMAT
    ? buildKeyValueString(obj)
    : buildValueString(obj);
}

/**
 * Compute SHA-256 uppercase hex checksum.
 *
 * @param {*} obj
 * @param {{ format?: 'values'|'keyvalue'|'kv' }} [options]
 */
function computeChecksum(obj, options = {}) {
  const checksumString = buildChecksumString(obj, options);

  return crypto
    .createHash('sha256')
    .update(checksumString, 'utf8')
    .digest('hex')
    .toUpperCase();
}

/**
 * Backward-compatible alias.
 */
function computeInvoiceChecksum(invoiceObj, options = {}) {
  return computeChecksum(invoiceObj, options);
}

/**
 * Backward-compatible alias for GSTR-1 naming.
 */
function computeGstr1InvoiceChecksum(invoiceObj, options = {}) {
  return computeChecksum(invoiceObj, options);
}

/* -------------------------------------------------------------------------- */
/* Validation helper                                                          */
/* -------------------------------------------------------------------------- */

function validateChecksumFormat(checksum) {
  if (!checksum || typeof checksum !== 'string') return false;

  return /^[a-fA-F0-9]{64}$/.test(checksum.trim());
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

module.exports = {
  VALUE_FORMAT,
  KEYVALUE_FORMAT,

  buildChecksumString,
  buildValueString,
  buildKeyValueString,

  computeChecksum,
  computeInvoiceChecksum,
  computeGstr1InvoiceChecksum,

  validateChecksumFormat,

  // Useful for tests/diagnostics.
  formatPrimitive,
  formatNumber,
  sortItemArray,
  sortedKeys
};