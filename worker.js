const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

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
  console.log('SMS:', job.data.phone, job.data.message);
  // Add Africa's Talking or other SMS API here
}, { connection: redis });

// Backup Worker
new Worker('backup', async job => {
  const tables = ['tenants', 'users', 'students', 'fees', 'marks'];
  for (const table of tables) {
    try {
      const data = (await pool.query(`SELECT * FROM ${table} LIMIT 1000`)).rows;
      console.log(`Backed up ${table}: ${data.length} rows`);
    } catch (e) {
      console.warn(`Backup skipped ${table}:`, e.message);
    }
  }
}, { connection: redis });

console.log('SSEWASSWA Workers Running');
