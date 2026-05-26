const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'code_breaker.db');

let db = null;
let SQL = null;
let saveTimer = null;

class Statement {
  constructor(sqlDb, sql) {
    this.sqlDb = sqlDb;
    this.sql = sql;
  }

  run(...params) {
    this.sqlDb.run(this.sql, params);
    return this;
  }

  get(...params) {
    const stmt = this.sqlDb.prepare(this.sql);
    if (params.length > 0) stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  }

  all(...params) {
    const stmt = this.sqlDb.prepare(this.sql);
    if (params.length > 0) stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }
}

function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error('Failed to save database:', err.message);
  }
}

async function initDb() {
  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS game_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level INTEGER NOT NULL,
      code TEXT NOT NULL,
      hints TEXT,
      encoded_data TEXT,
      xor_key INTEGER,
      charset TEXT,
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS guesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      level INTEGER NOT NULL,
      game_code_id INTEGER NOT NULL,
      guess TEXT NOT NULL,
      correct INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (game_code_id) REFERENCES game_codes(id)
    );

    CREATE TABLE IF NOT EXISTS points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      level INTEGER NOT NULL,
      points INTEGER DEFAULT 0,
      game_code_id INTEGER NOT NULL,
      earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (game_code_id) REFERENCES game_codes(id)
    );
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_guesses_user ON guesses(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_guesses_game ON guesses(game_code_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_points_user ON points(user_id)');

  try {
    db.run("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0");
  } catch (_) {}

  saveDb();

  if (saveTimer) clearInterval(saveTimer);
  saveTimer = setInterval(saveDb, 5000);

  process.on('exit', saveDb);
  process.on('SIGINT', () => { saveDb(); process.exit(); });
  process.on('SIGTERM', () => { saveDb(); process.exit(); });
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return {
    prepare: (sql) => new Statement(db, sql),
    run: (sql, params) => db.run(sql, params || []),
    exec: (sql) => db.exec(sql),
    save: saveDb,
  };
}

module.exports = { getDb, initDb };
