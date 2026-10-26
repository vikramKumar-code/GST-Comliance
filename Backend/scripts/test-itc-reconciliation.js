/**
 * Unit & Integration Tests for ReconciliationService (ITC Reconciliation & Refund Engine)
 */
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const ReconciliationService = require('../src/services/reconciliation.service');
const Bill = require('../src/models/Bill');
const Invoice = require('../src/models/Invoice');
const FinaggService = require('../src/services/finagg.service');

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
  console.log('--- Running ITC Reconciliation & GST Refund Estimation Tests ---');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gst-compliance-test';
  await mongoose.connect(mongoUri);

  const testWs1 = new mongoose.Types.ObjectId();
  const testWs2 = new mongoose.Types.ObjectId();
  const testGstin = '33AANCS2882A1ZG';
  const testPeriod = '102026'; // October 2026

  try {
    // Clean up test collections
    await Bill.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await Invoice.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });

    // 1. Create Purchase Bills for Workspace 1
    // Bill 1: Exact Match in GSTR-2B
    await Bill.create({
      workspaceId: testWs1,
      billNumber: 'BILL/2026/001',
      vendorName: 'Acme Hardware Ltd',
      vendorGstin: '27AAACA1234A1Z1',
      billDate: new Date('2026-10-05T10:00:00Z'),
      category: 'Inventory',
      subTotal: 100000,
      totalCgst: 9000,
      totalSgst: 9000,
      totalIgst: 0,
      totalTax: 18000,
      grandTotal: 118000,
      status: 'Paid',
      lineItems: [
        {
          description: 'Cables & Hardware',
          quantity: 100,
          rate: 1000,
          taxableAmount: 100000,
          gstRate: 18,
          cgstAmount: 9000,
          sgstAmount: 9000,
          igstAmount: 0,
          totalTax: 18000,
          totalAmount: 118000
        }
      ]
    });

    // Bill 2: Matching within rounding tolerance (₹0.50 difference)
    await Bill.create({
      workspaceId: testWs1,
      billNumber: 'INV-8899',
      vendorName: 'Global Cloud Systems',
      vendorGstin: '29BBBCB5678B1Z2',
      billDate: new Date('2026-10-12T10:00:00Z'),
      category: 'Service',
      subTotal: 50000,
      totalCgst: 0,
      totalSgst: 0,
      totalIgst: 9000.5,
      totalTax: 9000.5,
      grandTotal: 59000.5,
      status: 'Pending',
      lineItems: [
        {
          description: 'Cloud Hosting Subscription',
          quantity: 1,
          rate: 50000,
          taxableAmount: 50000,
          gstRate: 18,
          igstAmount: 9000.5,
          totalTax: 9000.5,
          totalAmount: 59000.5
        }
      ]
    });

    // Bill 3: Mismatched Value (Tax difference ₹2000 > tolerance ₹1)
    await Bill.create({
      workspaceId: testWs1,
      billNumber: 'SUP-404',
      vendorName: 'Delta Logistics',
      vendorGstin: '36CCCCD9999C1Z3',
      billDate: new Date('2026-10-15T10:00:00Z'),
      category: 'Expense',
      subTotal: 25000,
      totalCgst: 2250,
      totalSgst: 2250,
      totalIgst: 0,
      totalTax: 4500,
      grandTotal: 29500,
      status: 'Pending',
      lineItems: [
        {
          description: 'Freight Charges',
          quantity: 1,
          rate: 25000,
          taxableAmount: 25000,
          gstRate: 18,
          cgstAmount: 2250,
          sgstAmount: 2250,
          totalTax: 4500,
          totalAmount: 29500
        }
      ]
    });

    // Bill 4: Missing in GSTR-2B (Vendor hasn't filed)
    await Bill.create({
      workspaceId: testWs1,
      billNumber: 'NO2B-100',
      vendorName: 'Late Filing Vendor',
      vendorGstin: '33EEEED1111E1Z4',
      billDate: new Date('2026-10-20T10:00:00Z'),
      category: 'Inventory',
      subTotal: 30000,
      totalCgst: 2700,
      totalSgst: 2700,
      totalIgst: 0,
      totalTax: 5400,
      grandTotal: 35400,
      status: 'Pending',
      lineItems: [
        {
          description: 'Raw Materials',
          quantity: 30,
          rate: 1000,
          taxableAmount: 30000,
          gstRate: 18,
          cgstAmount: 2700,
          sgstAmount: 2700,
          totalTax: 5400,
          totalAmount: 35400
        }
      ]
    });

    // Bill in Workspace 2 (Tenancy test: should NOT appear in Workspace 1)
    await Bill.create({
      workspaceId: testWs2,
      billNumber: 'WS2-SECRET-BILL',
      vendorName: 'Workspace 2 Secret Vendor',
      vendorGstin: '27AAACA1234A1Z1',
      billDate: new Date('2026-10-05T10:00:00Z'),
      subTotal: 999999,
      totalTax: 180000,
      grandTotal: 1179999,
      status: 'Paid',
      lineItems: [
        {
          description: 'Confidential Equipment',
          quantity: 1,
          rate: 999999,
          taxableAmount: 999999,
          gstRate: 18,
          totalTax: 180000,
          totalAmount: 1179999
        }
      ]
    });

    // Mock Provider Return for GSTR-2B with 2B Inward supplies:
    // - 27AAACA1234A1Z1 / BILL-2026-001 (Matches Bill 1, slight formatting difference in slash vs dash)
    // - 29BBBCB5678B1Z2 / INV8899 (Matches Bill 2 with ₹9000 vs ₹9000.50)
    // - 36CCCCD9999C1Z3 / SUP404 (Reported with ₹2500 tax instead of ₹4500 -> Mismatch)
    // - 07ZZZZZ0000Z1Z9 / EXTRA-2B-999 (In 2B but not in books -> Extra in 2B)
    const mock2bPayload = {
      status_cd: '1',
      data: {
        docdata: {
          b2b: [
            {
              ctin: '27AAACA1234A1Z1',
              inv: [
                {
                  inum: 'BILL-2026-001',
                  dt: '05-10-2026',
                  val: 118000,
                  itms: [
                    {
                      itm_det: {
                        txval: 100000,
                        camt: 9000,
                        samt: 9000,
                        iamt: 0
                      }
                    }
                  ]
                }
              ]
            },
            {
              ctin: '29BBBCB5678B1Z2',
              inv: [
                {
                  inum: 'INV8899',
                  dt: '12-10-2026',
                  val: 59000,
                  itms: [
                    {
                      itm_det: {
                        txval: 50000,
                        camt: 0,
                        samt: 0,
                        iamt: 9000
                      }
                    }
                  ]
                }
              ]
            },
            {
              ctin: '36CCCCD9999C1Z3',
              inv: [
                {
                  inum: 'SUP-404',
                  dt: '15-10-2026',
                  val: 27500,
                  itms: [
                    {
                      itm_det: {
                        txval: 25000,
                        camt: 1250,
                        samt: 1250,
                        iamt: 0
                      }
                    }
                  ]
                }
              ]
            },
            {
              ctin: '07ZZZZZ0000Z1Z9',
              inv: [
                {
                  inum: 'EXTRA-2B-999',
                  dt: '18-10-2026',
                  val: 11800,
                  itms: [
                    {
                      itm_det: {
                        txval: 10000,
                        camt: 0,
                        samt: 0,
                        iamt: 1800
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    };

    // Temporarily stub FinaggService.getReturn to return our controlled test payload
    const originalGetReturn = FinaggService.getReturn;
    FinaggService.getReturn = async (type) => {
      if (type.toUpperCase() === 'GSTR2B') return mock2bPayload;
      return {};
    };

    // TEST 1: Reconcile ITC for Workspace 1
    await runCheck('1. Reconcile ITC accurately categorizes MATCHED, MISMATCHED, MISSING_IN_2B, and EXTRA_IN_2B', async () => {
      const result = await ReconciliationService.reconcileItc(testWs1, testPeriod, {
        gstin: testGstin
      });

      assert.equal(result.summary.totalBooksBillsCount, 4);
      assert.equal(result.summary.matchedCount, 2, 'Bill 1 and Bill 2 should be MATCHED');
      assert.equal(result.summary.mismatchedCount, 1, 'Bill 3 should be MISMATCHED_VALUE');
      assert.equal(result.summary.missingIn2bCount, 1, 'Bill 4 should be MISSING_IN_2B');
      assert.equal(result.summary.extraIn2bCount, 1, 'EXTRA-2B-999 should be EXTRA_IN_2B');

      // Verify Eligible ITC sum: 9000 (Bill 1 CGST) + 9000 (Bill 1 SGST) + 9000 (Bill 2 IGST from 2B) = 27000
      assert.equal(result.summary.eligibleItc.total, 27000);
      assert.equal(result.summary.eligibleItc.cgst, 9000);
      assert.equal(result.summary.eligibleItc.sgst, 9000);
      assert.equal(result.summary.eligibleItc.igst, 9000);

      // Verify At-Risk ITC: Bill 3 (4500) + Bill 4 (5400) = 9900
      assert.equal(result.summary.atRiskItc.total, 9900);
    });

    // TEST 2: Tenancy Isolation
    await runCheck('2. Tenancy isolation strictly confines reconciliation to target workspaceId', async () => {
      const resultWs1 = await ReconciliationService.reconcileItc(testWs1, testPeriod, { gstin: testGstin });
      const containsWs2Secret = [
        ...resultWs1.matched,
        ...resultWs1.mismatched,
        ...resultWs1.missingIn2b
      ].some((b) => b.billNumber === 'WS2-SECRET-BILL');

      assert.equal(containsWs2Secret, false, 'Workspace 1 must never see Workspace 2 bills');

      const resultWs2 = await ReconciliationService.reconcileItc(testWs2, testPeriod, { gstin: testGstin });
      assert.equal(resultWs2.summary.totalBooksBillsCount, 1);
      assert.equal(resultWs2.missingIn2b[0].billNumber, 'WS2-SECRET-BILL');
    });

    // TEST 3: Refund & Liability Estimation
    await runCheck('3. Refund & Liability engine computes TAX_PAYABLE when sales output tax > eligible ITC', async () => {
      // Create Sales Invoice for Workspace 1 with output tax = 36000 (CGST 18000, SGST 18000)
      await Invoice.create({
        workspaceId: testWs1,
        invoiceNumber: 'INV-OUT-001',
        invoiceDate: new Date('2026-10-15T10:00:00Z'),
        customerName: 'Client Alpha',
        customerGstin: '27AAAAA1111A1Z1',
        placeOfSupply: '27-Maharashtra',
        status: 'Sent',
        subTotal: 200000,
        totalCgst: 18000,
        totalSgst: 18000,
        totalIgst: 0,
        totalTax: 36000,
        grandTotal: 236000,
        lineItems: [
          {
            name: 'Consulting',
            quantity: 1,
            rate: 200000,
            taxableAmount: 200000,
            gstRate: 18,
            cgstAmount: 18000,
            sgstAmount: 18000,
            totalTax: 36000,
            totalAmount: 236000
          }
        ]
      });

      const estimate = await ReconciliationService.calculateRefundEstimate(testWs1, testPeriod, {
        gstin: testGstin
      });

      // Output Tax = 36000, Eligible ITC = 27000 => Net Tax Payable = 9000
      assert.equal(estimate.outputLiability.total, 36000);
      assert.equal(estimate.inputTaxCredit.total, 27000);
      assert.equal(estimate.netPosition.status, 'TAX_PAYABLE');
      assert.equal(estimate.netPosition.estimatedTaxPayable, 9000);
      assert.equal(estimate.netPosition.estimatedRefundAmount, 0);
    });

    // TEST 4: Surplus ITC / Refund Position
    await runCheck('4. Refund & Liability engine computes REFUND_OR_CARRY_FORWARD when eligible ITC > sales tax', async () => {
      // Delete previous sales invoice and add smaller zero-rated / small tax invoice
      await Invoice.deleteMany({ workspaceId: testWs1 });

      await Invoice.create({
        workspaceId: testWs1,
        invoiceNumber: 'INV-EXPORT-001',
        invoiceDate: new Date('2026-10-18T10:00:00Z'),
        customerName: 'Overseas Client Inc',
        customerGstin: '',
        placeOfSupply: '96-Other Countries',
        status: 'Paid',
        subTotal: 500000,
        totalCgst: 0,
        totalSgst: 0,
        totalIgst: 0,
        totalTax: 0, // Zero rated export
        grandTotal: 500000,
        lineItems: [
          {
            name: 'Export Software Services',
            quantity: 1,
            rate: 500000,
            taxableAmount: 500000,
            gstRate: 0,
            totalTax: 0,
            totalAmount: 500000
          }
        ]
      });

      const estimate = await ReconciliationService.calculateRefundEstimate(testWs1, testPeriod, {
        gstin: testGstin
      });

      // Output Tax = 0, Eligible ITC = 27000 => Net Position = -27000 (Refund Eligible)
      assert.equal(estimate.outputLiability.total, 0);
      assert.equal(estimate.inputTaxCredit.total, 27000);
      assert.equal(estimate.netPosition.status, 'REFUND_OR_CARRY_FORWARD');
      assert.equal(estimate.netPosition.estimatedRefundAmount, 27000);
      assert.equal(estimate.netPosition.estimatedTaxPayable, 0);
    });

    // Restore stub
    FinaggService.getReturn = originalGetReturn;

    console.log('\n🎉 ALL ITC RECONCILIATION & REFUND TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    await Bill.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await Invoice.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
