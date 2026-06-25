const initSqlJs = require("sql.js");
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "todo.db");

let _wrapper = null;
let _rawDb = null;

function saveToDisk() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from(_rawDb.export()));
}

// Wrapper — mimics better-sqlite3 prepare().get/all/run
class Stmt {
  constructor(db, sql) { this._db = db; this._sql = sql; }
  get(...p) {
    const s = this._db.prepare(this._sql);
    if (p.length) s.bind(p);
    const row = s.step() ? s.getAsObject() : undefined;
    s.free(); return row;
  }
  all(...p) {
    const s = this._db.prepare(this._sql);
    if (p.length) s.bind(p);
    const rows = [];
    while (s.step()) rows.push(s.getAsObject());
    s.free(); return rows;
  }
  run(...p) {
    if (p.length) this._db.run(this._sql, p);
    else this._db.run(this._sql);
    const r = this._db.exec("SELECT last_insert_rowid() AS id");
    saveToDisk();
    return { lastInsertRowid: r.length ? r[0].values[0][0] : 0, changes: this._db.getRowsModified() };
  }
}

async function initDB() {
  fs.mkdirSync(dataDir, { recursive: true });
  const SQL = await initSqlJs();
  _rawDb = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  _rawDb.run("PRAGMA foreign_keys = ON");

  _rawDb.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  _rawDb.run(`CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL REFERENCES users(id),
    text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
    is_shared INTEGER NOT NULL DEFAULT 0, list_name TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  _rawDb.run(`CREATE TABLE IF NOT EXISTS todo_members (
    todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    permission TEXT NOT NULL DEFAULT 'write',
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (todo_id, user_id))`);
  _rawDb.run(`CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    inviter_id INTEGER NOT NULL REFERENCES users(id),
    invitee_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);

  saveToDisk();

  _wrapper = { prepare: (sql) => new Stmt(_rawDb, sql), exec: (sql) => { _rawDb.run(sql); saveToDisk(); } };

  console.log("[db] SQLite ready at", dbPath);
  return _wrapper;
}

module.exports = { initDB, getDB: () => _wrapper };
