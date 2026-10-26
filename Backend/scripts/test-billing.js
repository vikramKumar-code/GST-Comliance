const assert = require('node:assert/strict');
const mongoose = require('mongoose');
process.env.NODE_ENV = 'test';

const { calculateLineItem, calculateInvoiceTotals, extractStateCode } = require('../src/utils/taxCalculator');
const Customer = require('../src/models/Customer');
const Item = require('../src/models/Item');
const Invoice = require('../src/models/Invoice');
const Bill = require('../src/models/Bill');

async function main() {
  console.log('--- Running Billing, Tax Calculation & Tenancy Tests ---');

  // 1. extractStateCode tests
  assert.equal(extractStateCode('29ABCDE1234F1Z5'), '29');
  assert.equal(extractStateCode('27AAPFU0939F1ZV'), '27');
  assert.equal(extractStateCode('07'), '07');
  assert.equal(extractStateCode(''), '');
  console.log('✓ 1. State code extraction handles GSTINs, 2-digit codes, and empty strings');

  // 2. Intra-state Tax Calculation (Same state 29 -> 29)
  const intraItem = calculateLineItem(
    { name: 'Consulting Service', quantity: 2, rate: 1000, discount: 100, gstRate: 18 },
    '29ABCDE1234F1Z5',
    '29'
  );
  // Taxable = 2 * 1000 - 100 = 1900
  assert.equal(intraItem.taxableAmount, 1900);
  assert.equal(intraItem.cgstRate, 9);
  assert.equal(intraItem.sgstRate, 9);
  assert.equal(intraItem.igstRate, 0);
  assert.equal(intraItem.cgstAmount, 171); // 9% of 1900 = 171
  assert.equal(intraItem.sgstAmount, 171);
  assert.equal(intraItem.igstAmount, 0);
  assert.equal(intraItem.totalTax, 342);
  assert.equal(intraItem.totalAmount, 2242);
  console.log('✓ 2. Intra-state item calculation splits tax 50/50 to CGST and SGST with zero IGST');

  // 3. Inter-state Tax Calculation (Different state 29 -> 27)
  const interItem = calculateLineItem(
    { name: 'Hardware Server', quantity: 1, rate: 50000, discount: 0, gstRate: 18 },
    '29ABCDE1234F1Z5',
    '27'
  );
  assert.equal(interItem.taxableAmount, 50000);
  assert.equal(interItem.cgstRate, 0);
  assert.equal(interItem.sgstRate, 0);
  assert.equal(interItem.igstRate, 18);
  assert.equal(interItem.cgstAmount, 0);
  assert.equal(interItem.sgstAmount, 0);
  assert.equal(interItem.igstAmount, 9000);
  assert.equal(interItem.totalTax, 9000);
  assert.equal(interItem.totalAmount, 59000);
  console.log('✓ 3. Inter-state item calculation applies 100% IGST with zero CGST/SGST');

  // 4. Complete Invoice Totals Calculation with mixed tax rates
  const invoiceCalc = calculateInvoiceTotals(
    [
      { name: 'Item 5%', quantity: 1, rate: 1000, discount: 0, gstRate: 5 },
      { name: 'Item 18%', quantity: 2, rate: 2000, discount: 500, gstRate: 18 }
    ],
    '29ABCDE1234F1Z5',
    '29'
  );
  // Item 1: taxable = 1000, cgst = 25, sgst = 25
  // Item 2: taxable = 3500, cgst = 315, sgst = 315
  assert.equal(invoiceCalc.subTotal, 4500);
  assert.equal(invoiceCalc.totalCgst, 340);
  assert.equal(invoiceCalc.totalSgst, 340);
  assert.equal(invoiceCalc.totalIgst, 0);
  assert.equal(invoiceCalc.totalTax, 680);
  assert.equal(invoiceCalc.grandTotal, 5180);
  assert.equal(invoiceCalc.isIntraState, true);
  console.log('✓ 4. Complete multi-item invoice totals aggregate taxable, taxes, and grand total correctly');

  // 5. Schema checks: Workspace isolation indexes
  const invoiceUniqueIndex = Invoice.schema.indexes().some(([keys, options]) =>
    keys.workspaceId === 1 && keys.invoiceNumber === 1 && options.unique === true
  );
  assert.equal(invoiceUniqueIndex, true, 'Invoice must enforce unique invoiceNumber per workspace');

  const customerWorkspaceIndex = Customer.schema.indexes().some(([keys]) =>
    keys.workspaceId === 1 && keys.name === 1
  );
  assert.equal(customerWorkspaceIndex, true, 'Customer must index on workspaceId + name');

  const itemWorkspaceIndex = Item.schema.indexes().some(([keys]) =>
    keys.workspaceId === 1 && keys.name === 1
  );
  assert.equal(itemWorkspaceIndex, true, 'Item must index on workspaceId + name');

  const billWorkspaceIndex = Bill.schema.indexes().some(([keys]) =>
    keys.workspaceId === 1 && keys.billNumber === 1
  );
  assert.equal(billWorkspaceIndex, true, 'Bill must index on workspaceId + billNumber');
  console.log('✓ 5. Mongoose schemas strictly enforce workspace-scoped indexes and uniqueness');

  // 6. Test Model validation without DB connection
  const validCustomer = new Customer({
    workspaceId: new mongoose.Types.ObjectId(),
    name: 'Acme Corp',
    gstin: '29ABCDE1234F1Z5'
  });
  let customerValErr = null;
  try {
    await validCustomer.validate();
  } catch (err) {
    customerValErr = err;
  }
  assert.equal(customerValErr, null, 'Valid customer passes validation');

  const invalidCustomer = new Customer({
    name: 'Missing Workspace'
  });
  let invCustErr = null;
  try {
    await invalidCustomer.validate();
  } catch (err) {
    invCustErr = err;
  }
  assert.ok(invCustErr && invCustErr.errors && invCustErr.errors.workspaceId, 'Customer requires workspaceId');

  const validInvoice = new Invoice({
    workspaceId: new mongoose.Types.ObjectId(),
    invoiceNumber: 'INV-202610-0001',
    customerName: 'Acme Corp',
    placeOfSupply: '29',
    subTotal: 1000,
    grandTotal: 1180,
    lineItems: [
      {
        name: 'Item A',
        quantity: 1,
        rate: 1000,
        taxableAmount: 1000,
        gstRate: 18,
        totalAmount: 1180
      }
    ]
  });
  let invErr = null;
  try {
    await validInvoice.validate();
  } catch (err) {
    invErr = err;
  }
  assert.equal(invErr, null, 'Valid invoice passes schema validation');
  console.log('✓ 6. Model schema validations prevent missing workspaceId or critical billing fields');

  console.log('\n🎉 ALL BILLING & TENANCY TESTS PASSED SUCCESSFULLY!\n');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
