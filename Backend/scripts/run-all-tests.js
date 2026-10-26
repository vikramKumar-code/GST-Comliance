const { spawnSync } = require('node:child_process');
const path = require('node:path');

const BACKEND_DIR = path.resolve(__dirname, '..');

const SUITES = [
  {
    name: 'test-config',
    args: [path.join(__dirname, 'test-config.js')]
  },
  {
    name: 'test-middleware',
    args: [path.join(__dirname, 'test-middleware.js')]
  },
  {
    name: 'test-taxpro',
    args: [path.join(__dirname, 'test-taxpro.js')]
  },
  {
    name: 'test-tenancy',
    args: [
      '--require',
      path.join(__dirname, 'e2e-no-dotenv.js'),
      path.join(__dirname, 'test-tenancy.js')
    ]
  },
  {
    name: 'test-rate-limit-store',
    args: [path.join(__dirname, 'test-rate-limit-store.js')]
  },
  {
    name: 'test-billing',
    args: [path.join(__dirname, 'test-billing.js')]
  },
  {
    name: 'test-gstr1-builder',
    args: [path.join(__dirname, 'test-gstr1-builder.js')]
  },
  {
    name: 'test-itc-reconciliation',
    args: [path.join(__dirname, 'test-itc-reconciliation.js')]
  },
  {
    name: 'test-reports',
    args: [path.join(__dirname, 'test-reports.js')]
  },
  {
    name: 'test-import',
    args: [path.join(__dirname, 'test-import.js')]
  },
  {
    name: 'test:e2e',
    args: [path.join(__dirname, 'run-e2e.js')]
  }
];

function main() {
  console.log(`\n==================================================`);
  console.log(`Starting unified test suite runner (${SUITES.length} suites)`);
  console.log(`==================================================\n`);

  const passedSuites = [];

  for (let i = 0; i < SUITES.length; i++) {
    const suite = SUITES[i];
    console.log(`\n--------------------------------------------------`);
    console.log(`[SUITE ${i + 1}/${SUITES.length}] Running ${suite.name}...`);
    console.log(`--------------------------------------------------\n`);

    const result = spawnSync(process.execPath, suite.args, {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'test'
      },
      stdio: 'inherit'
    });

    if (result.error) {
      console.error(`\n❌ FAIL: ${suite.name} encountered an execution error:`, result.error.message);
      console.error(`Suite run aborted: stopped on first failure.\n`);
      process.exit(1);
    }

    if (result.status !== 0) {
      const exitInfo = result.signal ? `signal ${result.signal}` : `exit code ${result.status}`;
      console.error(`\n❌ FAIL: ${suite.name} failed (${exitInfo})`);
      console.error(`Suite run aborted: stopped on first failure.\n`);
      process.exit(result.status || 1);
    }

    console.log(`\n✓ PASS: ${suite.name}`);
    passedSuites.push(suite.name);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 ALL TEST SUITES PASSED (${passedSuites.length}/${SUITES.length}):`);
  for (const name of passedSuites) {
    console.log(`  ✓ [PASS] ${name}`);
  }
  console.log(`==================================================\n`);
  process.exit(0);
}

main();
