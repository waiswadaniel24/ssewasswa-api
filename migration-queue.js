/**
 * Migration Queue — ssewasswa-api
 *
 * Prevents database connection pool exhaustion during server startup
 * by serializing migration operations.
 *
 * Problem: 50+ modules each run CREATE TABLE IF NOT EXISTS on startup.
 * With only 20 pool connections, concurrent migrations cause timeouts.
 *
 * Solution: Modules register their migration functions with this queue.
 * After all modules are loaded, the queue is processed sequentially
 * (or in small batches), ensuring at most N connections are used for
 * migrations at any time.
 *
 * Usage in modules:
 *   // Instead of:
 *   (async () => { await pool.query('CREATE TABLE IF NOT EXISTS ...'); })().catch(console.error);
 *
 *   // Use:
 *   const migrationQueue = app.get('migrationQueue');
 *   migrationQueue.add('my-module', async () => {
 *     await pool.query('CREATE TABLE IF NOT EXISTS ...');
 *   });
 *
 * Usage in server.js (after all modules are loaded):
 *   const migrationQueue = app.get('migrationQueue');
 *   await migrationQueue.drain();  // Process all queued migrations
 */

const { migrateQuery } = require('./db');
class MigrationQueue {
  constructor(pool, concurrency = 3) {
    this.pool = pool;
    this.concurrency = concurrency;
    this.queue = [];
    this.completed = 0;
    this.failed = 0;
    this.started = false;
    this._drainPromise = null;
    this._drainResolve = null;
  }

  /**
   * Register a migration function.
   * @param {string} name - Module name for logging
   * @param {Function} fn - Async function that performs the migration
   */
  add(name, fn) {
    this.queue.push({ name, fn });
    if (!this.started) return;

    // If drain has already started, process immediately
    this._processNext();
  }

  /**
   * Start processing all queued migrations.
   * Returns a promise that resolves when all migrations are done.
   * @param {number} [concurrency] - Override concurrency limit
   */
  async drain(concurrency) {
    if (concurrency) this.concurrency = concurrency;
    this.started = true;

    if (this.queue.length === 0) {
      console.log('[MigrationQueue] No migrations queued');
      return;
    }

    console.log(`[MigrationQueue] Processing ${this.queue.length} migrations (concurrency: ${this.concurrency})`);
    const startTime = Date.now();

    this._drainPromise = new Promise((resolve) => {
      this._drainResolve = resolve;
    });

    // Start initial batch
    for (let i = 0; i < Math.min(this.concurrency, this.queue.length); i++) {
      this._processNext();
    }

    await this._drainPromise;

    const elapsed = Date.now() - startTime;
    console.log(`[MigrationQueue] Done: ${this.completed} ok, ${this.failed} failed in ${elapsed}ms`);
  }

  _processNext() {
    if (this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) {
      // Queue might be empty now — check if drain should resolve
      this._tryResolveDrain();
      return;
    }

    const { name, fn } = item;
    this._runningCount = (this._runningCount || 0) + 1;

    (async () => {
      try {
        await fn();
        this.completed++;
        console.log(`[MigrationQueue] ✓ ${name} (${this.completed + this.failed}/${this.completed + this.failed + this.queue.length})`);
      } catch (err) {
        this.failed++;
        /* migration OK — don't crash on migration errors */
      }

      this._runningCount = (this._runningCount || 0) - 1;

      // Process next item or resolve drain
      if (this.queue.length > 0) {
        this._processNext();
      } else {
        this._tryResolveDrain();
      }
    })();
  }

  _tryResolveDrain() {
    if (this._drainResolve && this.queue.length === 0 && (this._runningCount || 0) <= 0) {
      this._drainResolve();
      this._drainResolve = null;
    }
  }

  /** Get queue status */
  get status() {
    return {
      pending: this.queue.length,
      completed: this.completed,
      failed: this.failed,
      started: this.started
    };
  }
}

module.exports = MigrationQueue;
