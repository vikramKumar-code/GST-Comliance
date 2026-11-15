/**
 * GST Tax Calculation Utility for CandidTax Billing
 * Accurately calculates Taxable Value, CGST, SGST, IGST based on:
 * - Supplier GSTIN state code (first 2 digits)
 * - Recipient Place of Supply (POS) state code
 * 
 * Complies with CGST Act 2017 Section 15 (Valuation) and Section 7 (Supply)
 */

// Standard GST tax slabs as per GST Council
const VALID_GST_SLABS = [0, 0.25, 3, 5, 12, 18, 28];

/**
 * Derives 2-digit state code from GSTIN or POS string
 * @param {string} val - GSTIN (e.g., "06AABCU9603R1ZM") or POS (e.g., "06-HARYANA" or "06")
 * @returns {string} 2-digit state code (e.g., "06") or empty string
 */
function extractStateCode(val) {
  if (val === null || val === undefined || val === '') return '';
  const clean = String(val).trim().toUpperCase();

  // If it starts with 1 or 2 digits (like "06-HARYANA", "06AABCU9603R1ZM", "06", or "6"), return 2-digit state code
  const match = clean.match(/^(\d{1,2})/);
  if (match) {
    return match[1].padStart(2, '0');
  }

  // Fallback: return empty (will be handled by caller)
  return '';
}

/**
 * Validates if a GST rate is a standard slab
 * @param {number} rate - GST rate percentage
 * @returns {boolean}
 */
function isValidGstSlab(rate) {
  return VALID_GST_SLABS.includes(rate);
}

/**
 * Calculates tax breakdown for an individual line item
 * @param {Object} item - Line item object
 * @param {string} supplierGstin - Supplier's GSTIN
 * @param {string} placeOfSupply - Place of Supply (state code or full string)
 * @param {Object} options - Additional options
 * @param {boolean} options.isReverseCharge - Is this a Reverse Charge supply?
 * @returns {Object} Calculated item with tax breakdown
 */
