// Usage: node scripts/sanitize-sample.js <input.json> <output.json>
// Redacts secret-looking values and masks GSTINs. ALWAYS read the output before committing.
const fs = require('fs');

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error('Usage: node scripts/sanitize-sample.js <input.json> <output.json>');
  process.exit(1);
}

const SECRET_KEY = /(token|auth|password|passwd|aspid|otp|secret|key|sek|rek|appkey)/i;
const HEX32 = /\b[0-9a-fA-F]{32,}\b/g;
const GSTIN = /\b(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;

function cleanString(s) {
  return s.replace(HEX32, 'REDACTED').replace(GSTIN, (_, st) => st + 'XXXXXXXXXXXXX');
}

function walk(value, key) {
  if (Array.isArray(value)) return value.map(v => walk(v, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, k);
    return out;
  }
  if (typeof value === 'string') {
    if (key && SECRET_KEY.test(key)) return 'REDACTED';
    return cleanString(value);
  }
  if (typeof value === 'number' && key && SECRET_KEY.test(key)) return 'REDACTED';
  return value;
}

let data;
try {
  data = JSON.parse(fs.readFileSync(inFile, 'utf8'));
} catch (e) {
  console.error('Input is not valid JSON:', e.message);
  process.exit(1);
}
fs.writeFileSync(outFile, JSON.stringify(walk(data), null, 4) + '\n');
console.log('Wrote', outFile, '- now open it and check it by eye before committing.');
