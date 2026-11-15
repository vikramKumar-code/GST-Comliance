// scripts/test-gstr1-flow.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const path = require('path');
const FinaggService = require(path.join(__dirname, '../src/services/finagg.service'));
const Gstr1Service = require(path.join(__dirname, '../src/services/gstr1.service'));

async function testGstr1Filing() {
  // ⚠️ YAHAN APNI REAL/TEST CREDENTIALS DALEIN
  const gstin = '09AAOPK7749L1ZS';           // Apna GSTIN dalein
  const period = '102026';                   // October 2026
  const username = 'AAOPK7749L-';   // Apna GST portal username dalein
  const token = '0fb3cc5d8336412abab789be88b4c60b';     // Active auth token (OTP login ke baad mila hua)
  const pan = 'AAOPK7749L';                  // Authorized Signatory ka PAN (GSTIN se nikala hua)
  const otp = '1D2888';                      // Mobile par aaya hua EVC OTP

  const provider = FinaggService.getProvider();

  // ✅ Clean Payload (No trailing spaces!)
  const payload = {
    gstin: gstin,
    fp: period,
    gt: 0,
    cur_gt: 275851,
    b2b: [
      {
        ctin: "06AANCP1792J1ZY",
        inv: [
          {
            inum: "REW/26-27/246",
            idt: "05-10-2026",
            val: 275851,
            pos: "06",
            rchrg: "N",
            inv_typ: "R",
            itms: [{
              num: 1,
              itm_det: {
                txval: 233772,
                rt: 18,
                iamt: 0,
                camt: 21039.48,
                samt: 21039.48,
                csamt: 0
              }
            }]
          }
        ]
      }
    ],
    hsn: {
      data: [{
        num: 1,
        hsn_sc: "850110",
        desc: "Electrical Machinery",
        uqc: "OTH",
        qty: 1,
        rt: 18,
        txval: 233772,
        iamt: 0,
        camt: 21039.48,
        samt: 21039.48,
        csamt: 0
      }]
    },
    doc_issue: {
      doc_det: [{
        doc_num: 1,
        doc_typ: "Invoices for outward supply",
        docs: [{
          num: 1,
          from: "REW/26-27/246",
          to: "REW/26-27/246",
          totnum: 1,
          cancel: 0,
          net_issue: 1
        }]
      }]
    }
  };

  try {
    console.log('🚀 Starting GSTR-1 4-Step Filing Flow...\n');
    console.log('📋 Configuration:');
    console.log('   GSTIN:', gstin);
    console.log('   Period:', period);
    console.log('   Username:', username);
    console.log('   Token Length:', token.length, 'chars');
    console.log('   PAN:', pan);
    console.log('   OTP Length:', otp.length, 'chars\n');

    // ---------------------------------------------------------
    // STEP 1: Save Payload (RETSAVE)
    // ---------------------------------------------------------
    console.log('📌 STEP 1: Saving GSTR-1 Payload with Valid Tables 4A, 12 (HSN) & 13 (DOCISS)...');
    const saveRes = await provider.saveGstr1(payload, { gstin, period, username, token });
    console.log('✅ Save Success! Ref ID:', saveRes.ref_id);

    // ---------------------------------------------------------
    // STEP 3: Get Summary (RETSUM) with auto-retry
    // ---------------------------------------------------------
    console.log('\n📌 STEP 3: Fetching Summary & Checksum (RETSUM)...');
    let summaryRes;
    const maxRetries = 6;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        summaryRes = await provider.getGstr1RetSum(gstin, period, username, token, false);
        break;
      } catch (err) {
        const isSummaryPending = err.errorCd === 'RET09001' || 
          (err.message && (err.message.includes('RET09001') || err.message.includes('Latest Summary is not available')));
        
        if (isSummaryPending && attempt < maxRetries) {
          console.log(`⏳ GSTN summary generate ho rahi hai (Attempt ${attempt}/${maxRetries}). 5 seconds me retry kar rahe hain...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
          throw err;
        }
      }
    }

    // summaryRes raw string hai, usme se chksum extract karein
    let parsedSummary;
    try {
      parsedSummary = typeof summaryRes === 'string' ? JSON.parse(summaryRes) : summaryRes;
    } catch {
      parsedSummary = summaryRes;
    }

    const chksum = parsedSummary?.data?.chksum || parsedSummary?.chksum;
    console.log('✅ Summary fetched! Checksum:', chksum);

    // ---------------------------------------------------------
    // STEP 4: File with EVC (RETFILE) or Request EVC OTP
    // ---------------------------------------------------------
    if (!otp.trim()) {
      console.log('\n📌 STEP 4: Requesting EVC OTP from GST Portal...');
      const otpRes = await provider.requestEvcOtp(gstin, username, pan.trim().toUpperCase(), 'R1', token, period);
      console.log('✅', otpRes.message || 'EVC OTP sent successfully!');
      console.log('\n📲 Aapke GST Portal se linked mobile number aur email par EVC OTP bhej diya gaya hai!');
      console.log(`👉 Ab test-gstr1-flow.js ke line 15 me OTP enter karein:`);
      console.log(`   const otp = 'YAHAN_OTP_DALEIN';`);
      console.log(`👉 Aur script ko dobara run karein to file GSTR-1!\n`);
      return;
    }

    console.log('\n📌 STEP 4: Filing Return with EVC OTP (RETFILE)...');
    const fileRes = await provider.fileGstr1(period, {
      gstin,
      username,
      token,
      pan: pan.trim().toUpperCase(),
      otp: otp.trim(),
      step1Response: summaryRes // Raw summary pass karein taaki dobara fetch na kare
    });

    console.log('\n🎉🎉🎉 FILING SUCCESSFUL! 🎉🎉🎉');
    console.log('📜 Acknowledgement Reference Number (ARN):', fileRes.arn);
    console.log('\n✅ Return filed successfully on GST Portal!');
    console.log('📥 You can now download the filing certificate from the portal.');

  } catch (error) {
    console.error('\n❌ Filing Flow Failed!');
    console.error('Error Message:', error.message);
    if (error.errorCd) {
      console.error('🚨 GSTN Error Code:', error.errorCd);
    }
    if (error.statusCode) {
      console.error('🚨 HTTP Status:', error.statusCode);
    }
    console.error('\n💡 Troubleshooting Tips:');
    console.error('   1. Check if token is valid (not expired)');
    console.error('   2. Verify PAN is correct (4th letter should be "P" for individuals)');
    console.error('   3. Ensure OTP is fresh (not expired)');
    console.error('   4. Check if period is open for filing');
    console.error('   5. Verify payload matches GSTN schema');
  }
}

// Script run karein
testGstr1Filing();