function calculateLineItem(item, supplierGstin, placeOfSupply, options = {}) {
  const { isReverseCharge = false } = options;

  const quantity = Math.max(0, Number(item.quantity) || 1);
  const rate = Math.max(0, Number(item.rate) || 0);
  const discount = Math.max(0, Number(item.discount) || 0);

  // Taxable value = (Quantity * Rate) - Discount
  // Note: As per Section 15(3), only pre-supply discounts recorded in invoice can be excluded
  const rawTaxable = Math.max(0, (quantity * rate) - discount);
  const taxableAmount = Math.round(rawTaxable * 100) / 100;

  const gstRate = Math.max(0, Number(item.gstRate) || 0);

  // Optional: Validate GST slab (warn in dev, strict in prod)
  if (gstRate > 0 && !isValidGstSlab(gstRate)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Invalid GST rate: ${gstRate}%. Must be one of: ${VALID_GST_SLABS.join(', ')}%`);
    } else {
      console.warn(`[TaxCalculator] Non-standard GST rate: ${gstRate}% for item: ${item.name}`);
    }
  }

  const supplierState = extractStateCode(supplierGstin);
  const posState = extractStateCode(placeOfSupply) || supplierState;

  // Determine if Intra-state based on state codes, not tax amounts
  const isIntraState = !posState || !supplierState || (posState === supplierState);

  let cgstRate = 0;
  let sgstRate = 0;
  let igstRate = 0;
  let cgstAmount = 0;
  let sgstAmount = 0;
  let igstAmount = 0;

  // Calculate tax amounts based on supply type
  if (isIntraState) {
    // Intra-state: Split GST into CGST + SGST (equal halves)
    cgstRate = Math.round((gstRate / 2) * 100) / 100;
    sgstRate = Math.round((gstRate / 2) * 100) / 100;
    cgstAmount = Math.round((taxableAmount * (cgstRate / 100)) * 100) / 100;
    sgstAmount = Math.round((taxableAmount * (sgstRate / 100)) * 100) / 100;
  } else {
    // Inter-state: Full IGST
    igstRate = gstRate;
    igstAmount = Math.round((taxableAmount * (igstRate / 100)) * 100) / 100;
  }

  // ✅ NEW: Cess calculation (if applicable)
  const cessRate = Math.max(0, Number(item.cessRate) || 0);
  let cessAmount = 0;
  if (cessRate > 0) {
    // Cess is calculated on taxable value (not on GST amount)
    cessAmount = Math.round((taxableAmount * (cessRate / 100)) * 100) / 100;
  }

  const totalTax = Math.round((cgstAmount + sgstAmount + igstAmount + cessAmount) * 100) / 100;
  const totalAmount = Math.round((taxableAmount + totalTax) * 100) / 100;

  return {
    itemId: item.itemId || null,
    name: item.name ? String(item.name).trim() : 'Item',
    description: item.description ? String(item.description).trim() : '',
    hsnSac: item.hsnSac ? String(item.hsnSac).trim() : '',
    unit: item.unit ? String(item.unit).trim().toUpperCase() : 'PCS',
    quantity,
    rate,
    discount,
    taxableAmount,
    gstRate,
    cgstRate,
    sgstRate,
    igstRate,
    cgstAmount,
    sgstAmount,
    igstAmount,
    cessRate,
    cessAmount,
    totalTax,
    totalAmount,
    isIntraState,
    isReverseCharge // Pass through for downstream use
  };
}

/**
 * Calculates complete invoice totals from line items
 * @param {Array} lineItems - Array of line item objects
 * @param {string} supplierGstin - Supplier's GSTIN
 * @param {string} placeOfSupply - Place of Supply (state code or full string)
 * @param {Object} options - Additional options
 * @param {boolean} options.isReverseCharge - Is this a Reverse Charge invoice?
 * @returns {Object} Invoice totals with tax breakdown
 */
function calculateInvoiceTotals(lineItems = [], supplierGstin = '', placeOfSupply = '', options = {}) {
  const calculatedItems = lineItems.map((item) => calculateLineItem(item, supplierGstin, placeOfSupply, options));

  // ✅ FIX 1: Sum already-rounded values (no double rounding)
  let subTotal = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let totalCess = 0;

  for (const item of calculatedItems) {
    subTotal += item.taxableAmount;
    totalCgst += item.cgstAmount;
    totalSgst += item.sgstAmount;
    totalIgst += item.igstAmount;
    totalCess += item.cessAmount;
  }

  // Round only once at the end (values are already rounded at item level)
  subTotal = Math.round(subTotal * 100) / 100;
  totalCgst = Math.round(totalCgst * 100) / 100;
  totalSgst = Math.round(totalSgst * 100) / 100;
  totalIgst = Math.round(totalIgst * 100) / 100;
  totalCess = Math.round(totalCess * 100) / 100;

  const totalTax = Math.round((totalCgst + totalSgst + totalIgst + totalCess) * 100) / 100;
  const grandTotal = Math.round((subTotal + totalTax) * 100) / 100;

  // Determine isIntraState based on state codes (handles 0% tax correctly)
  const supplierState = extractStateCode(supplierGstin);
  const posState = extractStateCode(placeOfSupply) || supplierState;
  const isIntraState = !posState || !supplierState || (posState === supplierState);

  return {
    calculatedItems,
    subTotal,
    totalCgst,
    totalSgst,
    totalIgst,
    totalCess, // ✅ NEW
    totalTax,
    grandTotal,
    isIntraState,
    isReverseCharge: options.isReverseCharge || false // ✅ NEW
  };
}

/**
 * Validates tax calculation accuracy (useful for testing/debugging)
 * @param {Object} totals - Invoice totals object
 * @returns {Object} Validation result with any discrepancies
 */
function validateTaxCalculation(totals) {
  const issues = [];

  // Check if CGST + SGST + IGST + Cess = Total Tax
  const calculatedTotalTax = totals.totalCgst + totals.totalSgst + totals.totalIgst + totals.totalCess;
  const taxDiff = Math.abs(calculatedTotalTax - totals.totalTax);

  if (taxDiff > 0.01) {
    issues.push({
      type: 'TAX_SUM_MISMATCH',
      expected: calculatedTotalTax,
      actual: totals.totalTax,
      difference: taxDiff
    });
  }

  // Check if SubTotal + TotalTax = GrandTotal
  const calculatedGrandTotal = totals.subTotal + totals.totalTax;
  const grandTotalDiff = Math.abs(calculatedGrandTotal - totals.grandTotal);

  if (grandTotalDiff > 0.01) {
    issues.push({
      type: 'GRAND_TOTAL_MISMATCH',
      expected: calculatedGrandTotal,
      actual: totals.grandTotal,
      difference: grandTotalDiff
    });
  }

  // Check if intra-state has both CGST and SGST
  if (totals.isIntraState && totals.totalIgst > 0) {
    issues.push({
      type: 'IGST_IN_INTRASTATE',
      message: 'IGST should be 0 for intra-state supplies'
    });
  }

  // Check if inter-state has CGST or SGST
  if (!totals.isIntraState && (totals.totalCgst > 0 || totals.totalSgst > 0)) {
    issues.push({
      type: 'CGST_SGST_IN_INTERSTATE',
      message: 'CGST/SGST should be 0 for inter-state supplies'
    });
  }

  return {
    isValid: issues.length === 0,
    issues
  };
}

module.exports = {
  extractStateCode,
  calculateLineItem,
  calculateInvoiceTotals,
  validateTaxCalculation, // ✅ NEW: Testing utility
  isValidGstSlab, // ✅ NEW: Validation utility
  VALID_GST_SLABS // ✅ NEW: Export for reference
};