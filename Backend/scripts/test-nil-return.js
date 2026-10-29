/**
 * Unit & Integration Tests for Nil Return Filing (CGST Rule 67A)
 */
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const NilReturnService = require('../src/services/nilReturn.service');
const Invoice = require('../src/models/Invoice');
const Bill = require('../src/models/Bill');
const Filing = require('../src/models/Filing');
const Return = require('../src/models/Return');
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
  console.log('--- Running Nil Return Filing (CGST Rule 67A) Tests ---');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gst-compliance-test';
  await mongoose.connect(mongoUri);

  const testWs1 = new mongoose.Types.ObjectId();
  const testWs2 = new mongoose.Types.ObjectId();
  const testGstin1 = '33AANCS2882A1ZG';
  const testGstin2 = '29ABCDE1234F1Z5';
  const period = '102026';

  try {
    // Clean up test data
    await Invoice.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await Bill.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await Filing.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await Return.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await AuditLog.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });

    // Test 1: Check eligibility with zero invoices (100% eligible)
    await runCheck('1. Zero transactions in period is 100% eligible for Nil Return', async () => {
      const eligibility = await NilReturnService.checkEligibility(testWs1, testGstin1, period, 'GSTR1');
      assert.equal(eligibility.alreadyFiled, false);
      assert.equal(eligibility.eligible, true);
      assert.equal(eligibility.hasBusinessActivity, false);
      assert.equal(eligibility.activeInvoicesCount, 0);
      assert.equal(eligibility.warnings.length, 0);
    });

    // Test 2: Check eligibility when active sales invoice exists
    await runCheck('2. Active sales invoice detects business activity and issues warning', async () => {
      await Invoice.create({
        workspaceId: testWs1,
        invoiceNumber: 'INV-NIL-01',
        invoiceDate: new Date('2026-10-15T10:00:00Z'),
        customerName: 'Test Buyer',
        customerGstin: '33AABCT1234A1Z1',
        placeOfSupply: '33-Tamil Nadu',
        status: 'Sent',
        subTotal: 50000,
        grandTotal: 59000,
        lineItems: [{ name: 'Service', taxableAmount: 50000, gstRate: 18, cgstAmount: 4500, sgstAmount: 4500 }]
      });

      const eligibility = await NilReturnService.checkEligibility(testWs1, testGstin1, period, 'GSTR1');
      assert.equal(eligibility.hasBusinessActivity, true);
      assert.equal(eligibility.activeInvoicesCount, 1);
      assert.ok(eligibility.warnings.length > 0);
    });

    // Test 3: Rejects filing if declaration is not accepted
    await runCheck('3. Mandatory statutory declaration under Rule 67A is strictly enforced', async () => {
      await assert.rejects(
        async () => {
          await NilReturnService.fileNilReturn(testWs1, testGstin1, period, 'GSTR1', {
            declarationAccepted: false
          });
        },
        (err) => {
          assert.equal(err.code, 'VALIDATION_ERROR');
          assert.ok(err.message.includes('declaration per CGST Rule 67A'));
          return true;
        }
      );
    });

    // Test 4: File Nil GSTR-1 successfully
    await runCheck('4. Successfully files Nil GSTR-1 and generates valid ARN', async () => {
      const result = await NilReturnService.fileNilReturn(testWs1, testGstin1, period, 'GSTR1', {
        declarationAccepted: true,
        verificationMode: '1_CLICK'
      });

      assert.equal(result.success, true);
      assert.equal(result.isNil, true);
      assert.equal(result.type, 'GSTR1');
      assert.equal(result.period, period);
      assert.ok(result.arn.startsWith('AA33'));
      assert.ok(result.arn.endsWith('N'));

      // Check Filing record
      const filing = await Filing.findOne({ workspaceId: testWs1, type: 'GSTR1', period });
      assert.ok(filing);
      assert.equal(filing.arn, result.arn);
      assert.equal(filing.status, 'Filed');
      assert.equal(filing.isNil, true);

      // Check Return cache
      const cachedReturn = await Return.findOne({ workspaceId: testWs1, type: 'GSTR1', period });
      assert.ok(cachedReturn);

      // Check Audit Log
      const audit = await AuditLog.findOne({ workspaceId: testWs1, action: 'GSTR1_NIL_FILED' });
      assert.ok(audit);
      assert.equal(audit.status, 'SUCCESS');
    });

    // Test 5: Rejects duplicate filing for same period
    await runCheck('5. Prohibits duplicate filing for already filed return period', async () => {
      await assert.rejects(
        async () => {
          await NilReturnService.fileNilReturn(testWs1, testGstin1, period, 'GSTR1', {
            declarationAccepted: true
          });
        },
        (err) => {
          assert.equal(err.code, 'VALIDATION_ERROR');
          assert.ok(err.message.includes('already been filed'));
          return true;
        }
      );
    });

    // Test 6: File Nil GSTR-3B successfully
    await runCheck('6. Successfully files Nil GSTR-3B under Rule 67A', async () => {
      const result = await NilReturnService.fileNilReturn(testWs1, testGstin1, period, 'GSTR3B', {
        declarationAccepted: true,
        verificationMode: 'EVC'
      });

      assert.equal(result.success, true);
      assert.equal(result.isNil, true);
      assert.equal(result.type, 'GSTR3B');
      assert.equal(result.mode, 'NIL_EVC');
      assert.ok(result.arn.startsWith('AA33'));
    });

    // Test 7: Tenancy isolation strictly confines filings
    await runCheck('7. Workspace tenancy isolation strictly isolates filings between accounts', async () => {
      const ws1Filings = await Filing.find({ workspaceId: testWs1 });
      const ws2Filings = await Filing.find({ workspaceId: testWs2 });
      assert.equal(ws1Filings.length, 2); // GSTR1 + GSTR3B
      assert.equal(ws2Filings.length, 0); // WS2 has 0 filings
    });

    console.log('\n🎉 ALL NIL RETURN (RULE 67A) TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    // Cleanup
    await Invoice.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await Bill.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await Filing.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await Return.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await AuditLog.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
