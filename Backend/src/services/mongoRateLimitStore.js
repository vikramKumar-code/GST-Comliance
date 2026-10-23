const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { JWT_SECRET } = require('../config/env');

const COLLECTION_NAME = 'rate_limit_counters';

/**
 * Shared express-rate-limit store backed by MongoDB.
 * Client keys are HMACed before persistence so IP addresses are not stored directly.
 */
class MongoRateLimitStore {
  constructor(namespace) {
    this.namespace = namespace;
    this.localKeys = false;
    this.windowMs = 15 * 60 * 1000;
    this.indexPromise = null;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  getCollection() {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
      throw new Error('MongoDB must be connected before rate limiting requests');
    }

    return mongoose.connection.db.collection(COLLECTION_NAME);
  }

  async ensureIndexes(collection) {
    if (!this.indexPromise) {
      this.indexPromise = collection.createIndex(
        { resetAt: 1 },
        { expireAfterSeconds: 0, name: 'rate_limit_reset_ttl' }
      ).catch((error) => {
        this.indexPromise = null;
        throw error;
      });
    }
    await this.indexPromise;
  }

  getStorageKey(key) {
    return crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${this.namespace}:${key}`)
      .digest('hex');
  }

  async increment(key) {
    const collection = this.getCollection();
    await this.ensureIndexes(collection);

    const now = new Date();
    const nextResetAt = new Date(now.getTime() + this.windowMs);
    const activeWindow = { $gt: ['$resetAt', now] };
    const filter = { _id: this.getStorageKey(key) };
    const update = [
      {
        $set: {
          scope: this.namespace,
          totalHits: {
            $cond: [activeWindow, { $add: [{ $ifNull: ['$totalHits', 0] }, 1] }, 1]
          },
          resetAt: { $cond: [activeWindow, '$resetAt', nextResetAt] }
        }
      }
    ];

    let result;
    try {
      result = await collection.findOneAndUpdate(filter, update, {
        upsert: true,
        returnDocument: 'after'
      });
    } catch (error) {
      // Concurrent first requests can race to create the same unique _id. Retry
      // without upsert so the losing request increments the newly created row.
      if (error.code !== 11000) throw error;
      result = await collection.findOneAndUpdate(filter, update, { returnDocument: 'after' });
    }

    const counter = result?.value || result;
    if (!counter || typeof counter.totalHits !== 'number' || !counter.resetAt) {
      throw new Error('MongoDB rate-limit counter update returned an invalid result');
    }

    return { totalHits: counter.totalHits, resetTime: counter.resetAt };
  }

  async decrement(key) {
    const collection = this.getCollection();
    const now = new Date();
    await collection.updateOne(
      { _id: this.getStorageKey(key), resetAt: { $gt: now } },
      [{ $set: { totalHits: { $max: [0, { $subtract: ['$totalHits', 1] }] } } }]
    );
  }

  async resetKey(key) {
    await this.getCollection().deleteOne({ _id: this.getStorageKey(key) });
  }

  async resetAll() {
    await this.getCollection().deleteMany({ scope: this.namespace });
  }

  shutdown() {}
}

module.exports = MongoRateLimitStore;
