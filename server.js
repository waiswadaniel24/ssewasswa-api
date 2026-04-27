import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";
import cookieParser from "cookie-parser";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import PDFDocument from "pdfkit";
import https from "https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(join(__dirname, "public")));

let db;
(async () => {
  db = await open({ filename: './payments.db', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT UNIQUE,
      student_name TEXT,
      student_class TEXT,
      parent_phone TEXT,
      amount INTEGER,
      status TEXT DEFAULT 'pending_verification',
      mtn_transaction_id TEXT UNIQUE,
      parent_confirmed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      verified_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      payment_method TEXT DEFAULT 'direct_momo',
      admin_notes TEXT
    );
    CREATE TABLE IF NOT EXISTS notification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT,
      type TEXT,
      status TEXT,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
})();

const getConfig = () => JSON.parse(fs.readFileSync("config.json", "utf8"));
const saveConfig = (data) => fs.writeFileSync("config.json", JSON.stringify(data, null, 2));

const sendNotification = async (message, type, title = null) => {
  const config = getConfig();
  if (!config.notifications_enabled || !config.ntfy_topic) return { status: 'disabled' };
  try {
    await fetch(`https://ntfy.sh/${config.ntfy_topic}`, {
      method: 'POST',
      body: message,
      headers: { 'Title': title || config.school_name, 'Priority': 'high', 'Tags': 'moneybag,school' }
    });
    await db.run('INSERT INTO notification_logs (message, type, status) VALUES (?,?,?)', [message, type, 'sent']);
    return { status: 'sent' };
  } catch (err) {
    await db.run('INSERT INTO notification_logs (message, type, status) VALUES (?,?,?)', [message, type, 'failed']);
    return { status: 'failed', error: err.message };
  }
};

const checkAdmin = (req, res, next) => {
  const config = getConfig();
  if (!config.admin_password_enabled) return next();
  if (req.cookies.admin_auth === config.admin_password) return next();
  res.status(401).json({ error: "Unauthorized" });
};

// Helper: Draw standard header/footer on PDF
const drawDocumentHeader = async (doc, config) => {
  const blue = config.primary_color || '#2c5aa0';
  const cream = config.secondary_color || '#FFF8E7';
  
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(cream);
  
  // Logo
  if (config.school_logo_url) {
    try {
      await new Promise((resolve) => {
        https.get(config.school_logo_url, (response) => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => {
            try {
              doc.image(Buffer.concat(chunks), 50, 40, { width: 60 });
              resolve();
            } catch(e) { resolve(); }
          });
        }).on('error', () => resolve());
      });
    } catch(e) {}
  }
  
  // Badge
  if (config.school_badge_url) {
    try {
      await new Promise((resolve) => {
        https.get(config.school_badge_url, (response) => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => {
            try {
              doc.image(Buffer.concat(chunks), doc.page.width - 110, 40, { width: 60 });
              resolve();
            } catch(e) { resolve(); }
          });
        }).on('error', () => resolve());
      });
    } catch(e) {}
  }
  
  // Header Text
  doc.fillColor(blue).fontSize(18).text(config.header_title || config.school_name, 50, 50, { align: 'center', width: doc.page.width - 100 });
  doc.fontSize(10).text(config.header_subtitle || config.school_address, { align: 'center', width: doc.page.width - 100 });
  if (config.school_motto) doc.fontSize(9).text(`"${config.school_motto}"`, { align: 'center', width: doc.page.width - 100 });
  
  doc.moveTo(50, 120).lineTo(doc.page.width - 50, 120).stroke(blue);
  doc.y = 140;
};

const drawDocumentFooter = (doc, config) => {
  const blue = config.primary_color || '#2c5aa0';
  doc.fillColor(blue).fontSize(8);
  doc.text(config.receipt_footer || 'Thank you.', 50, doc.page.height - 50, { align: 'center', width: doc.page.width - 100 });
};

