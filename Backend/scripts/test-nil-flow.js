// scripts/test-nil-flow.js
process.env.NODE_ENV = 'development';
const path = require('path');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const FinaggService = require(path.join(__dirname, '../src/services/finagg.service'));
const mongoose = require(path.join(__dirname, '../node_modules/mongoose'));

function ask(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function runNilFiling() {
  const gstin = '09AAOPK7749L1ZS';
  const period = '102026';
  const username = 'AAOPK7749L-';
  const pan = 'AAOPK7749L';
  const token = '0fb3cc5d8336412abab789be88b4c60b';

  const provider = FinaggService.getProvider();

  console.log('\n======================================================');
  console.log('   🧾 CandidTax Live GSTR-1 Nil Return EVC Filing');
  console.log('======================================================');
  console.log('📋 Taxpayer GSTIN :', gstin);
  console.log('📅 Return Period   :', period, '(October 2026)');
  console.log('👤 Authorized PAN  :', pan);
  console.log('🔑 Portal Username :', username);
  console.log('======================================================\n');

  let otp = process.argv[2] ? process.argv[2].trim() : '';

  try {
    if (!otp) {
      console.log('📲 Requesting fresh EVC OTP from GST Portal...');
      const otpRes = await provider.requestEvcOtp(gstin, username, pan, 'R1', token, period);
      console.log('✅ OTP Dispatched!', otpRes.message || 'OTP sent to registered mobile/email.\n');

      otp = await ask('👉 Enter the EVC OTP received on your phone/email: ');
    }

    if (!otp) {
      console.log('❌ No OTP entered. Filing aborted.');
      process.exit(1);
    }

    console.log(`\n⏳ Signing and Submitting (RETFILE) with EVC OTP [${otp}]...`);
    const fileRes = await provider.fileGstr1(period, {
      gstin,
      username,
      token,
      pan,
      otp,
      mode: 'EVC',
      isNil: true
    });

    const arn = fileRes?.arn;
    if (!arn) {
      throw new Error('Government GST Portal did not return an Acknowledgement Reference Number (ARN).');
    }

    console.log('\n======================================================');
    console.log('  🎉🎉🎉 NIL GSTR-1 FILED SUCCESSFULLY! 🎉🎉🎉');
    console.log('======================================================');
    console.log('📜 Official GSTN ARN :', arn);
    console.log('📅 Filing Date        :', new Date().toLocaleString('en-IN'));
    console.log('🔒 Status             : FILED & CONFIRMED ON GST PORTAL');
    console.log('======================================================\n');

    // Save to MongoDB if available
    try {
      const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/gstapp';
      await mongoose.connect(mongoUri);
      const Filing = require('../src/models/Filing');
      const Workspace = require('../src/models/Workspace');
      const ws = await Workspace.findOne({ gstin });
      if (ws) {
        await Filing.findOneAndUpdate(
          { workspaceId: ws._id, type: 'GSTR1', period },
          {
            workspaceId: ws._id,
            gstin,
            type: 'GSTR1',
            period,
            arn,
            status: 'Filed',
            mode: 'NIL_EVC',
            isNil: true,
            filingDate: new Date(),
            dateStr: new Date().toLocaleDateString('en-GB'),
            declarationAccepted: true,
            summary: { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, totalTax: 0 }
          },
          { upsert: true, returnDocument: 'after' }
        );
        console.log('💾 Filing record saved in database successfully.');
      }
      await mongoose.disconnect();
    } catch (dbErr) {
      console.log('ℹ️ Database save note:', dbErr.message);
    }

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Filing Failed!');
    console.error('Error Message:', err.message);
    if (err.errorCd) {
      console.error('🚨 GSTN Error Code:', err.errorCd);
    }
    if (err.response?.data) {
      console.error('Details:', err.response.data);
    }
    process.exit(1);
  }
}

runNilFiling();
