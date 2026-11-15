const Customer = require('../models/Customer');
const Item = require('../models/Item');
const Invoice = require('../models/Invoice');
const Bill = require('../models/Bill');
const { calculateInvoiceTotals, extractStateCode } = require('../utils/taxCalculator');
const { isValidGstin } = require('../utils/gstin'); // Added for validation

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeInvoiceStatus(status) {
  if (!status) return 'Sent';
  const s = String(status).trim().toLowerCase();
  if (s === 'draft') return 'Draft';
  if (s === 'paid') return 'Paid';
  if (s === 'overdue') return 'Overdue';
  if (s === 'cancelled') return 'Cancelled';
  return 'Sent';
}

function normalizeBillStatus(status) {
  if (!status) return 'Pending'; // Changed default to Pending for bills
  const s = String(status).trim().toLowerCase();
  if (s === 'draft') return 'Draft';
  if (s === 'paid') return 'Paid';
  if (s === 'overdue') return 'Overdue';
  if (s === 'cancelled') return 'Cancelled';
  return 'Pending';
}

/**
 * ✅ FIX 2: Safely parse dates from Excel, including Excel Serial Numbers (e.g., 45595)
 */
function parseExcelDate(dateVal) {
  if (!dateVal) return new Date();

  // Handle JS Date objects
  if (dateVal instanceof Date && !isNaN(dateVal.getTime())) return dateVal;

  // Convert Excel serial date numbers to JavaScript Date objects
  if (typeof dateVal === 'number' && dateVal > 30000 && dateVal < 100000) {
    // Excel's epoch is Dec 30, 1899 (accounting for the 1900 leap year bug)
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const jsDate = new Date(excelEpoch.getTime() + dateVal * 86400000);
    if (!isNaN(jsDate.getTime())) return jsDate;
  }

  const str = String(dateVal).trim();

  // If it's already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return new Date(str);
  }

  // Try native parsing first
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  // Fallback: try to split by '/' or '-'
  const parts = str.split(/[\/\-]/);
  if (parts.length === 3) {
    let day, month, year;
    if (parts[0].length === 4) {
      year = parts[0]; month = parts[1]; day = parts[2];
    } else if (parseInt(parts[0], 10) > 12) {
      day = parts[0]; month = parts[1]; year = parts[2];
    } else {
      month = parts[0]; day = parts[1]; year = parts[2];
    }

    if (year.length === 2) {
      year = parseInt(year, 10) > 50 ? `19${year}` : `20${year}`;
    }

    const normalizedDate = new Date(`${year}-${month}-${day}`);
    if (!isNaN(normalizedDate.getTime())) {
      return normalizedDate;
    }
  }

  return new Date();
}

