// Usage: node scripts/sanitize-sample.js <input.json> <output.json>
// Redacts secret/personal data while retaining response field names and structure.
const fs = require('fs');

const SECRET_KEY = /(token|auth|password|passwd|aspid|otp|secret|key|sek|rek|appkey|session|signature|certificate|private.?key)/i;
const PERSONAL_DATA_KEY = /(?:name|lgnm|trdnm|username|userid|gstin|pan|aadhaar|mobile|phone|email|address|contact|owner|person|invoiceno|invoicenumber|documentno|docno|refno)/i;
const HEX32 = /\b[0-9a-fA-F]{32,}\b/g;
const GSTIN = /\b(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /\b(?:\+91[ -]?)?[6-9]\d{9}\b/g;

function cleanString(s) {
  return s
    .replace(HEX32, 'REDACTED')
    .replace(GSTIN, (_, st) => st + 'XXXXXXXXXXXXX')
    .replace(PAN, 'REDACTED')
    .replace(EMAIL, 'REDACTED')
    .replace(PHONE, 'REDACTED');
}

function walk(value, key) {
  if (Array.isArray(value)) return value.map(v => walk(v, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k) || PERSONAL_DATA_KEY.test(k)) {
        out[k] = v === null || v === undefined ? v : 'REDACTED';
      } else {
        out[k] = walk(v, k);
      }
    }
    return out;
  }
  if (typeof value === 'string') {
    if (key && SECRET_KEY.test(key)) return 'REDACTED';
    return cleanString(value);
  }
  if (typeof value === 'number' && key && SECRET_KEY.test(key)) return 'REDACTED';
  return value;
}

function sanitizeSample(value) {
  return walk(value);
}

if (require.main === module) {
  const [inFile, outFile] = process.argv.slice(2);
  if (!inFile || !outFile) {
    console.error('Usage: node scripts/sanitize-sample.js <input.json> <output.json>');
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  } catch (e) {
    console.error('Input is not valid JSON:', e.message);
    process.exit(1);
  }
  fs.writeFileSync(outFile, JSON.stringify(sanitizeSample(data), null, 4) + '\n');
  console.log('Wrote', outFile, '- now inspect it for any unstructured personal data.');
}

module.exports = { sanitizeSample };
