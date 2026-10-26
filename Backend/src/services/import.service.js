const Customer = require('../models/Customer');
const Item = require('../models/Item');
const Invoice = require('../models/Invoice');
const Bill = require('../models/Bill');
const { calculateLineItem, calculateInvoiceTotals, extractStateCode } = require('../utils/taxCalculator');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  if (!status) return 'Paid';
  const s = String(status).trim().toLowerCase();
  if (s === 'draft') return 'Draft';
  if (s === 'pending') return 'Pending';
  if (s === 'overdue') return 'Overdue';
  return 'Paid';
}

/**
 * Service for Bulk Ingestion of Invoices and Bills
 */
class ImportService {
  /**
   * Import multiple sales invoices into the workspace
   * @param {string|mongoose.Types.ObjectId} workspaceId
   * @param {string} supplierGstin - The workspace/seller GSTIN
   * @param {Array<Object>} rows - Array of raw invoice row objects
   * @param {Object} options - { skipDuplicates: boolean }
   */
  static async importInvoices(workspaceId, supplierGstin, rows = [], options = {}) {
    if (!workspaceId) {
      throw new Error('workspaceId is required for importing invoices');
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return { importedCount: 0, skippedCount: 0, errors: [{ error: 'No rows provided for import' }] };
    }

    const errors = [];
    const invoiceMap = new Map();

    // 1. Group rows by invoiceNumber
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      const invoiceNumber = String(
        row.invoiceNumber || row['Invoice Number'] || row['Invoice #'] || row['invoice_number'] || ''
      ).trim();

      if (!invoiceNumber) {
        errors.push({ row: rowNum, error: 'Row missing required invoiceNumber' });
        continue;
      }

      const customerName = String(
        row.customerName || row['Customer Name'] || row['Customer'] || row['customer_name'] || ''
      ).trim();

      if (!customerName && !invoiceMap.has(invoiceNumber)) {
        errors.push({ row: rowNum, invoiceNumber, error: 'Missing customerName for invoice' });
        continue;
      }

      if (!invoiceMap.has(invoiceNumber)) {
        let pos = String(
          row.placeOfSupply || row['Place of Supply'] || row['POS'] || row['place_of_supply'] || ''
        ).trim();

        const customerGstin = String(
          row.customerGstin || row['Customer GSTIN'] || row['GSTIN'] || row['customer_gstin'] || ''
        ).trim().toUpperCase();

        if (!pos) {
          if (customerGstin.length >= 2) {
            pos = customerGstin.slice(0, 2);
          } else {
            pos = extractStateCode(supplierGstin) || '27';
          }
        }

        invoiceMap.set(invoiceNumber, {
          firstRow: rowNum,
          invoiceNumber,
          customerName,
          customerGstin,
          placeOfSupply: pos,
          invoiceDate: row.invoiceDate || row['Invoice Date'] || row['Date'] || new Date(),
          dueDate: row.dueDate || row['Due Date'] || null,
          status: normalizeInvoiceStatus(row.status),
          rawItems: []
        });
      }

      const invEntry = invoiceMap.get(invoiceNumber);
      if (!invEntry.customerName && customerName) {
        invEntry.customerName = customerName;
      }

      const itemName = String(
        row.itemName || row['Item Name'] || row['Description'] || row['Item'] || row['item_name'] || 'General Item'
      ).trim();
      const quantity = Math.max(0, Number(row.quantity ?? row['Quantity'] ?? row['Qty'] ?? 1) || 1);
      const rate = Math.max(0, Number(row.rate ?? row['Rate'] ?? row['Price'] ?? row['Unit Price'] ?? 0));
      const discount = Math.max(0, Number(row.discount ?? row['Discount'] ?? 0));
      const gstRate = Math.max(
        0,
        Number(
          row.gstRate !== undefined
            ? row.gstRate
            : (row['GST Rate'] ?? row['GST %'] ?? row['Tax Rate'] ?? 18)
        )
      );
      const hsnSac = String(row.hsnSac || row['HSN/SAC'] || row['HSN'] || '').trim();

      invEntry.rawItems.push({
        name: itemName,
        description: String(row.description || '').trim(),
        hsnSac,
        unit: String(row.unit || 'PCS').trim(),
        quantity,
        rate,
        discount,
        gstRate
      });
    }

    let importedCount = 0;
    let skippedCount = 0;
    const createdInvoices = [];

