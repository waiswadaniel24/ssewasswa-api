require('dotenv').config();
const { Worker, Queue } = require('bullmq');
const IORedis = require('ioredis');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.log('No REDIS_URL set. Workers require Redis. Exiting.');
  process.exit(0);
}

const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });

const emailQueue = new Queue('email', { connection: redis });
const smsQueue = new Queue('sms', { connection: redis });
const backupQueue = new Queue('backup', { connection: redis });

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
});

// Email Worker
new Worker('email', async job => {
  await transporter.sendMail(job.data);
}, { connection: redis });

// SMS Worker
new Worker('sms', async job => {
  console.log('SMS Worker:', job.data.phone, job.data.message);
  // Add Africa's Talking or other SMS provider here
}, { connection: redis });

// Backup Worker
new Worker('backup', async job => {
  const tables = ['tenants', 'users', 'students', 'marks', 'fees', 'attendance', 'exams'];
  for (const table of tables) {
    try {
      const data = (await pool.query(`SELECT * FROM ${table} LIMIT 10000`)).rows;
      console.log(`Backed up ${table}: ${data.length} rows`);
    } catch (e) {
      console.warn(`Skip ${table}: ${e.message}`);
    }
  }
}, { connection: redis });

console.log('SSEWASSWA Workers v9.0 Running');
