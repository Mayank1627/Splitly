const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
  console.log('Initializing MySQL Database connection...');
  // Connect without specifying database first, to ensure database can be created
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  });

  try {
    const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
    console.log(`Reading schema script from: ${schemaPath}`);
    const sqlContent = fs.readFileSync(schemaPath, 'utf8');

    // Split SQL into individual statements, filtering out empty lines or comments
    const statements = sqlContent
      .split(/;\r?\n/)
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    console.log(`Executing ${statements.length} SQL statements...`);
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (stmt.toUpperCase().startsWith('USE ')) {
        // Run USE query directly
        await connection.query(stmt);
      } else {
        await connection.query(stmt);
      }
    }

    console.log('Database schema and seed data loaded successfully!');
  } catch (err) {
    console.error('Failed to initialize database:', err);
  } finally {
    await connection.end();
  }
}

run();