class ImportService {
  /**
   * Import multiple sales invoices into the workspace
   */
  static async importInvoices(workspaceId, supplierGstin, rows = [], options = {}) {
    if (!workspaceId) throw new Error('workspaceId is required');
    if (!Array.isArray(rows) || rows.length === 0) {
      return { importedCount: 0, skippedCount: 0, errors: [{ error: 'No rows provided' }] };
    }

    const errors = [];
    const invoiceMap = new Map();

    // 1. Group rows by invoiceNumber & Extract metadata
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      const invoiceNumber = String(row.invoiceNumber || row['Invoice Number'] || row['Invoice #'] || '').trim();

      if (!invoiceNumber) {
        errors.push({ row: rowNum, error: 'Row missing required invoiceNumber' });
        continue;
      }

      const customerName = String(row.customerName || row['Customer Name'] || row['Customer'] || '').trim();
      if (!customerName && !invoiceMap.has(invoiceNumber)) {
        errors.push({ row: rowNum, invoiceNumber, error: 'Missing customerName' });
        continue;
      }

      if (!invoiceMap.has(invoiceNumber)) {
        const customerGstin = String(row.customerGstin || row['Customer GSTIN'] || row['GSTIN'] || '').trim().toUpperCase();
        let pos = String(row.placeOfSupply || row['Place of Supply'] || row['POS'] || '').trim();

        if (!pos) {
          if (isValidGstin(customerGstin)) pos = customerGstin.slice(0, 2);
          else pos = extractStateCode(supplierGstin) || '27';
        }

        const rawAddress = String(row.billingAddress || row['Billing Address'] || row['Customer Address'] || row['Address'] || '').trim();

        invoiceMap.set(invoiceNumber, {
          firstRow: rowNum,
          invoiceNumber,
          customerName,
          customerGstin: isValidGstin(customerGstin) ? customerGstin : '',
          placeOfSupply: pos,
          billingAddress: rawAddress ? { street: rawAddress, stateCode: pos, country: 'India' } : null,
          invoiceDate: parseExcelDate(row.invoiceDate || row['Invoice Date'] || row['Date']),
          dueDate: row.dueDate || row['Due Date'] ? parseExcelDate(row.dueDate || row['Due Date']) : null,
          status: normalizeInvoiceStatus(row.status),
          isExport: String(row.isExport || row['Is Export'] || '').trim().toLowerCase() === 'true',
          exportType: String(row.exportType || row['Export Type'] || '').trim().toUpperCase() || 'WOPAY',
          isReverseCharge: String(row.isReverseCharge || row['RCM'] || '').trim().toLowerCase() === 'true',
          rawItems: []
        });
      }

      const invEntry = invoiceMap.get(invoiceNumber);
      if (!invEntry.customerName && customerName) invEntry.customerName = customerName;
      if (!invEntry.billingAddress) {
        const rawAddress = String(row.billingAddress || row['Billing Address'] || row['Customer Address'] || row['Address'] || '').trim();
        if (rawAddress) invEntry.billingAddress = { street: rawAddress, stateCode: invEntry.placeOfSupply, country: 'India' };
      }

      const itemName = String(row.itemName || row['Item Name'] || row['Description'] || 'General Item').trim();
      const quantity = Math.max(0, Number(row.quantity ?? row['Quantity'] ?? row['Qty'] ?? 1) || 1);
      const rate = Math.max(0, Number(row.rate ?? row['Rate'] ?? row['Price'] ?? 0));
      const discount = Math.max(0, Number(row['Discount Amount'] ?? row.discount ?? row['Discount'] ?? 0));
      const gstRate = Math.max(0, Number(row.gstRate ?? row['GST Rate'] ?? row['GST %'] ?? 18));
      const hsnSac = String(row.hsnSac || row['HSN/SAC'] || row['HSN'] || '').trim();

      invEntry.rawItems.push({
        name: itemName,
        description: String(row.description || '').trim(),
        hsnSac,
        unit: String(row.unit || 'PCS').trim().toUpperCase(),
        quantity, rate, discount, gstRate
      });
    }

    let importedCount = 0;
    let skippedCount = 0;

    // Bulk fetch existing invoices to optimize database performance
    const invoiceNumbers = Array.from(invoiceMap.keys());
    const existingInvoices = await Invoice.find({
      workspaceId,
      invoiceNumber: { $in: invoiceNumbers }
    }).select('invoiceNumber').lean();
    const existingInvoiceSet = new Set(existingInvoices.map(inv => inv.invoiceNumber));

    // Bulk resolve customer profiles to avoid redundant queries
    const customerNames = Array.from(new Set(Array.from(invoiceMap.values()).map(inv => inv.customerName).filter(Boolean)));
    const customerGstins = Array.from(new Set(Array.from(invoiceMap.values()).map(inv => inv.customerGstin).filter(Boolean)));

    const existingCustomers = await Customer.find({
      workspaceId,
      $or: [
        { name: { $in: customerNames.map(n => new RegExp(`^${escapeRegex(n)}$`, 'i')) } },
        ...(customerGstins.length > 0 ? [{ gstin: { $in: customerGstins } }] : [])
      ]
    }).lean();

