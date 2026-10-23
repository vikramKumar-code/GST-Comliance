const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MONGO_URI } = require('../src/config/env');
const MongoRateLimitStore = require('../src/services/mongoRateLimitStore');

async function main() {
  await mongoose.connect(MONGO_URI);

  const namespace = `store-test-${crypto.randomUUID()}`;
  const firstInstance = new MongoRateLimitStore(namespace);
  const secondInstance = new MongoRateLimitStore(namespace);
  firstInstance.init({ windowMs: 5000 });
  secondInstance.init({ windowMs: 5000 });

  try {
    const increments = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        (index % 2 ? firstInstance : secondInstance).increment('synthetic-client')
      )
    );
    assert.deepEqual(
      increments.map(({ totalHits }) => totalHits).sort((a, b) => a - b),
      Array.from({ length: 24 }, (_, index) => index + 1),
      'Concurrent increments from separate instances must share one counter'
    );

    await secondInstance.decrement('synthetic-client');
    assert.equal((await firstInstance.increment('synthetic-client')).totalHits, 24);

    await firstInstance.resetKey('synthetic-client');
    assert.equal((await secondInstance.increment('synthetic-client')).totalHits, 1);

    const expiryNamespace = `${namespace}-expiry`;
    const expiringStore = new MongoRateLimitStore(expiryNamespace);
    expiringStore.init({ windowMs: 100 });
    assert.equal((await expiringStore.increment('synthetic-client')).totalHits, 1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal((await expiringStore.increment('synthetic-client')).totalHits, 1);

    await firstInstance.resetAll();
    await expiringStore.resetAll();
    console.log('MongoDB rate-limit store checks passed (shared concurrency, decrement, reset, expiry).');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('MongoDB rate-limit store checks failed:', error.name);
  process.exitCode = 1;
});
