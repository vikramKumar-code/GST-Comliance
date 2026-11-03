require('dotenv').config();
const mongoose = require('mongoose');
const Workspace = require('../src/models/Workspace');

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/gst_compliance');
  const allWithGstin = await Workspace.find({ gstin: { $exists: true, $ne: null } }, 'name gstin');
  console.log('Workspaces with GSTIN:', allWithGstin.map(w => ({ id: w._id, name: w.name, gstin: w.gstin })));

  // Give Vikram Kumar's workspace a valid unique GSTIN:
  const targetGstin = '29AABCU9603R1ZM';
  await Workspace.findByIdAndUpdate('6ae1dec76f785947476d1a53', { gstin: targetGstin });
  console.log('Updated Vikram Kumar WS 6ae1dec76f785947476d1a53 to GSTIN:', targetGstin);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
