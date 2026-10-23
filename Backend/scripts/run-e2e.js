const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { MongoClient } = require('mongodb');

const BACKEND_DIR = path.resolve(__dirname, '..');
const DOTENV_PRELOAD = path.join(__dirname, 'e2e-no-dotenv.js');
const DATABASE_PREFIX = 'gstapp_e2e_';
const MONGO_ADMIN_URI = 'mongodb://127.0.0.1:27017';
const STARTUP_TIMEOUT_MS = 30000;
const TEST_TIMEOUT_MS = 120000;

let serverChild = null;
let testChild = null;
let receivedSignal = null;

function minimalWindowsEnvironment(overrides = {}) {
  const env = {};
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return { ...env, ...overrides };
}

function createDatabaseName() {
  return `${DATABASE_PREFIX}${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

function assertE2eDatabaseName(databaseName) {
  if (typeof databaseName !== 'string' || !databaseName.startsWith(DATABASE_PREFIX)) {
    throw new Error(`Refusing to drop a database outside the ${DATABASE_PREFIX} prefix.`);
  }
}

function verifyDatabaseDropGuard() {
  try {
    assertE2eDatabaseName('gstapp_not_an_e2e_database');
  } catch {
    return;
  }
  throw new Error('Database drop guard accepted a name outside the E2E prefix.');
}

async function findFreePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Child process did not exit before timeout.')), timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitForHealth(child, port) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  const healthUrl = `http://127.0.0.1:${port}/health`;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Mock server exited before becoming healthy.');
    }
    if (receivedSignal) throw new Error(`Interrupted by ${receivedSignal}.`);

    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
      if (response.ok && (await response.json()).ok === true) return;
    } catch {
      // The server is still starting or MongoDB is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('Mock server did not become healthy before the startup timeout.');
}

async function stopChild(child, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return null;

  let exited = waitForExit(child, 5000).catch(() => null);
  child.kill('SIGTERM');
  let result = await exited;
  if (result) return null;

  exited = waitForExit(child, 5000).catch(() => null);
  child.kill('SIGKILL');
  result = await exited;
  return result ? null : `${label} did not stop after termination signals`;
}

async function runApiTest(port) {
  testChild = spawn(process.execPath, [
    '--require', DOTENV_PRELOAD,
    path.join(__dirname, 'test-api.js')
  ], {
    cwd: BACKEND_DIR,
    env: minimalWindowsEnvironment({
      NODE_ENV: 'test',
      PROVIDER: 'mock',
      USE_MOCK: 'true',
      TEST_API_BASE_URL: `http://127.0.0.1:${port}`
    }),
    stdio: 'inherit'
  });

  const result = await waitForExit(testChild, TEST_TIMEOUT_MS);
  testChild = null;
  if (result.code !== 0) {
    throw new Error(`API E2E tests failed (exit code ${result.code ?? 'signal'}).`);
  }
}

async function dropTestDatabase(databaseName) {
  assertE2eDatabaseName(databaseName);

  const client = new MongoClient(MONGO_ADMIN_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    await client.db(databaseName).dropDatabase();
  } finally {
    await client.close();
  }
}

async function main() {
  verifyDatabaseDropGuard();
  const databaseName = createDatabaseName();
  let exitCode = 0;
  let failureMessage = '';
  let cleanupMessage = '';

  try {
    const port = await findFreePort();
    const childEnv = minimalWindowsEnvironment({
      NODE_ENV: 'test',
      PROVIDER: 'mock',
      USE_MOCK: 'true',
      PORT: String(port),
      MONGO_URI: `${MONGO_ADMIN_URI}/${databaseName}`,
      FRONTEND_URL: 'http://127.0.0.1:5173',
      TRUST_PROXY_HOPS: '1',
      JWT_SECRET: 'local-e2e-only-secret-never-used-in-production',
      TENANT_IDENTITY_SECRET: 'local-e2e-only-tenant-identity-key',
      DATA_ENCRYPTION_KEY: '0'.repeat(64),
      CONTACT_INTAKE_ENABLED: 'false'
    });

    console.log(`Starting isolated mock API on port ${port}.`);
    serverChild = spawn(process.execPath, [
      '--require', DOTENV_PRELOAD,
      path.join(BACKEND_DIR, 'server.js')
    ], {
      cwd: BACKEND_DIR,
      env: childEnv,
      stdio: 'ignore'
    });
    serverChild.on('error', () => {});

    await waitForHealth(serverChild, port);
    console.log('Mock API is healthy; running API E2E suite.');
    await runApiTest(port);
    console.log('API E2E suite passed.');
  } catch (error) {
    exitCode = 1;
    failureMessage = error.message || 'E2E runner failed.';
  } finally {
    let testStopError = null;
    let serverStopError = null;
    try {
      testStopError = await stopChild(testChild, 'API test process');
    } catch (error) {
      testStopError = `API test process shutdown failed (${error.name || 'error'})`;
    }
    testChild = null;
    try {
      serverStopError = await stopChild(serverChild, 'Mock server');
    } catch (error) {
      serverStopError = `Mock server shutdown failed (${error.name || 'error'})`;
    }
    serverChild = null;

    try {
      await dropTestDatabase(databaseName);
      console.log(`Dropped isolated database ${databaseName}.`);
    } catch (error) {
      cleanupMessage = `Could not drop isolated database ${databaseName} (${error.name || 'cleanup error'}).`;
    }

    if (testStopError || serverStopError) {
      cleanupMessage = [cleanupMessage, testStopError, serverStopError].filter(Boolean).join('; ');
    }
    if (receivedSignal) {
      exitCode = 1;
      failureMessage = `Interrupted by ${receivedSignal}.`;
    }
  }

  if (failureMessage) console.error(`E2E failed: ${failureMessage}`);
  if (cleanupMessage) {
    console.error(`E2E cleanup failed: ${cleanupMessage}`);
    exitCode = 1;
  }
  process.exitCode = exitCode;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    receivedSignal = signal;
    testChild?.kill('SIGTERM');
    serverChild?.kill('SIGTERM');
  });
}

main().catch((error) => {
  console.error(`E2E runner failed (${error.name || 'error'}).`);
  process.exitCode = 1;
});
