/**
 * Admin Database CLI Script: Update Member Roles Directly in MongoDB
 * 
 * Usage:
 *   node scripts/set-role.js --list
 *   node scripts/set-role.js --role=ADMIN
 *   node scripts/set-role.js --email=user@example.com --role=ADMIN
 *   node scripts/set-role.js --gstin=33AANCS2882A1ZG --role=OWNER
 */

const mongoose = require('mongoose');
const config = require('../src/config/env');
const User = require('../src/models/User');
const Workspace = require('../src/models/Workspace');
const WorkspaceMember = require('../src/models/WorkspaceMember');

const ALLOWED_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    if (arg.startsWith('--')) {
      const [key, ...vals] = arg.slice(2).split('=');
      args[key.toLowerCase()] = vals.length > 0 ? vals.join('=') : true;
    }
  });
  return args;
}

async function run() {
  const args = parseArgs();

  console.log('Connecting to database:', config.MONGO_URI);
  await mongoose.connect(config.MONGO_URI);

  try {
    if (args.list) {
      console.log('\n--- Workspace Members & Assigned Roles in Database ---');
      const members = await WorkspaceMember.find()
        .populate('userId', 'name email authProvider')
        .populate('workspaceId', 'name gstin')
        .lean();

      if (members.length === 0) {
        console.log('No members found in database.');
      } else {
        members.forEach((m, idx) => {
          console.log(
            `[${idx + 1}] User: ${m.userId?.name || 'N/A'} (${m.userId?.email || m.userId?.authProvider || m.userId?._id}) | ` +
            `Workspace: ${m.workspaceId?.name || 'N/A'} (GSTIN: ${m.workspaceId?.gstin || 'Unlinked'}) | ` +
            `Role: [${m.role}] | Status: ${m.status}`
          );
        });
      }
      console.log('\nTo update a role directly in database:');
      console.log('  node scripts/set-role.js --role=<OWNER|ADMIN|MEMBER|VIEWER>');
      console.log('  node scripts/set-role.js --email=<email> --role=<ROLE>');
      console.log('  node scripts/set-role.js --gstin=<gstin> --role=<ROLE>\n');
      process.exit(0);
    }

    const targetRole = (args.role || '').toUpperCase();
    if (!targetRole || !ALLOWED_ROLES.includes(targetRole)) {
      console.error(`\n❌ Error: Valid --role is required. Allowed roles: ${ALLOWED_ROLES.join(', ')}`);
      console.log('Example: node scripts/set-role.js --role=ADMIN');
      console.log('List all: node scripts/set-role.js --list\n');
      process.exit(1);
    }

    let userQuery = {};
    if (args.email) {
      userQuery.email = args.email.toLowerCase();
    } else if (args.name) {
      userQuery.name = new RegExp(args.name, 'i');
    }

    let targetUser = null;
    if (Object.keys(userQuery).length > 0) {
      targetUser = await User.findOne(userQuery);
      if (!targetUser) {
        console.error(`❌ User not found with criteria:`, userQuery);
        process.exit(1);
      }
    }

    let targetWorkspace = null;
    if (args.gstin) {
      targetWorkspace = await Workspace.findOne({ gstin: args.gstin.toUpperCase() });
      if (!targetWorkspace) {
        console.error(`❌ Workspace not found with GSTIN: ${args.gstin}`);
        process.exit(1);
      }
    }

    let memberQuery = { status: 'ACTIVE' };
    if (targetUser) memberQuery.userId = targetUser._id;
    if (targetWorkspace) memberQuery.workspaceId = targetWorkspace._id;

    let memberCount = await WorkspaceMember.countDocuments(memberQuery);

    if (memberCount === 0) {
      // If no member found, check if we can update the first active member or workspace owner
      const anyMember = await WorkspaceMember.findOne();
      if (anyMember) {
        memberQuery = { _id: anyMember._id };
        memberCount = 1;
      } else {
        console.error('❌ No active workspace memberships found in database.');
        process.exit(1);
      }
    }

    if (memberCount > 1 && !args.all && !targetUser && !targetWorkspace) {
      console.warn(`⚠️ Multiple members (${memberCount}) found. Please specify --email or --gstin, or pass --all to update all.`);
      console.log('Run: node scripts/set-role.js --list');
      process.exit(1);
    }

    const result = await WorkspaceMember.updateMany(memberQuery, { $set: { role: targetRole } });
    console.log(`\n✅ Successfully updated ${result.modifiedCount} membership record(s) in MongoDB to role: [${targetRole}].`);
    console.log(`The change takes effect immediately on user's next request or page refresh.\n`);
  } catch (err) {
    console.error('Database update error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
