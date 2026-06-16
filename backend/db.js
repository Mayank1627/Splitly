const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'splitly',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Simple test query to verify connection
pool.query('SELECT 1')
  .then(() => console.log('Successfully connected to MySQL database.'))
  .catch(err => {
    console.error('Failed to connect to MySQL database:', err.message);
  });

module.exports = pool;