app.post("/api/report-payment", async (req, res) => {
  const { transaction_id, student_name, student_class, parent_phone, amount, payment_method } = req.body;
  if (!transaction_id || !student_name || !amount) return res.status(400).json({ error: "Transaction ID, Student Name, and Amount required" });
  const existing = await db.get('SELECT reference FROM payments WHERE mtn_transaction_id = ?', transaction_id);
  if (existing) return res.status(400).json({ error: "This Transaction ID was already reported" });
  const reference = "DIR-" + Date.now();
  const config = getConfig();
  const txidValid = /^(MP|AP|TX|TR)\d{6,}/i.test(transaction_id) || transaction_id.length > 8;
  if (!txidValid) return res.status(400).json({ error: "Invalid Transaction ID format" });
  const autoVerify = config.auto_verify_enabled;
  const status = autoVerify ? 'verified' : 'pending_verification';
  const verified_at = autoVerify ? new Date().toISOString() : null;
  await db.run(`INSERT INTO payments (reference, student_name, student_class, parent_phone, amount, mtn_transaction_id, status, payment_method, verified_at) VALUES (?,?,?,?,?,?,?,?,?)`, [reference, student_name, student_class, parent_phone, amount, transaction_id, status, payment_method || 'direct_momo', verified_at]);
  const msg = autoVerify ? `Auto-Verified Payment ?\nStudent: ${student_name} - ${student_class}\nAmount: ${parseInt(amount).toLocaleString()} UGX\nTxID: ${transaction_id}\nRef: ${reference}` : `Direct Payment Reported\nStudent: ${student_name} - ${student_class}\nAmount: ${parseInt(amount).toLocaleString()} UGX\nTxID: ${transaction_id}\nRef: ${reference}\nREADY TO VERIFY`;
  sendNotification(msg, autoVerify ? 'auto_verified' : 'direct_payment');
  res.json({ success: true, reference, auto_verified: autoVerify, message: autoVerify ? "Payment auto-verified! You can download receipt." : "Payment reported. School will verify shortly." });
});

app.post("/api/admin/verify/:ref", checkAdmin, async (req, res) => {
  const payment = await db.get('SELECT * FROM payments WHERE reference = ?', req.params.ref);
  if (!payment) return res.status(404).json({ error: "Not found" });
  await db.run('UPDATE payments SET status = "verified", verified_at = CURRENT_TIMESTAMP WHERE reference = ?', req.params.ref);
  const msg = `Payment VERIFIED ?\nRef: ${payment.reference}\nStudent: ${payment.student_name}\nTxID: ${payment.mtn_transaction_id}\nAmount: ${payment.amount.toLocaleString()} UGX`;
  sendNotification(msg, 'verified');
  res.json({ success: true });
});

app.post("/api/admin/reject/:ref", checkAdmin, async (req, res) => {
  const { reason } = req.body;
  await db.run('UPDATE payments SET status = "rejected", admin_notes = ? WHERE reference = ?', [reason || 'Invalid', req.params.ref]);
  res.json({ success: true });
});

app.post("/api/admin/add-note/:ref", checkAdmin, async (req, res) => {
  const { note } = req.body;
  await db.run('UPDATE payments SET admin_notes = ? WHERE reference = ?', [note, req.params.ref]);
  res.json({ success: true });
});

app.get("/api/payment-status/:ref", async (req, res) => {
  const payment = await db.get('SELECT reference, student_name, amount, status, mtn_transaction_id FROM payments WHERE reference = ?', req.params.ref);
  if (!payment) return res.status(404).json({ error: "Not found" });
  res.json(payment);
});

app.get("/api/admin/payments", checkAdmin, async (req, res) => {
  const search = req.query.search || '';
  const status = req.query.status || '';
  let query = `SELECT * FROM payments WHERE (student_name LIKE ? OR reference LIKE ? OR parent_phone LIKE ? OR mtn_transaction_id LIKE ?)`;
  let params = [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`];
  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }
  query += ` ORDER BY created_at DESC`;
  const payments = await db.all(query, params);
  res.json(payments);
});

app.get("/api/admin/stats", checkAdmin, async (req, res) => {
  const stats = await db.get(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'verified' THEN amount ELSE 0 END) as total_verified, SUM(CASE WHEN status = 'pending_verification' THEN 1 ELSE 0 END) as pending_count, SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) as verified_count FROM payments`);
  res.json(stats);
});

app.get("/api/admin/notifications", checkAdmin, async (req, res) => {
  const logs = await db.all('SELECT * FROM notification_logs ORDER BY sent_at DESC LIMIT 50');
  res.json(logs);
});

app.get("/api/admin/export", checkAdmin, async (req, res) => {
  const payments = await db.all('SELECT * FROM payments ORDER BY created_at DESC');
  let csv = 'Reference,Student Name,Class,Parent Phone,Amount,Transaction ID,Method,Status,Date,Confirmed At,Verified At,Notes\n';
  payments.forEach(p => {
    csv += `${p.reference},"${p.student_name}",${p.student_class},${p.parent_phone},${p.amount},${p.mtn_transaction_id || ''},${p.payment_method},${p.status},${p.created_at},${p.parent_confirmed_at || ''},${p.verified_at || ''},"${p.admin_notes || ''}"\n`;
  });
  res.header('Content-Type', 'text/csv');
  res.attachment('payments.csv');
  res.send(csv);
});

