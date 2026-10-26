/**
 * Unit & Integration Tests for Gstr1Service (GSTR-1 Payload Builder & Dry-Run Save)
 */
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Gstr1Service = require('../src/services/gstr1.service');
const Invoice = require('../src/models/Invoice');
const AuditLog = require('../src/models/AuditLog');

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
  console.log('--- Running GSTR-1 Payload Builder & Dry-Run Tests ---');

  // Connect to isolated in-memory or test database
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gst-compliance-test';
  await mongoose.connect(mongoUri);

  const testWs1 = new mongoose.Types.ObjectId();
  const testWs2 = new mongoose.Types.ObjectId();
  const testGstin = '33AANCS2882A1ZG';

  try {
    // Clean up test data
    await Invoice.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await AuditLog.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });

    // 1. Create test invoices for Workspace 1 in period 102026 (October 2026)
    // B2B Invoice
    await Invoice.create({
      workspaceId: testWs1,
      invoiceNumber: 'INV-2026-001',
      invoiceDate: new Date('2026-10-10T10:00:00Z'),
      customerName: 'Delhi Tech Pvt Ltd',
      customerGstin: '07AAAAA0000A1Z5',
      placeOfSupply: '07-Delhi',
      billingAddress: { state: 'Delhi', stateCode: '07' },
      status: 'Sent',
      lineItems: [
        {
          name: 'Computer Server',
          hsnSac: '8471',
          unit: 'NOS',
          quantity: 2,
          rate: 50000,
          taxableAmount: 100000,
          gstRate: 18,
          igstRate: 18,
          igstAmount: 18000,
          totalAmount: 118000
        }
      ],
      subTotal: 100000,
      totalTaxable: 100000,
      totalIgst: 18000,
      totalCgst: 0,
      totalSgst: 0,
      grandTotal: 118000
    });

    // B2CS Invoice (Unregistered customer, intra-state Tamil Nadu)
    await Invoice.create({
      workspaceId: testWs1,
      invoiceNumber: 'INV-2026-002',
      invoiceDate: new Date('2026-10-15T12:00:00Z'),
      customerName: 'Local Retail Buyer',
      customerGstin: '',
      placeOfSupply: '33-Tamil Nadu',
      billingAddress: { state: 'Tamil Nadu', stateCode: '33' },
      status: 'Paid',
      lineItems: [
        {
          name: 'USB Cable',
          hsnSac: '8544',
          unit: 'PCS',
          quantity: 10,
          rate: 500,
          taxableAmount: 5000,
          gstRate: 18,
          cgstRate: 9,
          sgstRate: 9,
          cgstAmount: 450,
          sgstAmount: 450,
          totalAmount: 5900
        }
      ],
      subTotal: 5000,
      totalTaxable: 5000,
      totalIgst: 0,
      totalCgst: 450,
      totalSgst: 450,
      grandTotal: 5900
    });

    // Cancelled Invoice (Should be excluded from taxable counts, but included in doc_issue)
    await Invoice.create({
      workspaceId: testWs1,
      invoiceNumber: 'INV-2026-003',
      invoiceDate: new Date('2026-10-20T14:00:00Z'),
      customerName: 'Mistake Order',
      customerGstin: '',
      placeOfSupply: '33-Tamil Nadu',
      status: 'Cancelled',
      lineItems: [
        {
          name: 'Void item',
          hsnSac: '9999',
          quantity: 1,
          rate: 1000,
          taxableAmount: 1000,
          gstRate: 18,
          totalAmount: 1180
        }
      ],
      subTotal: 1000,
      totalTaxable: 1000,
      grandTotal: 1180
    });

    // Invoice for Workspace 2 (To test tenancy isolation)
    await Invoice.create({
      workspaceId: testWs2,
      invoiceNumber: 'WS2-INV-001',
      invoiceDate: new Date('2026-10-12T10:00:00Z'),
      customerName: 'Other Workspace Customer',
      customerGstin: '29ABCDE1234F1Z5',
      placeOfSupply: '29-Karnataka',
      status: 'Paid',
      lineItems: [
        {
          name: 'Secret Item',
          hsnSac: '9999',
          quantity: 1,
          rate: 99999,
          taxableAmount: 99999,
          gstRate: 18,
          totalAmount: 117998
        }
      ],
      subTotal: 99999,
      totalTaxable: 99999,
      grandTotal: 117998
    });

    // --- TEST SUITE EXECUTION ---

    // 1. Prepare GSTR-1 payload structure
    await runCheck('1. Gstr1Service prepares valid GSTN GSTR-1 schema with B2B, B2CS, HSN, and DOCISS', async () => {
      const res = await Gstr1Service.preparePayload(testWs1, testGstin, '102026');

      assert.equal(res.success, true);
      assert.equal(res.period, '102026');
      assert.equal(res.gstin, testGstin);

      // Verify B2B section
      assert.equal(res.payload.b2b.length, 1);
      const b2bEntry = res.payload.b2b[0];
      assert.equal(b2bEntry.ctin, '07AAAAA0000A1Z5');
      assert.equal(b2bEntry.inv.length, 1);
      assert.equal(b2bEntry.inv[0].inum, 'INV-2026-001');
      assert.equal(b2bEntry.inv[0].val, 118000);
      assert.equal(b2bEntry.inv[0].pos, '07');
      assert.equal(b2bEntry.inv[0].itms[0].itm_det.txval, 100000);
      assert.equal(b2bEntry.inv[0].itms[0].itm_det.iamt, 18000);

      // Verify B2CS section
      assert.equal(res.payload.b2cs.length, 1);
      const b2csEntry = res.payload.b2cs[0];
      assert.equal(b2csEntry.sply_ty, 'INTRA');
      assert.equal(b2csEntry.pos, '33');
      assert.equal(b2csEntry.txval, 5000);
      assert.equal(b2csEntry.camt, 450);
      assert.equal(b2csEntry.samt, 450);

      // Verify HSN section
      assert.equal(res.payload.hsn.data.length, 2);
      const hsnCodes = res.payload.hsn.data.map((h) => h.hsn_sc);
      assert.ok(hsnCodes.includes('8471'));
      assert.ok(hsnCodes.includes('8544'));

      // Verify DOCISS section
      const docDet = res.payload.doc_issue.doc_det[0].docs[0];
      assert.equal(docDet.totnum, 3); // 2 active + 1 cancelled
      assert.equal(docDet.canc, 1); // 1 cancelled
      assert.equal(docDet.net_issue, 2); // 2 active
    });

    // 2. Summary calculations
    await runCheck('2. Summary metrics accurately aggregate taxable values and tax splits', async () => {
      const res = await Gstr1Service.preparePayload(testWs1, testGstin, '102026');
      const sum = res.summary;

      assert.equal(sum.totalInvoices, 2); // Active invoices
      assert.equal(sum.cancelledInvoices, 1);
      assert.equal(sum.totalTaxable, 105000); // 100000 + 5000
      assert.equal(sum.totalIgst, 18000);
      assert.equal(sum.totalCgst, 450);
      assert.equal(sum.totalSgst, 450);
      assert.equal(sum.totalTax, 18900);
      assert.equal(sum.grandTotal, 123900); // 118000 + 5900
    });

    // 3. Tenancy isolation
    await runCheck('3. Workspace tenancy isolation strictly confines GSTR-1 to active workspace', async () => {
      const res1 = await Gstr1Service.preparePayload(testWs1, testGstin, '102026');
      const res2 = await Gstr1Service.preparePayload(testWs2, '29ABCDE1234F1Z5', '102026');

      // WS1 must never see WS2's 99999 invoice
      assert.equal(res1.summary.totalTaxable, 105000);
      assert.equal(res2.summary.totalTaxable, 99999);
      assert.equal(res2.payload.b2b[0].inv[0].inum, 'WS2-INV-001');
    });

    // 4. Dry-run safety guard
    await runCheck('4. savePayload strictly defaults to dryRun without calling write API', async () => {
      delete process.env.FEATURE_FILING; // Ensure disabled
      const result = await Gstr1Service.savePayload(testWs1, testGstin, '102026');

      assert.equal(result.success, true);
      assert.equal(result.dryRun, true);
      assert.ok(result.ref_id.startsWith('DRY-RUN-'));
      assert.ok(result.message.includes('dry-run'));

      // Check AuditLog
      const log = await AuditLog.findOne({ workspaceId: testWs1, action: 'GSTR1_SAVE_DRY_RUN' });
      assert.ok(log, 'Expected AuditLog entry for GSTR1_SAVE_DRY_RUN');
      assert.equal(log.status, 'SUCCESS');
    });

    console.log('\n🎉 ALL GSTR-1 BUILDER & DRY-RUN TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    // Cleanup test records
    await Invoice.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } }).catch(() => {});
    await AuditLog.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } }).catch(() => {});
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = main;
