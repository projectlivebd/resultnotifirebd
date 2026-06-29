'use strict';

const axios = require('axios');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const logFile = path.join(logsDir, `check-${new Date().toISOString().split('T')[0]}.log`);

function log(level, msg, data = null) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}${data ? ' | ' + JSON.stringify(data) : ''}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}
const logInfo  = (m, d) => log('INFO', m, d);
const logOk    = (m, d) => log('OK',   m, d);
const logWarn  = (m, d) => log('WARN', m, d);
const logError = (m, d) => log('ERR',  m, d);

const CONFIG = {
  firebase: {
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },
  smtp: {
    host:     process.env.SMTP_HOST || 'smtp.gmail.com',
    port:     parseInt(process.env.SMTP_PORT || '587'),
    user:     process.env.SMTP_USER,
    pass:     process.env.SMTP_PASS,
    fromName: process.env.FROM_NAME || 'RESULTNOTIFIREBD',
  },
  dryRun: process.argv.includes('--dry-run'),
};

const BOARD_MAP = {
  dhaka:'dhaka', rajshahi:'rajshahi', chittagong:'chittagong',
  comilla:'comilla', sylhet:'sylhet', jessore:'jessore',
  barisal:'barisal', dinajpur:'dinajpur', mymensingh:'mymensingh',
  madrasah:'madrasah', technical:'technical',
};

const EXAM_MAP = {
  'SSC':'ssc', 'Dakhil':'dakhil', 'HSC':'hsc',
  'Alim':'alim', 'JSC':'jsc', 'JDC':'jdc', 'Diploma':'ssc_voc',
};

function initFirebase() {
  if (admin.apps.length > 0) return admin.firestore();
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   CONFIG.firebase.projectId,
      clientEmail: CONFIG.firebase.clientEmail,
      privateKey:  CONFIG.firebase.privateKey,
    }),
  });
  logInfo('Firebase initialized');
  return admin.firestore();
}

async function fetchResult(student) {
  const board = BOARD_MAP[student.board] || student.board;
  const exam  = EXAM_MAP[student.exam]   || student.exam.toLowerCase();

  try {
    const response = await axios.get(
      'https://eboardresults.com/app/stud/api/get_result',
      {
        params: {
          exam:  exam,
          year:  student.year,
          board: board,
          roll:  student.roll,
          reg:   student.reg,
          type:  'individual',
        },
        timeout: 20000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept':     'application/json',
          'Referer':    'https://eboardresults.com/v2/home',
        },
      }
    );

    logInfo(`API response Roll ${student.roll}`, {
      status: response.status,
      data: JSON.stringify(response.data).slice(0, 300),
    });

    return { success: true, data: response.data };

  } catch(err) {
    if (err.response?.status === 404) return { success: true, data: null };
    return { success: false, error: `${err.message} (status: ${err.response?.status})` };
  }
}

function parseResult(data) {
  if (!data) return null;
  if (data.error || data.status === 'error' ||
      data.result === 'not_found' || data.message === 'not found' ||
      data.code === 404) return null;

  const grade = data.grade || data.Grade || data.GRADE || null;
  const gpa   = data.gpa   || data.GPA   || data.point || null;
  const name  = data.name  || data.Name  || data.student_name || '';

  if (!grade && !gpa) return null;

  return {
    name,
    grade,
    gpa,
    passed: grade !== 'F',
    status: grade === 'F' ? 'FAILED' : 'PASSED',
  };
}

function buildEmail({ name, exam, year, board, roll, reg, grade, gpa, passed }) {
  const color        = passed ? '#22c55e' : '#ef4444';
  const boardDisplay = board.charAt(0).toUpperCase() + board.slice(1) + ' Board';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f0f4fe;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:600px;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.1);">
<tr><td style="background:linear-gradient(135deg,#132257,#0f3d25);padding:40px;text-align:center;">
  <div style="font-size:40px;">🎓</div>
  <h1 style="margin:8px 0 0;color:#fff;font-size:22px;">RESULTNOTIFIREBD</h1>
  <p style="margin:4px 0 0;color:rgba(255,255,255,.5);font-size:13px;">Instant Exam Result Notification</p>
