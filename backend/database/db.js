const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const dbPath = process.env.DB_PATH 
  ? path.resolve(__dirname, '..', process.env.DB_PATH)
  : path.join(__dirname, '../data/disasterguard.db');

// Ensure parent data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize SQLite connection
const db = new Database(dbPath);

// Enable Write-Ahead Logging for better concurrent read/write performance
db.pragma('journal_mode = WAL');
// Enforce foreign key constraints
db.pragma('foreign_keys = ON');

// Initialize schema
function initSchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);
  }
}

initSchema();

module.exports = db;
