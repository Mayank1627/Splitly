const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '.env') });

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

    console.log(`Executing SQL script as a single batch...`);
    await connection.query(sqlContent);

    console.log('Database schema and seed data loaded successfully!');
  } catch (err) {
    console.error('Failed to initialize database:', err);
  } finally {
    await connection.end();
  }
}

run();