app.delete("/api/admin/payment/:ref", checkAdmin, async (req, res) => {
  await db.run('DELETE FROM payments WHERE reference = ?', req.params.ref);
  res.json({ success: true });
});

app.post("/api/admin/test-notification", checkAdmin, async (req, res) => {
  const config = getConfig();
  const result = await sendNotification(`Test from ${config.school_name}. System working!`, 'test', 'Test');
  res.json(result);
});

app.get("/api/receipt/:ref", async (req, res) => {
  const payment = await db.get('SELECT * FROM payments WHERE reference = ?', req.params.ref);
  if (!payment) return res.status(404).json({ error: "Not found" });
  const config = getConfig();
  res.json({ ...payment, school: config.school_name, school_address: config.school_address, receipt_footer: config.receipt_footer });
});

app.get("/api/receipt-pdf/:ref", async (req, res) => {
  const payment = await db.get('SELECT * FROM payments WHERE reference = ?', req.params.ref);
  if (!payment || payment.status !== 'verified') return res.status(404).json({ error: "Receipt not available" });
  const config = getConfig();
  
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=Receipt-${payment.reference}.pdf`);
  doc.pipe(res);
  
  await drawDocumentHeader(doc, config);
  
  const blue = config.primary_color || '#2c5aa0';
  doc.fillColor(blue).fontSize(16).text('OFFICIAL FEES RECEIPT', { align: 'center', underline: true });
  doc.moveDown();
  
  doc.fillColor('black').fontSize(12);
  doc.text(`Receipt No: ${payment.reference}`, 50);
  doc.text(`Date: ${new Date(payment.verified_at || payment.created_at).toLocaleDateString('en-GB')}`, 50);
  doc.moveDown();
  
  doc.text(`Student Name: ${payment.student_name}`, 50);
  doc.text(`Class: ${payment.student_class}`, 50);
  doc.text(`Parent Phone: ${payment.parent_phone}`, 50);
  doc.moveDown();
  
  doc.fillColor(blue).fontSize(14).text(`Amount Paid: UGX ${payment.amount.toLocaleString()}`, 50, doc.y, { underline: true });
  doc.fillColor('black').fontSize(12);
  doc.text(`Payment Method: Mobile Money`, 50);
  doc.text(`Transaction ID: ${payment.mtn_transaction_id}`, 50);
  doc.moveDown(3);
  
  doc.text(config.signature_name || 'Bursar', 400, doc.y, { align: 'right' });
  doc.moveTo(400, doc.y).lineTo(550, doc.y).stroke();
  doc.text(config.signature_title || 'Authorized Signature', 400, doc.y + 5, { align: 'right' });
  
  drawDocumentFooter(doc, config);
  doc.end();
});

app.get("/api/parent/payments/:phone", async (req, res) => {
  const phone = req.params.phone;
  const payments = await db.all('SELECT reference, student_name, student_class, amount, status, mtn_transaction_id, verified_at, created_at FROM payments WHERE parent_phone = ? ORDER BY created_at DESC', phone);
  const totalPaid = payments.filter(p => p.status === 'verified').reduce((sum, p) => sum + p.amount, 0);
  res.json({ payments, totalPaid, phone });
});

app.post("/api/admin/login", (req, res) => {
  const config = getConfig();
  if (!config.admin_password_enabled) return res.json({ success: true });
  if (req.body.password === config.admin_password) {
    res.cookie("admin_auth", config.admin_password, { httpOnly: true });
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Wrong password" });
  }
});

app.post("/api/admin/logout", (req, res) => {
  res.clearCookie("admin_auth");
  res.json({ success: true });
});

app.get("/api/admin/config", checkAdmin, (req, res) => {
  res.json(getConfig());
});

app.post("/api/admin/config", checkAdmin, (req, res) => {
  const config = getConfig();
  Object.assign(config, req.body);
  saveConfig(config);
  res.json({ success: true });
});

app.get("/api/admin/auth-required", (req, res) => {
  res.json({ required: getConfig().admin_password_enabled });
});

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.get("/admin", (req, res) => res.sendFile(join(__dirname, "public", "admin.html")));
app.get("/receipt/:ref", (req, res) => res.sendFile(join(__dirname, "public", "receipt.html")));
app.get("/report", (req, res) => res.sendFile(join(__dirname, "public", "report.html")));
app.get("/parent", (req, res) => res.sendFile(join(__dirname, "public", "parent.html")));
app.get("/", (req, res) => res.sendFile(join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`? SERVER RUNNING on http://127.0.0.1:${PORT}`);
});
app.get("/api/admin/class-report/:class", checkAdmin, async (req, res) => {
  const className = req.params.class;
  const payments = await db.all(`
    SELECT student_name, parent_phone, SUM(CASE WHEN status='verified' THEN amount ELSE 0 END) as total_paid,
           GROUP_CONCAT(mtn_transaction_id) as txids, MAX(verified_at) as last_payment
    FROM payments 
    WHERE student_class = ? 
    GROUP BY student_name, parent_phone 
    ORDER BY student_name
  `, className);
  
  const totalExpected = payments.length * 50000; // Change 50000 to your term fee
  const totalCollected = payments.reduce((sum, p) => sum + p.total_paid, 0);
  
  res.json({ 
    class: className, 
    students: payments, 
    totalExpected, 
    totalCollected,
    totalUnpaid: totalExpected - totalCollected,
    paidCount: payments.filter(p => p.total_paid > 0).length,
    unpaidCount: payments.filter(p => p.total_paid === 0).length
  });
});