</td></tr>
<tr><td style="background:${color}18;border-left:4px solid ${color};padding:20px 40px;text-align:center;">
  <p style="margin:0;font-size:20px;font-weight:800;color:${color};">
    ${passed ? '🎉 Congratulations! You Passed!' : '📋 Result Published'}
  </p>
  <p style="margin:4px 0 0;color:#6b7280;font-size:14px;">${exam} ${year} — ${boardDisplay}</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="color:#374151;">Dear <strong>${name || 'Student'}</strong>,</p>
  <p style="color:#6b7280;font-size:14px;line-height:1.6;">
    Your <strong>${exam} ${year}</strong> result from <strong>${boardDisplay}</strong> has been published.
  </p>
  <table width="100%" style="background:#f8faff;border-radius:16px;margin-bottom:24px;">
    <tr style="background:#f0f4fe;">
      <td style="padding:12px 20px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;">Field</td>
      <td style="padding:12px 20px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;">Details</td>
    </tr>
    <tr><td style="padding:13px 20px;font-size:13px;color:#6b7280;">Student Name</td>
        <td style="padding:13px 20px;font-size:13px;font-weight:600;">${name || '—'}</td></tr>
    <tr style="background:#fff;">
        <td style="padding:13px 20px;font-size:13px;color:#6b7280;">Examination</td>
        <td style="padding:13px 20px;font-size:13px;font-weight:600;">${exam} ${year}</td></tr>
    <tr><td style="padding:13px 20px;font-size:13px;color:#6b7280;">Board</td>
        <td style="padding:13px 20px;font-size:13px;font-weight:600;">${boardDisplay}</td></tr>
    <tr style="background:#fff;">
        <td style="padding:13px 20px;font-size:13px;color:#6b7280;">Roll Number</td>
        <td style="padding:13px 20px;font-size:13px;font-weight:600;font-family:monospace;">${roll}</td></tr>
    <tr><td style="padding:13px 20px;font-size:13px;color:#6b7280;">Result</td>
        <td style="padding:13px 20px;font-size:13px;font-weight:600;">${passed ? '✅ Passed' : '❌ Failed'}</td></tr>
    <tr style="background:#fff;">
        <td style="padding:13px 20px;font-size:13px;color:#6b7280;">Grade</td>
        <td style="padding:13px 20px;font-size:13px;font-weight:600;color:${color};">${grade || '—'}</td></tr>
    <tr><td style="padding:13px 20px;font-size:13px;color:#6b7280;">GPA</td>
        <td style="padding:13px 20px;font-size:13px;font-weight:600;color:${color};">${gpa ? gpa + ' / 5.00' : '—'}</td></tr>
  </table>
  <div style="text-align:center;background:${color}12;border:2px solid ${color}40;border-radius:20px;padding:28px;margin-bottom:24px;">
    <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">Your GPA</p>
    <p style="margin:0;font-size:52px;font-weight:900;color:${color};line-height:1;">${gpa || '—'}</p>
    <p style="margin:6px 0 0;font-size:20px;font-weight:700;color:${color};">Grade: ${grade || '—'}</p>
  </div>
  <div style="text-align:center;margin-bottom:24px;">
    <a href="https://eboardresults.com/v2/home"
       style="display:inline-block;padding:16px 40px;background:linear-gradient(135deg,#2f83fc,#1a62f1);color:#fff;text-decoration:none;border-radius:14px;font-weight:700;">
      View Full Result →
    </a>
  </div>
  <p style="color:#9ca3af;font-size:12px;text-align:center;">
    Sent by <strong>RESULTNOTIFIREBD</strong> — Automated result alert.
  </p>
