/**
 * Unit & Integration Tests for ReportService (GSTR-1 vs 3B Comparison, Sales & Purchase Registers)
 */
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const ReportService = require('../src/services/report.service');
const Invoice = require('../src/models/Invoice');
const Bill = require('../src/models/Bill');
const ReturnService = require('../src/services/return.service');

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
  console.log('--- Running Financial & Tax Reports Tests ---');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gst-compliance-test';
  await mongoose.connect(mongoUri);

  const testWs1 = new mongoose.Types.ObjectId();
  const testWs2 = new mongoose.Types.ObjectId();
  const testGstin = '33AANCS2882A1ZG';
  const testPeriod = '102026';

  try {
    // Clean up
    await Invoice.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await Bill.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });

    // Seed Workspace 1 Sales Invoices
    await Invoice.create([
      {
        workspaceId: testWs1,
        invoiceNumber: 'INV-REP-001',
        invoiceDate: new Date('2026-10-05T10:00:00Z'),
        customerName: 'Customer One',
        customerGstin: '27AAAAA1111A1Z1',
        placeOfSupply: '27-Maharashtra',
        status: 'Sent',
        subTotal: 100000,
        totalCgst: 9000,
        totalSgst: 9000,
        totalIgst: 0,
        totalTax: 18000,
        grandTotal: 118000,
        lineItems: [
          {
            name: 'Consulting',
            quantity: 1,
            rate: 100000,
            taxableAmount: 100000,
            gstRate: 18,
            cgstAmount: 9000,
            sgstAmount: 9000,
            totalTax: 18000,
            totalAmount: 118000
          }
        ]
      },
      {
        workspaceId: testWs1,
        invoiceNumber: 'INV-REP-002',
        invoiceDate: new Date('2026-10-15T10:00:00Z'),
        customerName: 'Customer Two',
        customerGstin: '29BBBBB2222B1Z2',
        placeOfSupply: '29-Karnataka',
        status: 'Paid',
        subTotal: 200000,
        totalCgst: 0,
        totalSgst: 0,
        totalIgst: 36000,
        totalTax: 36000,
        grandTotal: 236000,
        lineItems: [
          {
            name: 'Hosting',
            quantity: 1,
            rate: 200000,
            taxableAmount: 200000,
            gstRate: 18,
            igstAmount: 36000,
            totalTax: 36000,
            totalAmount: 236000
          }
        ]
      },
      // Cancelled Invoice (must be excluded from register)
      {
        workspaceId: testWs1,
        invoiceNumber: 'INV-CANCELLED',
        invoiceDate: new Date('2026-10-12T10:00:00Z'),
        customerName: 'Cancelled Client',
        placeOfSupply: '27-Maharashtra',
        status: 'Cancelled',
        subTotal: 50000,
        totalTax: 9000,
        grandTotal: 59000,
        lineItems: [
          {
            name: 'Cancelled',
            quantity: 1,
            rate: 50000,
            taxableAmount: 50000,
            gstRate: 18,
            totalAmount: 59000
          }
        ]
      }
    ]);

    // Seed Workspace 2 Sales Invoice (Tenancy test)
    await Invoice.create({
      workspaceId: testWs2,
      invoiceNumber: 'WS2-SECRET-INV',
      invoiceDate: new Date('2026-10-10T10:00:00Z'),
      customerName: 'Secret Customer',
      placeOfSupply: '27-Maharashtra',
      status: 'Paid',
      subTotal: 888888,
      totalTax: 160000,
      grandTotal: 1048888,
      lineItems: [
        {
          name: 'Classified',
          quantity: 1,
          rate: 888888,
          taxableAmount: 888888,
          gstRate: 18,
          totalAmount: 1048888
        }
      ]
    });

    // Seed Workspace 1 Purchase Bills
    await Bill.create([
      {
        workspaceId: testWs1,
        billNumber: 'BILL-REP-001',
        vendorName: 'Supplier One',
        vendorGstin: '33CCCCD3333C1Z3',
        billDate: new Date('2026-10-08T10:00:00Z'),
        category: 'Inventory',
        status: 'Paid',
        subTotal: 80000,
        totalCgst: 7200,
        totalSgst: 7200,
        totalIgst: 0,
        totalTax: 14400,
        grandTotal: 94400,
        lineItems: [
          {
            description: 'Components',
            quantity: 1,
            rate: 80000,
            taxableAmount: 80000,
            gstRate: 18,
            cgstAmount: 7200,
            sgstAmount: 7200,
            totalTax: 14400,
            totalAmount: 94400
          }
        ]
      }
    ]);

    // TEST 1: Sales Register calculation & tenancy
    await runCheck('1. Sales Register aggregates valid invoices and strictly isolates workspace', async () => {
      const reg = await ReportService.getSalesRegister(testWs1, '2026-10-01', '2026-10-31');

      assert.equal(reg.summary.totalInvoices, 2, 'Should include 2 active invoices and exclude cancelled invoice');
      assert.equal(reg.summary.totalTaxable, 300000);
      assert.equal(reg.summary.totalCgst, 9000);
      assert.equal(reg.summary.totalSgst, 9000);
      assert.equal(reg.summary.totalIgst, 36000);
      assert.equal(reg.summary.totalTax, 54000);
      assert.equal(reg.summary.grandTotal, 354000);

      const hasWs2 = reg.rows.some((r) => r.invoiceNumber === 'WS2-SECRET-INV');
      assert.equal(hasWs2, false, 'Must not leak Workspace 2 invoices');
    });

    // TEST 2: Purchase Register calculation
    await runCheck('2. Purchase Register aggregates bills within date range', async () => {
      const reg = await ReportService.getPurchaseRegister(testWs1, '2026-10-01', '2026-10-31');

      assert.equal(reg.summary.totalBills, 1);
      assert.equal(reg.summary.totalTaxable, 80000);
      assert.equal(reg.summary.totalTax, 14400);
      assert.equal(reg.rows[0].vendorName, 'Supplier One');
    });

    // TEST 3: GSTR-1 vs GSTR-3B Tax Liability Comparison (Matched & Discrepancy)
    await runCheck('3. GSTR-1 vs GSTR-3B comparison calculates liability difference and compliance risk', async () => {
      const originalGetReturn = ReturnService.getReturn;

      // Case A: Exact Match
      ReturnService.getReturn = async (type) => {
        if (type === 'GSTR1') {
          return {
            type: 'GSTR1',
            period: testPeriod,
            totals: { taxable: 300000, cgst: 9000, sgst: 9000, igst: 36000, cess: 0 }
          };
        }
        if (type === 'GSTR3B') {
          return {
            type: 'GSTR3B',
            period: testPeriod,
            totals: { taxable: 300000, cgst: 9000, sgst: 9000, igst: 36000, cess: 0 }
          };
        }
        return {};
      };

      const matchedReport = await ReportService.getGstrComparison(testWs1, testPeriod, {
        gstin: testGstin
      });

      assert.equal(matchedReport.status, 'MATCHED');
      assert.equal(matchedReport.complianceRisk, 'LOW');
      assert.equal(matchedReport.difference.totalTax, 0);

      // Case B: Discrepancy (GSTR-1 liability 54000 > GSTR-3B liability 36000)
      ReturnService.getReturn = async (type) => {
        if (type === 'GSTR1') {
          return {
            type: 'GSTR1',
            period: testPeriod,
            totals: { taxable: 300000, cgst: 9000, sgst: 9000, igst: 36000, cess: 0 }
          };
        }
        if (type === 'GSTR3B') {
          return {
            type: 'GSTR3B',
            period: testPeriod,
            totals: { taxable: 200000, cgst: 0, sgst: 0, igst: 36000, cess: 0 }
          };
        }
        return {};
      };

      const discrepancyReport = await ReportService.getGstrComparison(testWs1, testPeriod, {
        gstin: testGstin
      });

      assert.equal(discrepancyReport.status, 'DISCREPANCY');
      assert.equal(discrepancyReport.complianceRisk, 'HIGH');
      assert.equal(discrepancyReport.difference.totalTax, 18000);
      assert.ok(discrepancyReport.explanation.includes('DRC-01B'));

      // Restore
      ReturnService.getReturn = originalGetReturn;
    });

    console.log('\n🎉 ALL FINANCIAL & TAX REPORTS TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    await Invoice.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await Bill.deleteMany({ workspaceId: { $in: [testWs1, testWs2] } });
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
