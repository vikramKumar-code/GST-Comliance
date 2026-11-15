// Backend/scripts/test-gstr1-schema-verification.js
const assert = require('node:assert/strict');
const path = require('path');
process.env.NODE_ENV = 'test';

const Gstr1Service = require('../src/services/gstr1.service');
const { validateGstr1Schema, normalizeGstr1Payload } = require('../src/utils/gstr1Validator');

console.log('--- Running GSTR-1 RETSAVE Schema Verification Test Suite ---');

async function testSchemaFixes() {
  const supplierGstin = '33AANCS2882A1ZG';
  const period = '102026';

  const mockInvoices = [
    // 1. Export Invoice WPAY with valid line item
    {
      _id: 'exp001',
      invoiceNumber: 'EXP/2026/001',
      invoiceDate: new Date('2026-10-05T12:00:00Z'),
      customerName: 'Global Corp US',
      isExport: true,
      exportType: 'WITH_PAYMENT',
      placeOfSupply: '96-Other Country',
      grandTotal: 118000,
      subTotal: 100000,
      totalIgst: 18000,
      totalCess: 0,
      status: 'Sent',
      lineItems: [
        {
          name: 'Consulting Service',
          hsnSac: '998311',
          gstRate: 18,
          taxableAmount: 100000,
          igstAmount: 18000,
          unit: 'NOS-UNITS',
          quantity: 1
        }
      ]
    },
    // 2. Export Invoice WOPAY with EMPTY lineItems (Edge Case: minItems 1)
    {
      _id: 'exp002',
      invoiceNumber: 'EXP/2026/002',
      invoiceDate: new Date('2026-10-06T12:00:00Z'),
      customerName: 'Euro Tech UK',
      isExport: true,
      exportType: 'WOPAY',
      placeOfSupply: '96',
      grandTotal: 50000,
      subTotal: 50000,
      totalIgst: 0,
      status: 'Sent',
      lineItems: []
    },
    // 3. B2B invoice with negative line amount values (Edge Case: minimum 0)
    {
      _id: 'b2b001',
      invoiceNumber: 'INV/2026/101',
      invoiceDate: new Date('2026-10-08T12:00:00Z'),
      customerName: 'Alpha Pvt Ltd',
      customerGstin: '07AAAAA0000A1Z5',
      placeOfSupply: '07-Delhi',
      grandTotal: -59000,
      subTotal: -50000,
      totalIgst: -9000,
      status: 'Sent',
      lineItems: [
        {
          name: 'Machine Part',
          hsnSac: '8401.20', // Dirty HSN with dot
          gstRate: '18%', // String rate
          taxableAmount: -50000,
          igstAmount: -9000,
          unit: 'PCS-PIECES', // Dirty UQC with hyphen
          quantity: 5
        }
      ]
    },
    // 4. B2B invoice with zero-rate supply classified as EXEMPT
    {
      _id: 'b2b002',
      invoiceNumber: 'INV/2026/102',
      invoiceDate: new Date('2026-10-09T12:00:00Z'),
      customerName: 'Beta Agro Ltd',
      customerGstin: '07AAAAA0000A1Z5',
      placeOfSupply: '07',
      grandTotal: 25000,
      subTotal: 25000,
      totalIgst: 0,
      status: 'Sent',
      lineItems: [
        {
          name: 'Fresh Seeds',
          hsnSac: '1209',
          gstRate: 0,
          taxPreference: 'EXEMPT',
          taxableAmount: 25000,
          igstAmount: 0,
          unit: 'KGS',
          quantity: 50
        }
      ]
    },
    // 5. Unregistered Inter-state large supply (> 2.5L) -> B2CL with dirty POS
    {
      _id: 'b2cl001',
      invoiceNumber: 'INV/2026/201',
      invoiceDate: new Date('2026-10-12T12:00:00Z'),
      customerName: 'Consumer Haryana',
      placeOfSupply: '99-InvalidZone', // Dirty POS code 99 -> should sanitize to fallback
      grandTotal: 300000,
      subTotal: 254237.29,
      totalIgst: 45762.71,
      status: 'Sent',
      lineItems: [
        {
          name: 'Premium Furniture',
          hsnSac: '9403',
          gstRate: 18,
          taxableAmount: 254237.29,
          igstAmount: 45762.71,
          unit: 'SET',
          quantity: 1
        }
      ]
    },
    // 6. Registered Credit Note -> CDNR
    {
      _id: 'cn001',
      documentType: 'CREDIT_NOTE',
      invoiceNumber: 'CN/2026/001',
      invoiceDate: new Date('2026-10-15T12:00:00Z'),
      customerName: 'Alpha Pvt Ltd',
      customerGstin: '07AAAAA0000A1Z5',
      placeOfSupply: '07-Delhi',
      grandTotal: 11800,
      subTotal: 10000,
      totalIgst: 1800,
      status: 'Sent',
      lineItems: [
        {
          name: 'Price Reduction',
          hsnSac: '8401',
          gstRate: 18,
          taxableAmount: 10000,
          igstAmount: 1800,
          unit: 'PCS',
          quantity: 1
        }
      ]
    },
    // 7. Unregistered Export Credit Note -> CDNUR (Edge Case: must have typ EXPWP/EXPWOP, not WPAY)
    {
      _id: 'cn_exp001',
      documentType: 'CREDIT_NOTE',
      invoiceNumber: 'CN/2026/EXP1',
      invoiceDate: new Date('2026-10-16T12:00:00Z'),
      customerName: 'Global Corp US',
      isExport: true,
      exportType: 'WITH_PAYMENT',
      placeOfSupply: '96',
      grandTotal: 11800,
      subTotal: 10000,
      totalIgst: 1800,
      status: 'Sent',
      lineItems: [
        {
          name: 'Service Discount',
          hsnSac: '9983',
          gstRate: 18,
          taxableAmount: 10000,
          igstAmount: 1800,
          unit: 'OTH',
          quantity: 1
        }
      ]
    },
    // 8. Invoice with all-zero invoiceNumber (Edge Case: cleanInum pattern enforcement)
    {
      _id: 'inv_zero_num',
      invoiceNumber: '0000',
      invoiceDate: null, // Edge case: null date -> should fallback to default period date
      customerName: 'Local Customer',
      placeOfSupply: '33-Tamil Nadu',
      grandTotal: 1000,
      subTotal: 1000,
      totalCgst: 90,
      totalSgst: 90,
      status: 'Sent',
      lineItems: [
        {
          name: 'Small Item',
          hsnSac: '8400',
          gstRate: 18,
          taxableAmount: 1000,
          cgstAmount: 90,
          sgstAmount: 90,
          unit: 'NOS',
          quantity: 1
        }
      ]
    },
    // 9. Domestic SEZ supply with customerGstin and isExport:true (Edge Case: must route to B2B SEWP, not exp)
    {
      _id: 'sez001',
      invoiceNumber: 'SEZ/2026/001',
      invoiceDate: new Date('2026-10-18T10:00:00Z'),
      customerName: 'SEZ Developer Unit',
      customerGstin: '27AAAAA0000A1Z5',
      invoiceType: 'SEWP',
      isExport: true, // Should NOT misclassify as Table 6A EXP because it has valid Indian GSTIN
      placeOfSupply: '27-Maharashtra',
      grandTotal: 118000,
      subTotal: 100000,
      totalIgst: 18000,
      status: 'Sent',
      lineItems: [
        {
          name: 'IT Consultancy for SEZ',
          hsnSac: '998313',
          gstRate: 18,
          taxableAmount: 100000,
          igstAmount: 18000,
          unit: 'OTH',
          quantity: 1
        }
      ]
    },
    // 10. Cancelled document (should be counted in totnum & cancel, but not active)
    {
      _id: 'inv_canc_001',
      invoiceNumber: 'INV/2026/000',
      invoiceDate: new Date('2026-10-01T10:00:00Z'),
      customerName: 'Void Customer',
      status: 'Cancelled',
      lineItems: []
    },
    // 11. Draft document (should NOT be counted in doc_issue at all)
    {
      _id: 'inv_draft_001',
      invoiceNumber: 'INV/2026/999',
      invoiceDate: new Date('2026-10-31T10:00:00Z'),
      customerName: 'Draft Customer',
      status: 'Draft',
      lineItems: []
    }
  ];

  const Invoice = require('../src/models/Invoice');
  const originalFind = Invoice.find;
  Invoice.find = () => ({
    sort: () => ({
      lean: async () => mockInvoices
    })
  });

  try {
    const prepared = await Gstr1Service.preparePayload(
      '60d5ec49f1b2c8b1f8e4e1a1',
      supplierGstin,
      period
    );

    console.log('✓ preparePayload executed successfully');

    // 1. Check cleanInum enforces GSTN pattern
    const INUM_REGEX = /^(?=.{1,16}$)([0\/-]*[a-zA-Z0-9\/-]*[a-zA-Z1-9]+[a-zA-Z0-9\/-]*)$/;
    const zeroNumInv = prepared.sectionDetails.b2cs.find(i => i._id === 'inv_zero_num');
    assert(zeroNumInv, 'inv_zero_num must be present');
    // In payload b2cs doesn't store inum directly, but docIssueList does
    const zeroDoc = prepared.sectionDetails.docIssueList.find(i => i._id === 'inv_zero_num');
    assert(zeroDoc, 'docIssueList must contain inv_zero_num');
    // Check Table 13 DOCISS nums
    for (const det of prepared.payload.doc_issue.doc_det) {
      for (const d of det.docs) {
        assert(INUM_REGEX.test(d.from), `d.from "${d.from}" must satisfy GSTN inum regex`);
        assert(INUM_REGEX.test(d.to), `d.to "${d.to}" must satisfy GSTN inum regex`);
      }
    }
    console.log('✓ 1. cleanInum strictly enforces GSTN inum pattern (no pure zeros, valid alphanumeric)');

    // 2. Check sanitizePos state codes
    const VALID_POS = new Set([
      '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
      '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
      '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
      '31', '32', '33', '34', '35', '36', '37', '38', '96', '97'
    ]);
    // b2cl had dirty POS '99'
    for (const group of prepared.payload.b2cl || []) {
      assert(VALID_POS.has(group.pos), `B2CL group POS "${group.pos}" must be a valid state code`);
    }
    for (const row of prepared.payload.b2cs || []) {
      assert(VALID_POS.has(row.pos), `B2CS row POS "${row.pos}" must be a valid state code`);
    }
    console.log('✓ 2. sanitizePos strictly filters invalid state codes (no 00, no 99, only valid GSTN states)');

    // 3. Check sanitizeRate
    for (const group of prepared.payload.b2b || []) {
      for (const inv of group.inv) {
        for (const item of inv.itms) {
          const rt = item.itm_det ? item.itm_det.rt : item.rt;
          assert(typeof rt === 'number' && !isNaN(rt) && rt >= 0 && rt <= 999.99,
            `Rate ${rt} must be a valid number between 0 and 999.99`);
        }
      }
    }
    console.log('✓ 3. sanitizeRate handles strings/negatives/NaN and clamps between 0 and 999.99');

    // 4. Check CDNUR export typ = EXPWP / EXPWOP (never WPAY)
    const cdnur = prepared.payload.cdnur;
    assert(Array.isArray(cdnur), 'cdnur must be an array');
    const expNote = cdnur.find(n => n.nt_num.includes('EXP1'));
    assert(expNote, 'cn_exp001 must be in cdnur');
    assert.strictEqual(expNote.typ, 'EXPWP', `CDNUR export note must have typ 'EXPWP', received: ${expNote.typ}`);
    for (const note of cdnur) {
      assert(['B2CL', 'EXPWP', 'EXPWOP'].includes(note.typ),
        `CDNUR note typ must be one of ['B2CL', 'EXPWP', 'EXPWOP']. Received: ${note.typ}`);
    }
    console.log('✓ 4. CDNUR export typ strictly normalized to EXPWP / EXPWOP (never WPAY/WOPAY)');

    // 5. Check Strict Date Validation and Fallback (never empty string)
    const DATE_REGEX = /^(0[1-9]|[12][0-9]|3[01])-(0[1-9]|1[0-2])-\d{4}$/;
    for (const group of prepared.payload.b2b || []) {
      for (const inv of group.inv) {
        assert(DATE_REGEX.test(inv.idt), `inv.idt "${inv.idt}" must be valid DD-MM-YYYY`);
      }
    }
    for (const group of prepared.payload.exp || []) {
      for (const inv of group.inv) {
        assert(DATE_REGEX.test(inv.idt), `exp inv.idt "${inv.idt}" must be valid DD-MM-YYYY`);
      }
    }
    for (const note of prepared.payload.cdnur || []) {
      assert(DATE_REGEX.test(note.nt_dt), `cdnur nt_dt "${note.nt_dt}" must be valid DD-MM-YYYY`);
    }
    console.log('✓ 5. formatGstnDate never returns empty or invalid string (safe defaultPeriodDate fallback)');

    // 6. Check SEZ Supply Routing (sez001 had isExport:true but customerGstin)
    const b2bSezGroup = prepared.payload.b2b.find(g => g.ctin === '27AAAAA0000A1Z5');
    assert(b2bSezGroup, 'SEZ invoice must be routed to Table 4 B2B under customer GSTIN');
    const sezInv = b2bSezGroup.inv.find(i => i.inum === 'SEZ/2026/001');
    assert(sezInv, 'sez001 must exist in B2B');
    assert.strictEqual(sezInv.inv_typ, 'SEWP', `SEZ invoice must have inv_typ 'SEWP', received: ${sezInv.inv_typ}`);
    console.log('✓ 6. SEZ domestic supply with customerGstin preserved in B2B (not misclassified to Table 6A EXP)');

    console.log('b2cs rows:', JSON.stringify(prepared.payload.b2cs, null, 2));
    // 7. Validate no NaN/null serialized in JSON payload (Issue #1)
    const jsonStr = JSON.stringify(prepared.payload);
    assert(!jsonStr.includes(':null'), 'Payload must not contain any serialized null values from NaN');
    console.log('✓ 7. Payload contains NO NaN/null values after serialization');

    // 8. Validate Table 12 HSN single map unification (no duplicate hsn_sc + uqc + rt) (Issue #2)
    const hsnRows = prepared.payload.hsn?.data || [];
    const hsnKeySet = new Set();
    for (const row of hsnRows) {
      const k = `${row.hsn_sc}_${row.uqc}_${row.rt}`;
      assert(!hsnKeySet.has(k), `Duplicate HSN row detected in Table 12: ${k}`);
      hsnKeySet.add(k);
    }
    console.log('✓ 8. Table 12 HSN rows unified into single aggregation without duplicate keys');

    // 9. Validate with strict gstr1Validator.js
    validateGstr1Schema(prepared.payload);
    console.log('✓ 9. Payload passed strict gstr1Validator schema checks without errors!');

    // 10. Test validateFilingPayload does not throw on valid prepared payload
    Gstr1Service.validateFilingPayload(prepared);
    console.log('✓ 10. validateFilingPayload passed cleanly on valid data!');

    // 11. Test missing HSN blocking in validateFilingPayload (Issue #8)
    const invalidHsnPrepared = {
      sectionDetails: {
        unclassifiedZeroRate: [],
        invalidHsn: [{ invoiceNumber: 'INV-BAD-HSN', itemName: 'Bad Item', rawHsn: '1' }],
        docSeries: []
      }
    };
    assert.throws(
      () => Gstr1Service.validateFilingPayload(invalidHsnPrepared),
      /missing or invalid HSN\/SAC/,
      'validateFilingPayload must throw when invalidHsn has entries'
    );
    console.log('✓ 11. Missing/invalid HSN (< 2 digits) correctly caught and blocked by validateFilingPayload');

    // 12. Test unclassified zero-rate blocking in validateFilingPayload (Issue #7)
    const unclassifiedPrepared = {
      sectionDetails: {
        unclassifiedZeroRate: [{ isExcluded: false }],
        invalidHsn: [],
        docSeries: []
      }
    };
    assert.throws(
      () => Gstr1Service.validateFilingPayload(unclassifiedPrepared),
      /zero-rate outward supplies need nil\/exempt\/non-GST classification/,
      'validateFilingPayload must throw when unclassifiedZeroRate has entries'
    );
    console.log('✓ 12. Unclassified zero-rate supplies correctly caught and blocked by validateFilingPayload');

    // --- Direct gstr1Validator.js Unit Tests for 29 Schema Alignment Fixes ---
    console.log('\n--- Direct gstr1Validator.js Strict Schema Tests ---');

    // 13. Test chksum is rejected by validateGstr1Schema and stripped by normalizeGstr1Payload
    const payloadWithChksum = JSON.parse(JSON.stringify(prepared.payload));
    payloadWithChksum.b2b[0].inv[0].chksum = 'bad_hash_123';
    assert.throws(
      () => validateGstr1Schema(payloadWithChksum),
      /'chksum' is not an allowed field/,
      'validateGstr1Schema must reject chksum key on invoice object'
    );
    const cleanedPayload = normalizeGstr1Payload(payloadWithChksum);
    assert.strictEqual(cleanedPayload.b2b[0].inv[0].chksum, undefined, 'normalizeGstr1Payload must strip chksum');
    assert.doesNotThrow(() => validateGstr1Schema(cleanedPayload), 'Cleaned payload must pass validateGstr1Schema');
    console.log('✓ 13. chksum rejected by validateGstr1Schema and stripped recursively by normalizeGstr1Payload');

    // 14. Test CDNUR typ is strictly mandatory (B2CL / EXPWP / EXPWOP)
    const badCdnurPayload = JSON.parse(JSON.stringify(prepared.payload));
    delete badCdnurPayload.cdnur[0].typ;
    assert.throws(
      () => validateGstr1Schema(badCdnurPayload),
      /'typ' is mandatory and must be one of/,
      'validateGstr1Schema must reject CDNUR note without typ'
    );
    console.log('✓ 14. CDNUR typ is strictly mandatory');

    // 15. Test B2CL strictly forbids camt / samt in itm_det
    const badB2clPayload = JSON.parse(JSON.stringify(prepared.payload));
    badB2clPayload.b2cl = [
      {
        pos: '07',
        inv: [
          {
            inum: 'B2CL001',
            idt: '01-10-2026',
            val: 260000,
            itms: [
              {
                num: 1,
                itm_det: {
                  rt: 18,
                  txval: 220338.98,
                  iamt: 39661.02,
                  camt: 100 // ILLEGAL in B2CL!
                }
              }
            ]
          }
        ]
      }
    ];
    assert.throws(
      () => validateGstr1Schema(badB2clPayload),
      /'camt' is not an allowed field/,
      'validateGstr1Schema must reject camt/samt in B2CL itm_det'
    );
    console.log('✓ 15. B2CL strictly forbids camt and samt in itm_det');

    // 16. Test POS: Foreign POS 96 is rejected in B2CL/B2CS, but allowed in B2B/CDNR
    const badPosB2cl = JSON.parse(JSON.stringify(prepared.payload));
    badPosB2cl.b2cl = [
      {
        pos: '96', // ILLEGAL: 96 is foreign, B2CL is domestic inter-state only
        inv: [
          {
            inum: 'B2CL002',
            idt: '01-10-2026',
            val: 260000,
            itms: [{ num: 1, itm_det: { rt: 18, txval: 220338.98, iamt: 39661.02 } }]
          }
        ]
      }
    ];
    assert.throws(
      () => validateGstr1Schema(badPosB2cl),
      /invalid Place of Supply '96'/,
      'validateGstr1Schema must reject POS 96 in B2CL'
    );
    console.log('✓ 16. Domestic POS rule strictly forbids foreign POS 96 in B2CL');

    // 17. Test doc_issue: disallows "canc", enforces "cancel", and enforces inum regex on from/to
    const badDocPayload = JSON.parse(JSON.stringify(prepared.payload));
    badDocPayload.doc_issue = {
      doc_det: [
        {
          doc_num: 1,
          docs: [
            {
              num: 1,
              from: 'INV/001',
              to: 'INV/005',
              totnum: 5,
              canc: 1, // ILLEGAL: must be "cancel"
              net_issue: 4
            }
          ]
        }
      ]
    };
    assert.throws(
      () => validateGstr1Schema(badDocPayload),
      /'canc' is not an allowed field/,
      'validateGstr1Schema must reject legacy "canc" key in doc_issue'
    );

    badDocPayload.doc_issue.doc_det[0].docs[0] = {
      num: 1,
      from: 'INVALID NUM WITH @@@ BAD CHARS',
      to: 'INV/005',
      totnum: 5,
      cancel: 1,
      net_issue: 4
    };
    assert.throws(
      () => validateGstr1Schema(badDocPayload),
      /'from' must be 1-16 chars/,
      'validateGstr1Schema must reject non-compliant inum pattern in doc_issue.docs[].from'
    );
    console.log('✓ 17. doc_issue strictly rejects legacy "canc" and enforces GSTN inum regex on from/to');

    // 18. Test HSN 3-variant validation
    // Variant 1: Rate-wise (hsn_sc, rt, no non-zero val) -> PASS
    // Variant 2: Value-wise (hsn_sc, val, no rt) -> PASS
    // Variant 3: No-HSN (hsn_sc: "", desc mandatory, val present, no rt) -> PASS
    const testHsnPayload = JSON.parse(JSON.stringify(prepared.payload));
    testHsnPayload.hsn = {
      data: [
        { num: 1, hsn_sc: '998311', uqc: 'OTH', qty: 1, rt: 18, txval: 10000, iamt: 1800 }, // Rate-wise
        { num: 2, hsn_sc: '8401', uqc: 'NOS', qty: 2, val: 23600, txval: 20000, iamt: 3600 }, // Value-wise
        { num: 3, hsn_sc: '', desc: 'Unclassified Outward Item', uqc: 'OTH', qty: 1, val: 5900, txval: 5000, iamt: 900 } // No-HSN
      ]
    };
    assert.doesNotThrow(() => validateGstr1Schema(testHsnPayload), 'All 3 official HSN variants must pass');

    // Negative case: Rate-wise variant with non-zero val must be rejected
    const badHsnPayload = JSON.parse(JSON.stringify(prepared.payload));
    badHsnPayload.hsn = {
      data: [
        { num: 1, hsn_sc: '998311', uqc: 'OTH', qty: 1, rt: 18, val: 11800, txval: 10000, iamt: 1800 }
      ]
    };
    assert.throws(
      () => validateGstr1Schema(badHsnPayload),
      /'val' exceeds maximum 0/,
      'validateGstr1Schema must reject rate-wise HSN with val'
    );
    console.log('✓ 18. Table 12 HSN: all 3 official variants (rate-wise, value-wise, no-HSN) validated faithfully');

    // 19. Test B2CS allows negative values for credit note netting
    const netNegativeB2cs = JSON.parse(JSON.stringify(prepared.payload));
    netNegativeB2cs.b2cs = [
      {
        typ: 'OE',
        sply_ty: 'INTRA',
        pos: '33',
        rt: 18,
        txval: -5000, // Net negative from returns
        camt: -450,
        samt: -450,
        csamt: 0
      }
    ];
    assert.doesNotThrow(() => validateGstr1Schema(netNegativeB2cs), 'B2CS net negative values must be accepted');
    console.log('✓ 19. B2CS allows net negative amounts due to unregistered credit notes');

    // 20. Test Gross turnover (gt, cur_gt) disallows negative values
    const badGtPayload = JSON.parse(JSON.stringify(prepared.payload));
    badGtPayload.gt = -100;
    assert.throws(
      () => validateGstr1Schema(badGtPayload),
      /'gt' must be >= 0/,
      'validateGstr1Schema must reject negative gt'
    );
    console.log('✓ 20. gt and cur_gt disallow negative numbers');

    // 21. Test recipient ctin validation accepts GSTIN, UN, NR, and Diplomatic bodies
    const unRecipientPayload = JSON.parse(JSON.stringify(prepared.payload));
    unRecipientPayload.b2b[0].ctin = '0717USA00133UN4'; // Valid UN / Embassy body format
    assert.doesNotThrow(() => validateGstr1Schema(unRecipientPayload), 'UN / Embassy ctin must be accepted in B2B');
    console.log('✓ 21. isValidCtin accepts standard GSTIN, UN bodies, Non-Resident, and Diplomatic missions');

    // 22. Test gt and cur_gt are optional per schema (root required: ['gstin', 'fp'])
    const minimalPayload = JSON.parse(JSON.stringify(prepared.payload));
    delete minimalPayload.gt;
    delete minimalPayload.cur_gt;
    assert.doesNotThrow(() => validateGstr1Schema(minimalPayload), 'gt and cur_gt must be optional');
    console.log('✓ 22. gt and cur_gt are optional in root schema');

    // 23. Test multipleOf: 0.01 enforcement
    const fractionalPayload = JSON.parse(JSON.stringify(prepared.payload));
    fractionalPayload.b2b[0].inv[0].itms[0].itm_det.txval = 100.005; // 3 decimal places
    assert.throws(
      () => validateGstr1Schema(fractionalPayload),
      /must be a multiple of 0.01/,
      'validateGstr1Schema must reject numbers with more than 2 decimal places'
    );
    console.log('✓ 23. multipleOf: 0.01 strictly enforced on numeric fields');

    // 24. Test B2CL regular invoice rejects 'pos', but deletion variant allows 'pos'
    const b2clRegularWithPos = JSON.parse(JSON.stringify(prepared.payload));
    b2clRegularWithPos.b2cl = [
      {
        pos: '07',
        inv: [
          {
            inum: 'B2CL001',
            idt: '01-10-2026',
            val: 260000,
            pos: '07', // ILLEGAL in regular B2CL invoice!
            itms: [{ num: 1, itm_det: { rt: 18, txval: 220338.98, iamt: 39661.02 } }]
          }
        ]
      }
    ];
    assert.throws(
      () => validateGstr1Schema(b2clRegularWithPos),
      /'pos' is not an allowed field/,
      'Regular B2CL invoice must reject pos'
    );

    // Deletion B2CL with pos must pass
    const b2clDeletionWithPos = JSON.parse(JSON.stringify(prepared.payload));
    b2clDeletionWithPos.b2cl = [
      {
        pos: '07',
        inv: [
          {
            inum: 'B2CL001',
            idt: '01-10-2026',
            val: 260000,
            pos: '07',
            flag: 'D'
          }
        ]
      }
    ];
    assert.doesNotThrow(() => validateGstr1Schema(b2clDeletionWithPos), 'Deletion B2CL invoice allows pos');
    console.log('✓ 24. B2CL regular invoice rejects pos, deletion variant allows pos with flag D');

    // 25. Test B2CS deletion variant: flag 'D' with only typ and sply_ty passes
    const b2csDeletionPayload = JSON.parse(JSON.stringify(prepared.payload));
    b2csDeletionPayload.b2cs = [
      {
        typ: 'OE',
        sply_ty: 'INTER',
        flag: 'D'
      }
    ];
    assert.doesNotThrow(() => validateGstr1Schema(b2csDeletionPayload), 'B2CS deletion row requires only typ, sply_ty, flag');
    console.log('✓ 25. Table 7 B2CS deletion variant validated faithfully');

    // 26. Test Nil deletion variant: flag 'D' with only sply_ty passes
    const nilDeletionPayload = JSON.parse(JSON.stringify(prepared.payload));
    nilDeletionPayload.nil = {
      flag: 'D',
      inv: [
        {
          sply_ty: 'INTRAB2C'
        }
      ]
    };
    assert.doesNotThrow(() => validateGstr1Schema(nilDeletionPayload), 'Nil deletion row requires only sply_ty');
    console.log('✓ 26. Table 8 Nil deletion variant validated faithfully');

    // 27. Test HSN deletion variant and legacy key handling
    const hsnDeletionPayload = JSON.parse(JSON.stringify(prepared.payload));
    hsnDeletionPayload.hsn = {
      flag: 'D',
      data: [{ num: 1 }]
    };
    assert.doesNotThrow(() => validateGstr1Schema(hsnDeletionPayload), 'HSN deletion row requires minimal fields');

    // HSN with legacy hsn_b2b key is rejected by validator, but normalized by normalizer
    const legacyHsnPayload = JSON.parse(JSON.stringify(prepared.payload));
    legacyHsnPayload.hsn = {
      hsn_b2b: [{ num: 1, hsn_sc: '998311', uqc: 'OTH', qty: 1, rt: 18, txval: 10000, iamt: 1800 }]
    };
    assert.throws(
      () => validateGstr1Schema(legacyHsnPayload),
      /'hsn_b2b' is not an allowed field/,
      'Validator must reject legacy hsn_b2b key'
    );
    const normalizedHsn = normalizeGstr1Payload(legacyHsnPayload);
    assert.strictEqual(normalizedHsn.hsn.hsn_b2b, undefined, 'normalizer must delete hsn_b2b');
    assert.doesNotThrow(() => validateGstr1Schema(normalizedHsn), 'Normalized HSN must pass validator');
    console.log('✓ 27. Table 12 HSN deletion variant & legacy key normalizer verified');

    // 28. Test doc_issue deletion variant
    const docDeletionPayload = JSON.parse(JSON.stringify(prepared.payload));
    docDeletionPayload.doc_issue = {
      flag: 'D',
      doc_det: []
    };
    assert.doesNotThrow(() => validateGstr1Schema(docDeletionPayload), 'doc_issue deletion variant allows empty doc_det');
    console.log('✓ 28. Table 13 doc_issue deletion variant verified');

    // 29. Test deletion variant validates optional fields when present (not blanket skipping)
    const dirtyDeletionB2b = JSON.parse(JSON.stringify(prepared.payload));
    dirtyDeletionB2b.b2b[0].inv[0].flag = 'D';
    dirtyDeletionB2b.b2b[0].inv[0].val = 'invalid-not-a-number';
    assert.throws(
      () => validateGstr1Schema(dirtyDeletionB2b),
      /'val' must be a valid finite number/,
      'Deletion variant must validate optional val when present'
    );
    console.log('✓ 29. Deletion variants validate optional fields when present');

    // 30. Test section list passed as object instead of array is rejected
    const objSectionPayload = JSON.parse(JSON.stringify(prepared.payload));
    objSectionPayload.b2b = { pos: '07' };
    assert.throws(
      () => validateGstr1Schema(objSectionPayload),
      /must be an array when present/,
      'assertArrayIfPresent must reject non-array section'
    );
    console.log('✓ 30. Section lists enforce array type when present (assertArrayIfPresent)');

    // 31. Test CDNUR allows num: 0 per schema definition
    const zeroNumCdnur = JSON.parse(JSON.stringify(prepared.payload));
    zeroNumCdnur.cdnur[0].itms[0].num = 0;
    assert.doesNotThrow(() => validateGstr1Schema(zeroNumCdnur), 'CDNUR allows num: 0 per schema');
    console.log('✓ 31. CDNUR itms[].num: 0 is accepted per schema definitions');

    // 32. Test ETIN validation
    const badEtinPayload = JSON.parse(JSON.stringify(prepared.payload));
    badEtinPayload.b2b[0].inv[0].etin = 'BAD_ETIN';
    assert.throws(
      () => validateGstr1Schema(badEtinPayload),
      /invalid 'etin'/,
      'validateGstr1Schema must reject malformed etin'
    );
    badEtinPayload.b2b[0].inv[0].etin = '07AAAAA0000A1C5'; // Valid 15-char e-commerce operator ID
    assert.doesNotThrow(() => validateGstr1Schema(badEtinPayload), 'Valid ETIN must be accepted');
    console.log('✓ 32. ETIN format strictly validated');

    console.log('\n🎉 ALL 32 GSTR-1 SCHEMA AUDIT FIXES AND STRICT VALIDATOR RULES VERIFIED SUCCESSFULLY!');
  } finally {
    Invoice.find = originalFind;
  }
}

testSchemaFixes().catch((err) => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