</td></tr>
<tr><td style="background:#f9fafb;padding:20px;text-align:center;border-top:1px solid #f3f4f6;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">© ${new Date().getFullYear()} RESULTNOTIFIREBD</p>
</td></tr>
</table></td></tr></table>
</body></html>`;
}

async function sendEmail(student, result) {
  if (CONFIG.dryRun) { logInfo('[DRY RUN] Email skipped'); return; }
  const t = nodemailer.createTransport({
    host: CONFIG.smtp.host, port: CONFIG.smtp.port,
    secure: CONFIG.smtp.port === 465,
    auth: { user: CONFIG.smtp.user, pass: CONFIG.smtp.pass },
  });
  await t.sendMail({
    from:    `"${CONFIG.smtp.fromName}" <${CONFIG.smtp.user}>`,
    to:      student.email,
    subject: `🎉 ${student.exam} ${student.year} Result Published — RESULTNOTIFIREBD`,
    html:    buildEmail({
      name:   result.name  || student.name,
      exam:   student.exam,   year:  student.year,
      board:  student.board,  roll:  student.roll,
      reg:    student.reg,    grade: result.grade,
      gpa:    result.gpa,     passed: result.passed,
    }),
  });
}

function validateConfig() {
  const missing = [];
  if (!CONFIG.firebase.projectId)   missing.push('FIREBASE_PROJECT_ID');
  if (!CONFIG.firebase.clientEmail)  missing.push('FIREBASE_CLIENT_EMAIL');
  if (!CONFIG.firebase.privateKey)   missing.push('FIREBASE_PRIVATE_KEY');
  if (!CONFIG.smtp.user)             missing.push('SMTP_USER');
  if (!CONFIG.smtp.pass)             missing.push('SMTP_PASS');
  if (missing.length) {
    logError('Missing env vars', { missing });
    process.exit(1);
  }
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  logInfo('=== RESULTNOTIFIREBD Check Started ===');
  validateConfig();
  const db = initFirebase();

  const snap = await db.collection('students')
    .where('notified', '==', false).get();

  if (snap.empty) { logInfo('No pending students.'); return; }
  logInfo(`Found ${snap.size} pending student(s)`);

  let checked = 0, found = 0, emailed = 0, errors = 0;

  for (const docSnap of snap.docs) {
    const student = { id: docSnap.id, ...docSnap.data() };
    logInfo(`Checking: ${student.name} | ${student.exam} ${student.year} | Roll: ${student.roll} | Board: ${student.board}`);

    try {
      const res = await fetchResult(student);
      checked++;

      if (!res.success) {
        logWarn(`Fetch failed: ${student.roll}`, { error: res.error });
        errors++;
        await db.collection('result_logs').add({
          studentId: student.id, studentName: student.name,
          roll: student.roll, exam: student.exam,
          year: student.year, board: student.board,
          apiSuccess: false, resultFound: false,
          error: res.error,
          checkedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await delay(1000);
        continue;
      }

      const result = parseResult(res.data);

      await db.collection('result_logs').add({
        studentId: student.id, studentName: student.name,
        roll: student.roll, exam: student.exam,
        year: student.year, board: student.board,
        apiSuccess: true, resultFound: !!result,
        checkedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (!result) {
        logInfo(`Not published yet: ${student.roll}`);
        await delay(800);
        continue;
      }

      found++;
      logOk(`Result found: ${student.name} | Grade: ${result.grade} | GPA: ${result.gpa}`);

      try {
        await sendEmail(student, result);
        emailed++;
        logOk(`Email sent to ${student.email}`);

        await db.collection('email_logs').add({
          studentId: student.id, studentName: student.name,
          email: student.email, exam: student.exam,
          year: student.year, board: student.board,
          roll: student.roll, grade: result.grade,
          gpa: result.gpa, success: true,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        if (!CONFIG.dryRun) {
          await docSnap.ref.update({
            notified: true, resultFound: true,
            resultData: {
              name:  result.name,
              grade: result.grade,
              gpa:   result.gpa,
              notifiedAt: new Date().toISOString(),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          logOk(`Student updated: ${student.name}`);
        }

      } catch(emailErr) {
        logError(`Email failed: ${student.email}`, { error: emailErr.message });
        errors++;
      }

    } catch(err) {
      logError(`Error: ${student.roll}`, { error: err.message });
      errors++;
    }

    await delay(1500);
  }

  logInfo(`=== DONE | Checked:${checked} Found:${found} Emailed:${emailed} Errors:${errors} ===`);
}

main().catch(err => {
  logError('Fatal', { error: err.message });
  process.exit(1);
});
