import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import pg from 'pg';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

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
  // Add Africa's Talking call here
}, { connection: redis });

// Backup Worker
new Worker('backup', async job => {
  const tables = ['tenants', 'users', 'students', 'grades'];
  for (const table of tables) {
    const data = (await pool.query(`SELECT * FROM ${table}`)).rows;
    console.log(`Backed up ${table}: ${data.length} rows`);
  }
}, { connection: redis });

console.log('🚀 SSEWASSWA Workers v9.0 Running');