    const customerByName = new Map();
    const customerByGstin = new Map();
    existingCustomers.forEach(c => {
      if (c.name) customerByName.set(c.name.toLowerCase(), c);
      if (c.gstin) customerByGstin.set(c.gstin, c);
    });

    // 2. Process each invoice group
    for (const [, inv] of invoiceMap.entries()) {
      try {
        if (existingInvoiceSet.has(inv.invoiceNumber)) {
          if (options.skipDuplicates !== false) {
            skippedCount++;
            continue;
          } else {
            errors.push({ invoiceNumber: inv.invoiceNumber, error: 'Already exists' });
            continue;
          }
        }

        // Resolve Customer from bulk-fetched maps
        let customer = customerByGstin.get(inv.customerGstin) || customerByName.get(inv.customerName.toLowerCase());

        if (!customer) {
          customer = await Customer.create({
            workspaceId,
            name: inv.customerName,
            gstin: inv.customerGstin || '',
            placeOfSupply: inv.placeOfSupply,
            billingAddress: inv.billingAddress || undefined,
            gstType: inv.customerGstin ? 'Regular' : 'Consumer'
          });
          // Update maps for subsequent invoices with same customer
          customerByName.set(inv.customerName.toLowerCase(), customer);
          if (inv.customerGstin) customerByGstin.set(inv.customerGstin, customer);
        }

        // Calculate tax totals
        const calc = calculateInvoiceTotals(
          inv.rawItems.length > 0 ? inv.rawItems : [{ name: 'Item', quantity: 1, rate: 0, gstRate: 18 }],
          supplierGstin,
          inv.placeOfSupply
        );

        await Invoice.create({
          workspaceId,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          dueDate: inv.dueDate || undefined,
          customerId: customer._id,
          customerName: inv.customerName,
          customerGstin: inv.customerGstin,
          placeOfSupply: inv.placeOfSupply,
          billingAddress: inv.billingAddress || customer?.billingAddress || undefined,
          lineItems: calc.calculatedItems,
          subTotal: calc.subTotal,
          totalCgst: calc.totalCgst,
          totalSgst: calc.totalSgst,
          totalIgst: calc.totalIgst,
          totalTax: calc.totalTax,
          grandTotal: calc.grandTotal,
          status: inv.status,
          isExport: inv.isExport,
          exportType: inv.exportType,
          isReverseCharge: inv.isReverseCharge
        });

        importedCount++;
      } catch (err) {
        errors.push({ invoiceNumber: inv.invoiceNumber, error: err.message || 'Failed to save' });
      }
    }

