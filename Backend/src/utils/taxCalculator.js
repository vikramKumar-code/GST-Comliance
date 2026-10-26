/**
 * GST Tax Calculation Utility for CandidTax Billing
 * Accurately calculates Taxable Value, CGST, SGST, IGST based on:
 * - Supplier GSTIN state code (first 2 digits)
 * - Recipient Place of Supply (POS) state code
 */

/**
 * Derives 2-digit state code from GSTIN or POS string
 * @param {string} val
 * @returns {string} 2-digit state code
 */
function extractStateCode(val) {
  if (!val) return '';
  const clean = String(val).trim().toUpperCase();
  if (clean.length >= 2 && /^\d{2}/.test(clean)) {
    return clean.slice(0, 2);
  }
  return clean;
}

/**
 * Calculates tax breakdown for an individual line item
 */
function calculateLineItem(item, supplierGstin, placeOfSupply) {
  const quantity = Math.max(0, Number(item.quantity) || 1);
  const rate = Math.max(0, Number(item.rate) || 0);
  const discount = Math.max(0, Number(item.discount) || 0);

  // Taxable value = (Quantity * Rate) - Discount
  const rawTaxable = Math.max(0, (quantity * rate) - discount);
  const taxableAmount = Math.round(rawTaxable * 100) / 100;

  const gstRate = Math.max(0, Number(item.gstRate) || 0);
  const supplierState = extractStateCode(supplierGstin);
  const posState = extractStateCode(placeOfSupply) || supplierState;

  const isIntraState = !posState || !supplierState || (posState === supplierState);

  let cgstRate = 0;
  let sgstRate = 0;
  let igstRate = 0;
  let cgstAmount = 0;
  let sgstAmount = 0;
  let igstAmount = 0;

  if (isIntraState) {
    cgstRate = Math.round((gstRate / 2) * 100) / 100;
    sgstRate = Math.round((gstRate / 2) * 100) / 100;
    cgstAmount = Math.round((taxableAmount * (cgstRate / 100)) * 100) / 100;
    sgstAmount = Math.round((taxableAmount * (sgstRate / 100)) * 100) / 100;
  } else {
    igstRate = gstRate;
    igstAmount = Math.round((taxableAmount * (igstRate / 100)) * 100) / 100;
  }

  const totalTax = Math.round((cgstAmount + sgstAmount + igstAmount) * 100) / 100;
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
    totalTax,
    totalAmount
  };
}

/**
 * Calculates complete invoice totals from line items
 */
function calculateInvoiceTotals(lineItems = [], supplierGstin = '', placeOfSupply = '') {
  const calculatedItems = lineItems.map((item) => calculateLineItem(item, supplierGstin, placeOfSupply));

  let subTotal = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  for (const item of calculatedItems) {
    subTotal += item.taxableAmount;
    totalCgst += item.cgstAmount;
    totalSgst += item.sgstAmount;
    totalIgst += item.igstAmount;
  }

  subTotal = Math.round(subTotal * 100) / 100;
  totalCgst = Math.round(totalCgst * 100) / 100;
  totalSgst = Math.round(totalSgst * 100) / 100;
  totalIgst = Math.round(totalIgst * 100) / 100;
  const totalTax = Math.round((totalCgst + totalSgst + totalIgst) * 100) / 100;
  const grandTotal = Math.round((subTotal + totalTax) * 100) / 100;

  return {
    calculatedItems,
    subTotal,
    totalCgst,
    totalSgst,
    totalIgst,
    totalTax,
    grandTotal,
    isIntraState: totalIgst === 0 && (totalCgst > 0 || totalSgst > 0)
  };
}

module.exports = {
  extractStateCode,
  calculateLineItem,
  calculateInvoiceTotals
};