    // 2. Process each invoice group
    for (const [, inv] of invoiceMap.entries()) {
      try {
        if (!inv.customerName) {
          errors.push({ invoiceNumber: inv.invoiceNumber, error: 'Customer name is required' });
          continue;
        }

        // Check if invoice already exists in this workspace
        const existing = await Invoice.findOne({ workspaceId, invoiceNumber: inv.invoiceNumber });
        if (existing) {
          if (options.skipDuplicates !== false) {
            skippedCount++;
            continue;
          } else {
            errors.push({ invoiceNumber: inv.invoiceNumber, error: `Invoice ${inv.invoiceNumber} already exists in this workspace` });
            continue;
          }
        }

        // Resolve or create Customer in workspace
        let customer = await Customer.findOne({
          workspaceId,
          $or: [
            { name: { $regex: new RegExp(`^${escapeRegex(inv.customerName)}$`, 'i') } },
            ...(inv.customerGstin ? [{ gstin: inv.customerGstin }] : [])
          ]
        });

        if (!customer) {
          customer = await Customer.create({
            workspaceId,
            name: inv.customerName,
            gstin: inv.customerGstin || '',
            placeOfSupply: inv.placeOfSupply
          });
        }

        // Calculate tax totals with taxCalculator
        const calc = calculateInvoiceTotals(
          inv.rawItems.length > 0 ? inv.rawItems : [{ name: 'Item', quantity: 1, rate: 0, gstRate: 18 }],
          supplierGstin,
          inv.placeOfSupply
        );

        const newInvoice = await Invoice.create({
          workspaceId,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: new Date(inv.invoiceDate),
          dueDate: inv.dueDate ? new Date(inv.dueDate) : undefined,
          customerId: customer._id,
          customerName: inv.customerName,
          customerGstin: inv.customerGstin,
          placeOfSupply: inv.placeOfSupply,
          lineItems: calc.calculatedItems || calc.lineItems || [],
          subTotal: calc.subTotal,
          totalCgst: calc.totalCgst,
          totalSgst: calc.totalSgst,
          totalIgst: calc.totalIgst,
          totalTax: calc.totalTax,
          grandTotal: calc.grandTotal,
          status: inv.status || 'Sent'
        });

        createdInvoices.push(newInvoice);
        importedCount++;
      } catch (err) {
        errors.push({
          invoiceNumber: inv.invoiceNumber,
          error: err.message || 'Failed to save invoice'
        });
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
   * @param {string|mongoose.Types.ObjectId} workspaceId
   * @param {string} buyerGstin - The workspace GSTIN
   * @param {Array<Object>} rows - Array of raw bill row objects
   * @param {Object} options - { skipDuplicates: boolean }
   */
  static async importBills(workspaceId, buyerGstin, rows = [], options = {}) {
    if (!workspaceId) {
      throw new Error('workspaceId is required for importing bills');
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return { importedCount: 0, skippedCount: 0, errors: [{ error: 'No rows provided for import' }] };
    }

    const errors = [];
    const billMap = new Map();

    // 1. Group rows by billNumber
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      const billNumber = String(
        row.billNumber || row['Bill Number'] || row['Bill #'] || row['bill_number'] || ''
      ).trim();

      if (!billNumber) {
        errors.push({ row: rowNum, error: 'Row missing required billNumber' });
        continue;
      }

      const vendorName = String(
        row.vendorName || row['Vendor Name'] || row['Vendor'] || row['vendor_name'] || ''
      ).trim();

      if (!vendorName && !billMap.has(billNumber)) {
        errors.push({ row: rowNum, billNumber, error: 'Missing vendorName for bill' });
        continue;
      }

      if (!billMap.has(billNumber)) {
        const vendorGstin = String(
          row.vendorGstin || row['Vendor GSTIN'] || row['GSTIN'] || row['vendor_gstin'] || ''
        ).trim().toUpperCase();

        const category = String(row.category || row['Category'] || 'Expense').trim();
        const validCategory = ['Inventory', 'Expense', 'Asset', 'Service'].includes(category)
          ? category
          : 'Expense';

        billMap.set(billNumber, {
          firstRow: rowNum,
          billNumber,
          vendorName,
          vendorGstin,
          billDate: row.billDate || row['Bill Date'] || row['Date'] || new Date(),
          dueDate: row.dueDate || row['Due Date'] || null,
          category: validCategory,
          status: normalizeBillStatus(row.status),
          rawItems: []
        });
      }

      const billEntry = billMap.get(billNumber);
      if (!billEntry.vendorName && vendorName) {
        billEntry.vendorName = vendorName;
      }

      const description = String(
        row.description || row['Description'] || row['Item Name'] || row['Item'] || 'General Expense'
      ).trim();
      const quantity = Math.max(0, Number(row.quantity ?? row['Quantity'] ?? row['Qty'] ?? 1) || 1);
      const rate = Math.max(0, Number(row.rate ?? row['Rate'] ?? row['Price'] ?? row['Unit Price'] ?? 0));
      const gstRate = Math.max(
        0,
        Number(
          row.gstRate !== undefined
            ? row.gstRate
            : (row['GST Rate'] ?? row['GST %'] ?? row['Tax Rate'] ?? 18)
        )
      );
      const hsnSac = String(row.hsnSac || row['HSN/SAC'] || row['HSN'] || '').trim();

      billEntry.rawItems.push({
        description,
        hsnSac,
        quantity,
        rate,
        gstRate
      });
    }

    let importedCount = 0;
    let skippedCount = 0;
    const createdBills = [];

    // 2. Process each bill group
    for (const [, bill] of billMap.entries()) {
      try {
        if (!bill.vendorName) {
          errors.push({ billNumber: bill.billNumber, error: 'Vendor name is required' });
          continue;
        }

        const existing = await Bill.findOne({ workspaceId, billNumber: bill.billNumber });
        if (existing) {
          if (options.skipDuplicates !== false) {
            skippedCount++;
            continue;
          } else {
            errors.push({ billNumber: bill.billNumber, error: `Bill ${bill.billNumber} already exists in this workspace` });
            continue;
          }
        }

        // Calculate tax breakdown per bill item
        const buyerState = extractStateCode(buyerGstin);
        const vendorState = extractStateCode(bill.vendorGstin) || buyerState;
        const isIntraState = !buyerState || !vendorState || (buyerState === vendorState);

        let subTotal = 0;
        let totalCgst = 0;
        let totalSgst = 0;
        let totalIgst = 0;
        const lineItems = [];

        for (const itm of bill.rawItems) {
          const taxableAmount = Math.round((itm.quantity * itm.rate) * 100) / 100;
          let cgst = 0;
          let sgst = 0;
          let igst = 0;

          if (isIntraState) {
            cgst = Math.round((taxableAmount * (itm.gstRate / 200)) * 100) / 100;
            sgst = Math.round((taxableAmount * (itm.gstRate / 200)) * 100) / 100;
          } else {
            igst = Math.round((taxableAmount * (itm.gstRate / 100)) * 100) / 100;
          }

          const totalTax = Math.round((cgst + sgst + igst) * 100) / 100;
          const totalAmount = Math.round((taxableAmount + totalTax) * 100) / 100;

          subTotal += taxableAmount;
          totalCgst += cgst;
          totalSgst += sgst;
          totalIgst += igst;

          lineItems.push({
            description: itm.description,
            hsnSac: itm.hsnSac,
            quantity: itm.quantity,
            rate: itm.rate,
            taxableAmount,
            gstRate: itm.gstRate,
            cgstAmount: cgst,
            sgstAmount: sgst,
            igstAmount: igst,
            totalTax,
            totalAmount
          });
        }

        const totalTax = Math.round((totalCgst + totalSgst + totalIgst) * 100) / 100;
        const grandTotal = Math.round((subTotal + totalTax) * 100) / 100;

        const newBill = await Bill.create({
          workspaceId,
          billNumber: bill.billNumber,
          vendorName: bill.vendorName,
          vendorGstin: bill.vendorGstin,
          billDate: new Date(bill.billDate),
          dueDate: bill.dueDate ? new Date(bill.dueDate) : undefined,
          category: bill.category,
          lineItems,
          subTotal: Math.round(subTotal * 100) / 100,
          totalCgst: Math.round(totalCgst * 100) / 100,
          totalSgst: Math.round(totalSgst * 100) / 100,
          totalIgst: Math.round(totalIgst * 100) / 100,
          totalTax,
          grandTotal,
          status: bill.status || 'Paid'
        });

        createdBills.push(newBill);
        importedCount++;
      } catch (err) {
        errors.push({
          billNumber: bill.billNumber,
          error: err.message || 'Failed to save bill'
        });
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
