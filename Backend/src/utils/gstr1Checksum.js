const crypto = require('node:crypto');

/**
 * Official GSTN GSTR-1 Checksum Algorithm (v0.4 Specification)
 * 1. Recursively sorts all keys alphabetically (ASCII ascending order)
 * 2. Formats all floating-point monetary values to strict 2 decimal places (.toFixed(2))
 * 3. Sorts item arrays (itms) strictly by item number ('num' ascending)
 * 4. Appends 'num' FIRST for item-level objects before other attributes
 * 5. Generates SHA-256 hash of the concatenated string (NOT JSON) in uppercase hex
 */

function formatGstnValue(val, key = '') {
  if (typeof val === 'number') {
    // Serial numbers (num) are integers, no decimals
    if (key === 'num') return String(val);
    // Monetary values require strict 2 decimal places
    return Number(val).toFixed(2);
  }
  if (val === null || val === undefined) return '';
  return String(val);
}

function buildChecksumString(obj) {
  let str = '';

  // 1. Handle Arrays (Sort by 'num' if it's an item array)
  if (Array.isArray(obj)) {
    const isItemArray = obj.length > 0 && obj.every((item) => item && typeof item === 'object' && 'num' in item);
    const sortedArray = isItemArray
      ? [...obj].sort((a, b) => Number(a.num) - Number(b.num))
      : obj;

    for (const item of sortedArray) {
      str += buildChecksumString(item);
    }
    return str;
  }

  // 2. Handle Objects
  if (obj && typeof obj === 'object') {
    const sortedKeys = Object.keys(obj).sort();

    // 🔥 CRITICAL: "Append the item number and item level attribute names"
    // If this object has a 'num' property, it MUST be appended FIRST.
    if ('num' in obj) {
      str += `num=${formatGstnValue(obj.num, 'num')},`;
    }

    for (const key of sortedKeys) {
      // Skip 'num' (already added), and skip existing checksums
      if (key === 'num' || key === 'chksum' || key === 'hash') continue;

      const val = obj[key];

      if (val === null || val === undefined) {
        // ✅ FIX 1: Add comma after null/undefined values
        str += `${key}=,`;
      } else if (typeof val === 'object') {
        // For nested objects/arrays, append key= and then the nested string
        str += `${key}=`;
        str += buildChecksumString(val);
        // ✅ FIX 2: Add comma after nested object/array
        str += ',';
      } else {
        // Primitive value
        str += `${key}=${formatGstnValue(val, key)},`;
      }
    }
    return str;
  }

  return String(obj);
}

function computeInvoiceChecksum(invoiceObj) {
  // Generate the exact concatenated string required by GSTN
  let checksumString = buildChecksumString(invoiceObj);

  // 🔥 CRITICAL FIX: GSTN example strings do NOT have a trailing comma at the very end
  if (checksumString.endsWith(',')) {
    checksumString = checksumString.slice(0, -1);
  }

  // Calculate SHA-256 hash and return in UPPERCASE HEX
  return crypto.createHash('sha256').update(checksumString, 'utf8').digest('hex').toUpperCase();
}

/**
 * Utility: Validate that a checksum string matches expected GSTN format
 */
function validateChecksumFormat(checksum) {
  if (!checksum || typeof checksum !== 'string') return false;
  return /^[a-fA-F0-9]{64}$/.test(checksum); // Case-insensitive SHA-256 check (64 hex characters)
}

module.exports = {
  buildChecksumString,
  computeInvoiceChecksum,
  validateChecksumFormat
};