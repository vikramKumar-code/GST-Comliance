/**
 * Automated Tests for Bulk Ingestion Engine (ImportService: Invoices & Bills)
 */
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const ImportService = require('../src/services/import.service');
const Invoice = require('../src/models/Invoice');
const Bill = require('../src/models/Bill');
const Customer = require('../src/models/Customer');

async function runCheck(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

async function main() {
  console.log('--- Running Bulk Ingestion Engine Tests ---');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gst-compliance-test';
  await mongoose.connect(mongoUri);

  const testWs1 = new mongoose.Types.ObjectId();
  const testWs2 = new mongoose.Types.ObjectId();
  const supplierGstin = '27ABCDE1234F1Z5'; // Maharashtra (27)

  try {
    // Clean up
    await Invoice.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await Bill.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await Customer.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });

    // 1. Bulk Sales Ingestion with automatic Customer creation and Tax Calculation
    await runCheck('1. Import sales invoices auto-creates customers and calculates intra/inter tax', async () => {
      const rows = [
        {
          invoiceNumber: 'INV-IMP-001',
          customerName: 'Acme Maharashtra Corp',
          customerGstin: '27AABCA1234A1Z5',
          placeOfSupply: '27-Maharashtra',
          itemName: 'Software License',
          quantity: 2,
          rate: 10000,
          discount: 0,
          gstRate: 18,
          invoiceDate: '2026-10-10'
        },
        {
          invoiceNumber: 'INV-IMP-002',
          customerName: 'Global Karnataka Ltd',
          customerGstin: '29AABCG5678B1Z2',
          placeOfSupply: '29-Karnataka',
          itemName: 'Server Hardware',
          quantity: 1,
          rate: 50000,
          discount: 5000,
          gstRate: 18,
          invoiceDate: '2026-10-12'
        }
      ];

      const res = await ImportService.importInvoices(testWs1, supplierGstin, rows);
      assert.equal(res.importedCount, 2, 'Should import 2 invoices');
      assert.equal(res.errors.length, 0, 'Should have 0 errors');

      // Verify Intra-state Invoice (27 -> 27)
      const inv1 = await Invoice.findOne({ workspaceId: testWs1, invoiceNumber: 'INV-IMP-001' });
      assert.ok(inv1, 'INV-IMP-001 must exist');
      assert.equal(inv1.subTotal, 20000);
      assert.equal(inv1.totalCgst, 1800); // 9%
      assert.equal(inv1.totalSgst, 1800); // 9%
      assert.equal(inv1.totalIgst, 0);
      assert.equal(inv1.grandTotal, 23600);

      // Verify Inter-state Invoice (27 -> 29)
      const inv2 = await Invoice.findOne({ workspaceId: testWs1, invoiceNumber: 'INV-IMP-002' });
      assert.ok(inv2, 'INV-IMP-002 must exist');
      assert.equal(inv2.subTotal, 45000); // 50000 - 5000
      assert.equal(inv2.totalCgst, 0);
      assert.equal(inv2.totalSgst, 0);
      assert.equal(inv2.totalIgst, 8100); // 18% of 45000
      assert.equal(inv2.grandTotal, 53100);

      // Verify Customers auto-created
      const cust1 = await Customer.findOne({ workspaceId: testWs1, name: 'Acme Maharashtra Corp' });
      assert.ok(cust1, 'Customer Acme Maharashtra Corp must be auto-created');
      assert.equal(cust1.gstin, '27AABCA1234A1Z5');
    });

    // 2. Multi-line items grouped by invoiceNumber
    await runCheck('2. Multi-line items sharing same invoiceNumber are grouped into single invoice', async () => {
      const rows = [
        {
          invoiceNumber: 'INV-MULTI-001',
          customerName: 'Multi Item Client',
          customerGstin: '27AABCM9999C1Z9',
          placeOfSupply: '27',
          itemName: 'Item A',
          quantity: 2,
          rate: 1000,
          gstRate: 5
        },
        {
          invoiceNumber: 'INV-MULTI-001',
          customerName: 'Multi Item Client',
          itemName: 'Item B',
          quantity: 1,
          rate: 5000,
          gstRate: 18
        }
      ];

      const res = await ImportService.importInvoices(testWs1, supplierGstin, rows);
      assert.equal(res.importedCount, 1, 'Should create exactly 1 invoice for multi-line');

      const invMulti = await Invoice.findOne({ workspaceId: testWs1, invoiceNumber: 'INV-MULTI-001' });
      assert.ok(invMulti);
      assert.equal(invMulti.lineItems.length, 2, 'Should contain 2 line items');
      // Item A: 2 * 1000 = 2000, 5% tax = 100 (50 CGST + 50 SGST)
      // Item B: 1 * 5000 = 5000, 18% tax = 900 (450 CGST + 450 SGST)
      // Subtotal = 7000, CGST = 500, SGST = 500, Grand Total = 8000
      assert.equal(invMulti.subTotal, 7000);
      assert.equal(invMulti.totalCgst, 500);
      assert.equal(invMulti.totalSgst, 500);
      assert.equal(invMulti.grandTotal, 8000);
    });

    // 3. Duplicate handling and skipDuplicates option
    await runCheck('3. Duplicate invoice numbers are gracefully skipped or reported', async () => {
      const duplicateRows = [
        {
          invoiceNumber: 'INV-IMP-001', // Already exists
          customerName: 'Acme Maharashtra Corp',
          itemName: 'Duplicate Item',
          rate: 1000
        }
      ];

      // Default skipDuplicates: true
      const resSkip = await ImportService.importInvoices(testWs1, supplierGstin, duplicateRows, { skipDuplicates: true });
      assert.equal(resSkip.importedCount, 0);
      assert.equal(resSkip.skippedCount, 1);

      // skipDuplicates: false reports error
      const resErr = await ImportService.importInvoices(testWs1, supplierGstin, duplicateRows, { skipDuplicates: false });
      assert.equal(resErr.importedCount, 0);
      assert.equal(resErr.errors.length, 1);
      assert.match(resErr.errors[0].error, /already exists/i);
    });

    // 4. Bulk Purchase Bills Ingestion
    await runCheck('4. Import purchase bills calculates tax splits and records vendor details', async () => {
      const billRows = [
        {
          billNumber: 'BILL-IMP-001',
          vendorName: 'Local Hardware Supplier',
          vendorGstin: '27AABCV1111V1Z1',
          category: 'Inventory',
          description: 'Cables & Routers',
          quantity: 10,
          rate: 1000,
          gstRate: 18,
          billDate: '2026-10-15'
        },
        {
          billNumber: 'BILL-IMP-002',
          vendorName: 'Outstation Cloud Services',
          vendorGstin: '07AABCC2222C1Z2', // Delhi (07)
          category: 'Expense',
          description: 'Monthly Cloud Subscription',
          quantity: 1,
          rate: 25000,
          gstRate: 18,
          billDate: '2026-10-16'
        }
      ];

      const res = await ImportService.importBills(testWs1, supplierGstin, billRows);
      assert.equal(res.importedCount, 2);
      assert.equal(res.errors.length, 0);

      // Verify Intra-state Bill (27 vendor vs 27 buyer)
      const b1 = await Bill.findOne({ workspaceId: testWs1, billNumber: 'BILL-IMP-001' });
      assert.ok(b1);
      assert.equal(b1.subTotal, 10000);
      assert.equal(b1.totalCgst, 900);
      assert.equal(b1.totalSgst, 900);
      assert.equal(b1.totalIgst, 0);
      assert.equal(b1.grandTotal, 11800);

      // Verify Inter-state Bill (07 vendor vs 27 buyer)
      const b2 = await Bill.findOne({ workspaceId: testWs1, billNumber: 'BILL-IMP-002' });
      assert.ok(b2);
      assert.equal(b2.subTotal, 25000);
      assert.equal(b2.totalCgst, 0);
      assert.equal(b2.totalSgst, 0);
      assert.equal(b2.totalIgst, 4500);
      assert.equal(b2.grandTotal, 29500);
    });

    // 5. Strict Workspace Tenancy Isolation
    await runCheck('5. Tenancy isolation: imports in Workspace 1 never leak to Workspace 2', async () => {
      // Query workspace 2
      const ws2Invoices = await Invoice.find({ workspaceId: testWs2 });
      const ws2Bills = await Bill.find({ workspaceId: testWs2 });
      const ws2Customers = await Customer.find({ workspaceId: testWs2 });

      assert.equal(ws2Invoices.length, 0, 'Workspace 2 must have 0 invoices');
      assert.equal(ws2Bills.length, 0, 'Workspace 2 must have 0 bills');
      assert.equal(ws2Customers.length, 0, 'Workspace 2 must have 0 customers');

      // Now import into Workspace 2 with same invoice number as Workspace 1
      const res = await ImportService.importInvoices(testWs2, '29XYZ', [
        {
          invoiceNumber: 'INV-IMP-001', // Allowed in Ws2 because compound index is (workspaceId + invoiceNumber)
          customerName: 'Workspace 2 Customer',
          placeOfSupply: '29',
          itemName: 'Ws2 Item',
          rate: 500
        }
      ]);
      assert.equal(res.importedCount, 1, 'Workspace 2 can have its own INV-IMP-001');

      const ws1Count = await Invoice.countDocuments({ workspaceId: testWs1 });
      const ws2Count = await Invoice.countDocuments({ workspaceId: testWs2 });
      assert.equal(ws1Count, 3);
      assert.equal(ws2Count, 1);
    });

    console.log('\n🎉 ALL BULK INGESTION TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    // Clean up
    await Invoice.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await Bill.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await Customer.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}

module.exports = main;
