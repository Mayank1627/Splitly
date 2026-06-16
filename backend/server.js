const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Set up upload directory
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
const upload = multer({ dest: uploadDir });

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'splitlysecretkey123!@#';

// Middleware to authenticate JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token missing' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Helper: Convert User Name to ID
const getUserMap = async () => {
  const [users] = await db.query('SELECT id, name FROM users');
  const nameToId = {};
  const idToName = {};
  users.forEach(u => {
    nameToId[u.name.toLowerCase()] = u.id;
    idToName[u.id] = u.name;
  });
  return { nameToId, idToName };
};

// ----------------------------------------------------
// AUTH ENDPOINTS
// ----------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Please provide email and password' });
  }

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = rows[0];
    // Compare password hash
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Sign JWT
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ----------------------------------------------------
// IMPORT ENDPOINTS (Ingestion)
// ----------------------------------------------------
app.post('/api/import/upload', upload.single('csvFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No CSV file uploaded' });
  }

  const csvPath = req.file.path;

  try {
    // 1. Fetch group memberships to pass to the Python parser
    const [members] = await db.query(`
      SELECT u.name, gm.joined_at, gm.left_at 
      FROM group_memberships gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = 1
    `);

    const membershipsJson = {};
    members.forEach(m => {
      membershipsJson[m.name] = {
        joined_at: m.joined_at.toISOString().split('T')[0],
        left_at: m.left_at ? m.left_at.toISOString().split('T')[0] : null
      };
    });

    // 2. Fetch User IDs mapping for db insertions
    const { nameToId } = await getUserMap();

    // 3. Execute python parser script
    const pythonScript = path.join(__dirname, '..', 'parser.py');
    const escapedMemberships = JSON.stringify(membershipsJson).replace(/"/g, '\\"');
    const command = `python "${pythonScript}" "${csvPath}" "${escapedMemberships}"`;

    exec(command, async (error, stdout, stderr) => {
      // Clean up uploaded file
      try { fs.unlinkSync(csvPath); } catch (e) {}

      if (error) {
        console.error('Python execution error:', error);
        console.error('stderr:', stderr);
        return res.status(500).json({ error: 'Error executing parser script: ' + stderr });
      }

      let parsedResult;
      try {
        parsedResult = JSON.parse(stdout);
      } catch (e) {
        console.error('JSON parse error on stdout:', stdout);
        return res.status(500).json({ error: 'Failed to parse engine output: ' + e.message });
      }

      if (parsedResult.error) {
        return res.status(400).json({ error: parsedResult.error });
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        // A. Insert Import Report
        const [reportRes] = await connection.query(`
          INSERT INTO import_reports (total_rows, clean_rows, anomalies_found)
          VALUES (?, ?, ?)
        `, [
          parsedResult.total_rows,
          parsedResult.clean_rows.length,
          parsedResult.anomalies.length
        ]);
        const reportId = reportRes.insertId;

        // B. Insert Clean Rows
        const insertedClean = [];
        for (const row of parsedResult.clean_rows) {
          if (row.is_settlement) {
            // Direct settlement
            const payerId = nameToId[row.settlement_payer.toLowerCase()];
            const payeeId = nameToId[row.settlement_payee.toLowerCase()];
            
            await connection.query(`
              INSERT INTO settlements (group_id, payer_id, payee_id, amount, date)
              VALUES (1, ?, ?, ?, ?)
            `, [payerId, payeeId, row.raw_amount, row.date]);
            
            insertedClean.push({ type: 'settlement', description: row.description, amount: row.raw_amount });
          } else {
            // Expense
            const payerId = nameToId[row.paid_by.toLowerCase()];
            
            const [expRes] = await connection.query(`
              INSERT INTO expenses (group_id, paid_by_id, amount, currency, exchange_rate, description, date)
              VALUES (1, ?, ?, ?, ?, ?, ?)
            `, [payerId, row.raw_amount, row.currency, row.exchange_rate, row.description, row.date]);
            const expenseId = expRes.insertId;

            // Insert expense splits
            for (const [splitUser, splitAmt] of Object.entries(row.splits)) {
              const splitUserId = nameToId[splitUser.toLowerCase()];
              await connection.query(`
                INSERT INTO expense_splits (expense_id, user_id, amount_owed, split_type, split_value)
                VALUES (?, ?, ?, ?, ?)
              `, [expenseId, splitUserId, splitAmt, row.split_type, null]);
            }
            
            insertedClean.push({ type: 'expense', description: row.description, amount: row.amount_inr });
          }
        }

        // C. Insert Anomalous Rows
        for (const anomaly of parsedResult.anomalies) {
          await connection.query(`
            INSERT INTO ingestion_anomalies (import_report_id, raw_csv_row_data, detected_issue_type, fixed_json_payload, resolution_status)
            VALUES (?, ?, ?, ?, 'PENDING')
          `, [
            reportId,
            anomaly.raw_row_string,
            anomaly.issues.join('; '),
            JSON.stringify(anomaly.fixed_json_payload)
          ]);
        }

        await connection.commit();
        res.json({
          message: 'CSV file processed successfully.',
          reportId,
          totalRows: parsedResult.total_rows,
          cleanCount: parsedResult.clean_rows.length,
          anomalyCount: parsedResult.anomalies.length,
          insertedClean
        });
      } catch (txErr) {
        await connection.rollback();
        console.error('Transaction rollback error:', txErr);
        res.status(500).json({ error: 'Database transaction error: ' + txErr.message });
      } finally {
        connection.release();
      }
    });

  } catch (error) {
    console.error('Upload route error:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ----------------------------------------------------
// BALANCES & SIMPLIFICATION ENDPOINT (Aisha's Request)
// ----------------------------------------------------
app.get('/api/groups/:id/balances', async (req, res) => {
  const groupId = req.params.id;

  try {
    const [users] = await db.query('SELECT id, name FROM users');
    const balances = {};
    users.forEach(u => {
      balances[u.id] = {
        id: u.id,
        name: u.name,
        paid_expenses: 0,
        owed_splits: 0,
        paid_settlements: 0,
        received_settlements: 0,
        net: 0
      };
    });

    // 1. Total paid by each user as payer
    const [paidExp] = await db.query(`
      SELECT paid_by_id, SUM(amount * exchange_rate) as total
      FROM expenses
      WHERE group_id = ?
      GROUP BY paid_by_id
    `, [groupId]);
    paidExp.forEach(r => {
      if (balances[r.paid_by_id]) {
        balances[r.paid_by_id].paid_expenses = parseFloat(r.total || 0);
      }
    });

    // 2. Total owed by each user in splits
    const [owedSpl] = await db.query(`
      SELECT es.user_id, SUM(es.amount_owed) as total
      FROM expense_splits es
      JOIN expenses e ON es.expense_id = e.id
      WHERE e.group_id = ?
      GROUP BY es.user_id
    `, [groupId]);
    owedSpl.forEach(r => {
      if (balances[r.user_id]) {
        balances[r.user_id].owed_splits = parseFloat(r.total || 0);
      }
    });

    // 3. Total paid by each user in settlements
    const [paidSet] = await db.query(`
      SELECT payer_id, SUM(amount) as total
      FROM settlements
      WHERE group_id = ?
      GROUP BY payer_id
    `, [groupId]);
    paidSet.forEach(r => {
      if (balances[r.payer_id]) {
        balances[r.payer_id].paid_settlements = parseFloat(r.total || 0);
      }
    });

    // 4. Total received by each user in settlements
    const [recSet] = await db.query(`
      SELECT payee_id, SUM(amount) as total
      FROM settlements
      WHERE group_id = ?
      GROUP BY payee_id
    `, [groupId]);
    recSet.forEach(r => {
      if (balances[r.payee_id]) {
        balances[r.payee_id].received_settlements = parseFloat(r.total || 0);
      }
    });

    // Compute nets
    const netList = [];
    for (const id in balances) {
      const b = balances[id];
      b.net = b.paid_expenses - b.owed_splits + b.paid_settlements - b.received_settlements;
      // Round to 2 decimals
      b.net = Math.round(b.net * 100) / 100;
      netList.push({ ...b });
    }

    // Aisha's Transaction Minimization Algorithm (Min-Flow / Greedy Match)
    const debtors = netList
      .filter(u => u.net < -0.01)
      .map(u => ({ ...u, net: u.net }));
    const creditors = netList
      .filter(u => u.net > 0.01)
      .map(u => ({ ...u, net: u.net }));

    const transactions = [];

    // Sort helper
    const sortDebtors = () => debtors.sort((a, b) => a.net - b.net); // Ascending (largest negative first)
    const sortCreditors = () => creditors.sort((a, b) => b.net - a.net); // Descending (largest positive first)

    sortDebtors();
    sortCreditors();

    while (debtors.length > 0 && creditors.length > 0) {
      const d = debtors[0];
      const c = creditors[0];

      const amountToSettle = Math.min(Math.abs(d.net), c.net);
      const roundedAmount = Math.round(amountToSettle * 100) / 100;

      if (roundedAmount > 0) {
        transactions.push({
          from: d.name,
          fromId: d.id,
          to: c.name,
          toId: c.id,
          amount: roundedAmount
        });
      }

      d.net += roundedAmount;
      c.net -= roundedAmount;

      if (Math.abs(d.net) < 0.01) {
        debtors.shift();
      }
      if (Math.abs(c.net) < 0.01) {
        creditors.shift();
      }

      sortDebtors();
      sortCreditors();
    }

    res.json({
      balances: netList,
      simplifiedDebts: transactions
    });

  } catch (error) {
    console.error('Fetch balances error:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ----------------------------------------------------
// AUDIT LEDGER ENDPOINT (Rohan's Request)
// ----------------------------------------------------
app.get('/api/users/:id/audit', async (req, res) => {
  const userId = req.params.id;

  try {
    const [userRows] = await db.query('SELECT name FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userName = userRows[0].name;

    // A. Fetch all expenses paid by the user
    const [expensesPaid] = await db.query(`
      SELECT id, description, amount, currency, exchange_rate, date, 'payment' as entry_type
      FROM expenses
      WHERE paid_by_id = ?
      ORDER BY date ASC
    `, [userId]);

    // B. Fetch all expense splits where the user owed
    const [splitsOwed] = await db.query(`
      SELECT e.id as expense_id, e.description, e.amount as total_amount, e.currency, e.exchange_rate, 
             es.amount_owed, e.date, u.name as paid_by, 'split' as entry_type
      FROM expense_splits es
      JOIN expenses e ON es.expense_id = e.id
      JOIN users u ON e.paid_by_id = u.id
      WHERE es.user_id = ?
      ORDER BY e.date ASC
    `, [userId]);

    // C. Fetch all settlements where the user is payer or payee
    const [settlements] = await db.query(`
      SELECT s.id, s.amount, s.date, u1.name as payer, u2.name as payee, s.payer_id, s.payee_id, 'settlement' as entry_type
      FROM settlements s
      JOIN users u1 ON s.payer_id = u1.id
      JOIN users u2 ON s.payee_id = u2.id
      WHERE s.payer_id = ? OR s.payee_id = ?
      ORDER BY s.date ASC
    `, [userId, userId]);

    // D. Compile ledger in chronological order
    const ledger = [];

    expensesPaid.forEach(e => {
      const valueInr = parseFloat(e.amount) * parseFloat(e.exchange_rate);
      ledger.push({
        id: `exp-pay-${e.id}`,
        date: e.date.toISOString().split('T')[0],
        type: 'PAYMENT',
        description: `Paid for: ${e.description} (${e.amount} ${e.currency})`,
        effect: valueInr, // positive impact on their net balance
        total: parseFloat(e.amount),
        currency: e.currency,
        rate: parseFloat(e.exchange_rate)
      });
    });

    splitsOwed.forEach(s => {
      ledger.push({
        id: `split-${s.expense_id}`,
        date: s.date.toISOString().split('T')[0],
        type: 'OWED_SHARE',
        description: `Owed share of: ${s.description} (Paid by ${s.paid_by})`,
        effect: -parseFloat(s.amount_owed), // negative impact
        total: parseFloat(s.total_amount),
        currency: s.currency,
        rate: parseFloat(s.exchange_rate)
      });
    });

    settlements.forEach(s => {
      const isPayer = s.payer_id == userId;
      const desc = isPayer 
        ? `Settled debt: paid ${s.payee}`
        : `Received settlement: paid by ${s.payer}`;
        
      ledger.push({
        id: `set-${s.id}`,
        date: s.date.toISOString().split('T')[0],
        type: isPayer ? 'SETTLEMENT_PAID' : 'SETTLEMENT_RECEIVED',
        description: desc,
        effect: isPayer ? parseFloat(s.amount) : -parseFloat(s.amount), // paying debt increases balance; receiving reduces it
        total: parseFloat(s.amount),
        currency: 'INR',
        rate: 1.0
      });
    });

    // Sort ledger by date, then by type to ensure stable chronological auditing
    ledger.sort((a, b) => {
      if (a.date !== b.date) {
        return a.date.localeCompare(b.date);
      }
      return a.id.localeCompare(b.id);
    });

    // Calculate running balance
    let runningBalance = 0;
    const auditedLedger = ledger.map(entry => {
      runningBalance += entry.effect;
      return {
        ...entry,
        running_balance: Math.round(runningBalance * 100) / 100
      };
    });

    res.json({
      userId,
      userName,
      currentNetBalance: Math.round(runningBalance * 100) / 100,
      ledger: auditedLedger
    });

  } catch (error) {
    console.error('User audit ledger error:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ----------------------------------------------------
// ANOMALIES ENDPOINTS (Meera's Request & Review UI)
// ----------------------------------------------------
app.get('/api/anomalies/pending', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, import_report_id, raw_csv_row_data, detected_issue_type, resolution_status, fixed_json_payload
      FROM ingestion_anomalies
      WHERE resolution_status = 'PENDING'
      ORDER BY id ASC
    `);
    
    // Parse json columns
    const formatted = rows.map(r => ({
      ...r,
      fixed_json_payload: typeof r.fixed_json_payload === 'string' 
        ? JSON.parse(r.fixed_json_payload) 
        : r.fixed_json_payload
    }));
    
    res.json(formatted);
  } catch (error) {
    console.error('Fetch pending anomalies error:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/anomalies/:id/resolve', async (req, res) => {
  const anomalyId = req.params.id;
  const { action, fixed_payload } = req.body; // action: 'APPROVE_MUTATED', 'KEEP_RAW', 'REJECT'

  if (!action || !['APPROVE_MUTATED', 'KEEP_RAW', 'REJECT'].includes(action)) {
    return res.status(400).json({ error: 'Invalid resolution action' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Verify anomaly is still pending
    const [anomRows] = await connection.query(
      'SELECT resolution_status FROM ingestion_anomalies WHERE id = ?',
      [anomalyId]
    );

    if (anomRows.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Anomaly not found' });
    }

    if (anomRows[0].resolution_status !== 'PENDING') {
      connection.release();
      return res.status(400).json({ error: 'Anomaly has already been resolved' });
    }

    const { nameToId } = await getUserMap();

    if (action === 'REJECT') {
      // Mark as rejected
      await connection.query(
        'UPDATE ingestion_anomalies SET resolution_status = "REJECTED" WHERE id = ?',
        [anomalyId]
      );
    } else {
      // APPROVE_MUTATED or KEEP_RAW
      const payload = fixed_payload;
      const isSettlement = payload.is_settlement;

      if (isSettlement) {
        // Resolve as settlement
        const payerId = nameToId[payload.settlement_payer.toLowerCase()];
        const payeeId = nameToId[payload.settlement_payee.toLowerCase()];

        await connection.query(`
          INSERT INTO settlements (group_id, payer_id, payee_id, amount, date)
          VALUES (1, ?, ?, ?, ?)
        `, [payerId, payeeId, payload.raw_amount, payload.date]);

      } else {
        // Resolve as expense
        const payerId = nameToId[payload.paid_by.toLowerCase()];

        const [expRes] = await connection.query(`
          INSERT INTO expenses (group_id, paid_by_id, amount, currency, exchange_rate, description, date)
          VALUES (1, ?, ?, ?, ?, ?, ?)
        `, [payerId, payload.raw_amount, payload.currency, payload.exchange_rate, payload.description, payload.date]);
        const expenseId = expRes.insertId;

        // Insert splits
        for (const [splitUser, splitAmt] of Object.entries(payload.splits)) {
          const splitUserId = nameToId[splitUser.toLowerCase()];
          await connection.query(`
            INSERT INTO expense_splits (expense_id, user_id, amount_owed, split_type, split_value)
            VALUES (?, ?, ?, ?, ?)
          `, [expenseId, splitUserId, splitAmt, payload.split_type, null]);
        }
      }

      // Mark anomaly as resolved
      const status = action === 'APPROVE_MUTATED' ? 'MUTATED' : 'RESOLVED';
      await connection.query(
        'UPDATE ingestion_anomalies SET resolution_status = ?, fixed_json_payload = ? WHERE id = ?',
        [status, JSON.stringify(payload), anomalyId]
      );
    }

    await connection.commit();
    res.json({ message: `Anomaly successfully resolved with action: ${action}` });
  } catch (error) {
    await connection.rollback();
    console.error('Resolve anomaly error:', error);
    res.status(500).json({ error: 'Failed to resolve anomaly: ' + error.message });
  } finally {
    connection.release();
  }
});

// Start server
app.listen(port, () => {
  console.log(`Splitly server running on port ${port}`);
});
