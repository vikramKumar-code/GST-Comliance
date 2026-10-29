const assert = require('assert');
const mongoose = require('mongoose');
const einvoiceService = require('../src/services/einvoice.service');
const Invoice = require('../src/models/Invoice');
const Workspace = require('../src/models/Workspace');
const config = require('../src/config/env');

async function runTests() {
  console.log('--- Running E-Invoice & E-Way Bill Integration Tests ---');
  
  await mongoose.connect(config.MONGO_URI);
  
  // Clean up any test fixtures
  const testWorkspaceId = new mongoose.Types.ObjectId();
  const otherWorkspaceId = new mongoose.Types.ObjectId();

  await Workspace.create({
    _id: testWorkspaceId,
    name: 'Candid Systems Pvt Ltd',
    gstin: '34AACCC1596Q002',
    status: 'ACTIVE'
  });

  try {
    // 1. Date formatting & HSN sanitation
    assert.strictEqual(einvoiceService.formatNicDate(new Date('2026-10-28')), '28/10/2026');
    assert.strictEqual(einvoiceService.sanitizeHsn('1006'), '1006');
    assert.strictEqual(einvoiceService.sanitizeHsn('100610'), '100610');
    assert.strictEqual(einvoiceService.sanitizeHsn(''), '100610');
    console.log('  ✓ 1. Date formatting and HSN sanitation conform to NIC v1.1 standards');

    // 2. Create test invoice
    const invoice = await Invoice.create({
      workspaceId: testWorkspaceId,
      invoiceNumber: 'INV-TEST-EINV-01',
      invoiceDate: new Date('2026-10-28'),
      customerName: 'Acme Retailers Pvt Ltd',
      customerGstin: '29AWGPV7107B1Z1',
      placeOfSupply: '29',
      billingAddress: {
        street: 'MG Road',
        city: 'Bengaluru',
        pincode: '562160',
        state: 'Karnataka'
      },
      lineItems: [
        {
          name: 'Premium Basmati Rice',
          hsnSac: '100610',
          quantity: 20,
          rate: 150,
          discount: 100,
          taxableAmount: 2900,
          gstRate: 18,
          igstRate: 18,
          igstAmount: 522,
          totalTax: 522,
          totalAmount: 3422
        }
      ],
      subTotal: 2900,
      totalIgst: 522,
      totalTax: 522,
      grandTotal: 3422,
      status: 'Sent'
    });

    // 3. Payload builder
    const workspace = await Workspace.findById(testWorkspaceId).lean();
    const payload = einvoiceService.buildNicPayload(invoice, workspace);
    assert.strictEqual(payload.Version, '1.1');
    assert.strictEqual(payload.DocDtls.Typ, 'INV');
    assert.strictEqual(payload.DocDtls.No, 'INV-TEST-EINV-01');
    assert.strictEqual(payload.ValDtls.AssVal, 2900);
    assert.strictEqual(payload.ValDtls.IgstVal, 522);
    assert.strictEqual(payload.ValDtls.TotInvVal, 3422);
    assert.strictEqual(payload.ItemList.length, 1);
    console.log('  ✓ 2. buildNicPayload generates compliant NIC Schema v1.1 payload structure');

    // 4. Generate IRN (Mock or Live)
    // Save original USE_MOCK to test mock branch deterministically
    const origMock = config.USE_MOCK;
    config.USE_MOCK = true;

    const generated = await einvoiceService.generateIrn(invoice._id, testWorkspaceId);
    assert.strictEqual(generated.einvoiceStatus, 'Generated');
    assert.ok(generated.irn && generated.irn.length > 0);
    assert.ok(generated.ackNo && generated.ackNo.length > 0);
    assert.ok(generated.signedQrCode && generated.signedQrCode.length > 0);
    console.log('  ✓ 3. generateIrn generates IRN, AckNo, SignedQRCode and sets einvoiceStatus');

    // 5. Prevent duplicate IRN generation
    let duplicateRejected = false;
    try {
      await einvoiceService.generateIrn(invoice._id, testWorkspaceId);
    } catch (err) {
      duplicateRejected = true;
      assert.strictEqual(err.statusCode, 400);
    }
    assert.ok(duplicateRejected, 'Duplicate IRN generation must be rejected');
    console.log('  ✓ 4. generateIrn prevents duplicate generation for already active IRN');

    // 6. Generate E-Way Bill
    const ewbResult = await einvoiceService.generateEwayBill(invoice._id, testWorkspaceId, {
      vehicleNo: 'KA01AB1234',
      transporterId: '29AWGPV7107B1Z1',
      transporterName: 'FastLogistics'
    });
    assert.ok(ewbResult.ewayBillNo && ewbResult.ewayBillNo.length > 0);
    assert.strictEqual(ewbResult.vehicleNo, 'KA01AB1234');
    assert.strictEqual(ewbResult.transporterName, 'FastLogistics');
    console.log('  ✓ 5. generateEwayBill issues E-Way Bill linked to IRN and records vehicle');

    // 7. Cancel IRN
    const cancelled = await einvoiceService.cancelIrn(invoice._id, testWorkspaceId, {
      reasonCode: '1',
      remarks: 'Incorrect line items entered'
    });
    assert.strictEqual(cancelled.einvoiceStatus, 'Cancelled');
    assert.strictEqual(cancelled.cancelReason, '1');
    assert.strictEqual(cancelled.cancelRemarks, 'Incorrect line items entered');
    assert.ok(cancelled.cancelledAt);
    console.log('  ✓ 6. cancelIrn cancels active IRN and logs reason and timestamp');

    // 8. Tenancy Isolation
    let crossWorkspaceBlocked = false;
    try {
      await einvoiceService.cancelIrn(invoice._id, otherWorkspaceId, { reasonCode: '1', remarks: 'test' });
    } catch (err) {
      crossWorkspaceBlocked = true;
      assert.strictEqual(err.statusCode, 404);
    }
    assert.ok(crossWorkspaceBlocked, 'Cross-workspace invoice access must be blocked');
    console.log('  ✓ 7. Workspace tenancy isolation strictly protects IRN & EWB operations');

    config.USE_MOCK = origMock;
    console.log('\n🎉 ALL E-INVOICE & E-WAY BILL TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    // Cleanup
    await Invoice.deleteMany({ workspaceId: testWorkspaceId });
    await Workspace.findByIdAndDelete(testWorkspaceId);
    await mongoose.disconnect();
  }
}

runTests().catch(err => {
  console.error('❌ E-INVOICE TEST FAILED:', err);
  process.exit(1);
});