app.get("/api/admin/class-report-pdf/:class", checkAdmin, async (req, res) => {
  const className = req.params.class;
  const config = getConfig();
  const report = await db.all(`
    SELECT student_name, parent_phone, SUM(CASE WHEN status='verified' THEN amount ELSE 0 END) as total_paid
    FROM payments WHERE student_class = ? GROUP BY student_name, parent_phone ORDER BY student_name
  `, className);
  
  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=Class-Report-${className}.pdf`);
  doc.pipe(res);
  
  await drawDocumentHeader(doc, config);
  const blue = config.primary_color || '#2c5aa0';
  
  doc.fillColor(blue).fontSize(14).text(`CLASS FEES REPORT - ${className.toUpperCase()}`, { align: 'center', underline: true });
  doc.moveDown();
  
  doc.fillColor('black').fontSize(10);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')}`, 50);
  doc.moveDown();
  
  // Table Header
  doc.fillColor(blue).fontSize(9);
  doc.text('No.', 50, doc.y, { width: 30 });
  doc.text('Student Name', 85, doc.y - 12, { width: 200 });
  doc.text('Parent Phone', 290, doc.y - 12, { width: 100 });
  doc.text('Amount Paid', 395, doc.y - 12, { width: 80 });
  doc.text('Balance', 480, doc.y - 12, { width: 80 });
  doc.text('Status', 565, doc.y - 12, { width: 60 });
  doc.moveTo(50, doc.y).lineTo(650, doc.y).stroke();
  doc.moveDown(0.5);
  
  // Table Rows
  const termFee = 50000; // Change this to your term fee
  let totalPaid = 0;
  doc.fillColor('black').fontSize(8);
  
  report.forEach((s, i) => {
    const balance = termFee - s.total_paid;
    const status = s.total_paid >= termFee ? 'CLEARED' : s.total_paid > 0 ? 'PARTIAL' : 'UNPAID';
    totalPaid += s.total_paid;
    
    if (doc.y > 500) { doc.addPage(); doc.y = 50; }
    
    doc.text(i + 1, 50, doc.y, { width: 30 });
    doc.text(s.student_name, 85, doc.y - 10, { width: 200 });
    doc.text(s.parent_phone, 290, doc.y - 10, { width: 100 });
    doc.text(s.total_paid.toLocaleString(), 395, doc.y - 10, { width: 80 });
    doc.text(balance.toLocaleString(), 480, doc.y - 10, { width: 80 });
    doc.fillColor(status === 'CLEARED' ? 'green' : status === 'PARTIAL' ? 'orange' : 'red');
    doc.text(status, 565, doc.y - 10, { width: 60 });
    doc.fillColor('black');
    doc.moveDown(0.3);
  });
  
  doc.moveDown();
  doc.fillColor(blue).fontSize(10);
  doc.text(`Total Students: ${report.length} | Total Collected: UGX ${totalPaid.toLocaleString()} | Expected: UGX ${(report.length * termFee).toLocaleString()}`, 50);
  
  drawDocumentFooter(doc, config);
  doc.end();
});

app.get("/class-report", (req, res) => res.sendFile(join(__dirname, "public", "class-report.html")));