    return {
      success: errors.length === 0,
      importedCount,
      skippedCount,
      totalProcessed: invoiceMap.size,
      errors
    };
  }

  /**
   * Import multiple purchase bills into the workspace
   */
  static async importBills(workspaceId, buyerGstin, rows = [], options = {}) {
    if (!workspaceId) throw new Error('workspaceId is required');
    if (!Array.isArray(rows) || rows.length === 0) {
      return { importedCount: 0, skippedCount: 0, errors: [{ error: 'No rows provided' }] };
    }

    const errors = [];
    const billMap = new Map();

    // 1. Group rows by billNumber
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      const billNumber = String(row.billNumber || row['Bill Number'] || row['Bill #'] || '').trim();

      if (!billNumber) {
        errors.push({ row: rowNum, error: 'Row missing required billNumber' });
        continue;
      }

      const vendorName = String(row.vendorName || row['Vendor Name'] || row['Vendor'] || '').trim();
      if (!vendorName && !billMap.has(billNumber)) {
        errors.push({ row: rowNum, billNumber, error: 'Missing vendorName' });
        continue;
      }

      if (!billMap.has(billNumber)) {
        const vendorGstin = String(row.vendorGstin || row['Vendor GSTIN'] || row['GSTIN'] || '').trim().toUpperCase();
        const category = String(row.category || row['Category'] || 'Expense').trim();
        const validCategory = ['Inventory', 'Expense', 'Asset', 'Service'].includes(category) ? category : 'Expense';

        billMap.set(billNumber, {
          firstRow: rowNum,
          billNumber,
          vendorName,
          vendorGstin: isValidGstin(vendorGstin) ? vendorGstin : '',
          billDate: parseExcelDate(row.billDate || row['Bill Date'] || row['Date']),
          dueDate: row.dueDate || row['Due Date'] ? parseExcelDate(row.dueDate || row['Due Date']) : null,
          category: validCategory,
          status: normalizeBillStatus(row.status),
          isReverseCharge: String(row.isReverseCharge || row['RCM'] || '').trim().toLowerCase() === 'true',
          itcEligible: String(row.itcEligible || row['ITC Eligible'] || 'true').trim().toLowerCase() !== 'false',
          rawItems: []
        });
      }

      const billEntry = billMap.get(billNumber);
      if (!billEntry.vendorName && vendorName) billEntry.vendorName = vendorName;

      const description = String(row.description || row['Description'] || row['Item Name'] || 'General Expense').trim();
      const quantity = Math.max(0, Number(row.quantity ?? row['Quantity'] ?? row['Qty'] ?? 1) || 1);
      const rate = Math.max(0, Number(row.rate ?? row['Rate'] ?? row['Price'] ?? 0));
      const gstRate = Math.max(0, Number(row.gstRate ?? row['GST Rate'] ?? row['GST %'] ?? 18));
      const hsnSac = String(row.hsnSac || row['HSN/SAC'] || row['HSN'] || '').trim();

      billEntry.rawItems.push({
        name: description, // Map description to name for tax calculator
        description,
        hsnSac,
        quantity,
        rate,
        gstRate
      });
    }

    let importedCount = 0;
    let skippedCount = 0;

    // ✅ FIX 1: Bulk fetch existing bills
    const billNumbers = Array.from(billMap.keys());
    const existingBills = await Bill.find({
      workspaceId,
      billNumber: { $in: billNumbers }
    }).select('billNumber').lean();
    const existingBillSet = new Set(existingBills.map(b => b.billNumber));

    // 2. Process each bill group
    for (const [, bill] of billMap.entries()) {
      try {
        if (existingBillSet.has(bill.billNumber)) {
          if (options.skipDuplicates !== false) {
            skippedCount++;
            continue;
          } else {
            errors.push({ billNumber: bill.billNumber, error: 'Already exists' });
            continue;
          }
        }

        // ✅ FIX 3: Use shared tax calculator instead of manual math
        // For bills, supplier is vendor, and place of supply is buyer (us)
        const buyerPos = extractStateCode(buyerGstin);
        const calc = calculateInvoiceTotals(bill.rawItems, bill.vendorGstin, buyerPos);

        await Bill.create({
          workspaceId,
          billNumber: bill.billNumber,
          vendorName: bill.vendorName,
          vendorGstin: bill.vendorGstin,
          billDate: bill.billDate,
          dueDate: bill.dueDate || undefined,
          category: bill.category,
          lineItems: calc.calculatedItems,
          subTotal: calc.subTotal,
          totalCgst: calc.totalCgst,
          totalSgst: calc.totalSgst,
          totalIgst: calc.totalIgst,
          totalTax: calc.totalTax,
          grandTotal: calc.grandTotal,
          status: bill.status,
          isReverseCharge: bill.isReverseCharge,
          itcEligible: bill.itcEligible,
          placeOfSupply: buyerPos
        });

        importedCount++;
      } catch (err) {
        errors.push({ billNumber: bill.billNumber, error: err.message || 'Failed to save' });
      }
    }

    return {
      success: errors.length === 0,
      importedCount,
      skippedCount,
      totalProcessed: billMap.size,
      errors
    };
  }
}

module.exports = ImportService;