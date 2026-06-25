const { initDB, getDB } = require("./db");

(async () => {
  const db = await initDB();
  console.log("\n=== DB Test ===\n");

  // Tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  console.log("Tables:", tables.map(t => t.name).join(", "));

  // Insert
  const ts = Date.now();
  const r = db.prepare("INSERT INTO users (username, email, password) VALUES (?,?,?)")
    .run("test_" + ts, "test_" + ts + "@x.com", "pw");
  console.log("Inserted id:", r.lastInsertRowid);

  // Query
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(r.lastInsertRowid);
  console.log("Queried:", u.username, u.email);

  // Unique
  try {
    db.prepare("INSERT INTO users (username, email, password) VALUES (?,?,?)")
      .run("test_" + ts, "other@x.com", "pw");
  } catch (e) {
    console.log("Unique constraint: OK");
  }

  // Clean
  db.prepare("DELETE FROM users WHERE id = ?").run(r.lastInsertRowid);

  const counts = {};
  ["users","todos","todo_members","invitations"].forEach(t => {
    counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  });
  console.log("Counts:", counts);
  console.log("\n=== OK ===\n");
})();
