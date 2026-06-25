const { Router } = require("express");
const { getDB } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = Router();
router.use(requireAuth);

// ── Helpers ───────────────────────────────────────
function getAccess(todoId, userId) {
  const todo = getDB().prepare("SELECT owner_id FROM todos WHERE id = ?").get(todoId);
  if (!todo) return null;               // not found
  if (todo.owner_id === userId) return "owner";
  const m = getDB().prepare("SELECT permission FROM todo_members WHERE todo_id = ? AND user_id = ?").get(todoId, userId);
  return m ? m.permission : false;       // "read" | "write" | false (no access)
}

// ── CRUD ──────────────────────────────────────────
// GET /api/todos — my todos + shared with me
router.get("/", (req, res) => {
  const myTodos = getDB().prepare(
    "SELECT id, text, done, is_shared, list_name, owner_id, created_at FROM todos WHERE owner_id = ? ORDER BY created_at DESC"
  ).all(req.userId);

  const shared = getDB().prepare(`
    SELECT t.id, t.text, t.done, t.is_shared, t.list_name, t.owner_id, t.created_at, tm.permission, u.username AS owner_name
    FROM todos t
    JOIN todo_members tm ON tm.todo_id = t.id
    JOIN users u ON u.id = t.owner_id
    WHERE tm.user_id = ?
    ORDER BY t.created_at DESC
  `).all(req.userId);

  res.json({ todos: myTodos, shared });
});

// POST /api/todos
router.post("/", (req, res) => {
  const { text, list_name } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "内容不能为空" });

  const r = getDB().prepare(
    "INSERT INTO todos (owner_id, text, list_name) VALUES (?, ?, ?)"
  ).run(req.userId, text.trim(), list_name || null);

  const todo = getDB().prepare("SELECT * FROM todos WHERE id = ?").get(r.lastInsertRowid);
  res.status(201).json({ todo });
});

// PUT /api/todos/:id
router.put("/:id", (req, res) => {
  const perm = getAccess(req.params.id, req.userId);
  if (perm === null) return res.status(404).json({ error: "任务不存在" });
  if (perm === false || perm === "read") return res.status(403).json({ error: "无权修改此任务" });

  const { text, done } = req.body;
  const todo = getDB().prepare("SELECT * FROM todos WHERE id = ?").get(req.params.id);

  const newText = text !== undefined ? text.trim() : todo.text;
  const newDone = done !== undefined ? (done ? 1 : 0) : todo.done;

  getDB().prepare("UPDATE todos SET text = ?, done = ? WHERE id = ?")
    .run(newText, newDone, req.params.id);

  res.json({ todo: getDB().prepare("SELECT * FROM todos WHERE id = ?").get(req.params.id) });
});

// DELETE /api/todos/:id
router.delete("/:id", (req, res) => {
  const todo = getDB().prepare("SELECT owner_id FROM todos WHERE id = ?").get(req.params.id);
  if (!todo) return res.status(404).json({ error: "任务不存在" });
  if (todo.owner_id !== req.userId) return res.status(403).json({ error: "只有创建者可以删除" });

  getDB().prepare("DELETE FROM todos WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ── Sharing ───────────────────────────────────────
// PUT /api/todos/:id/share — toggle is_shared (owner only)
router.put("/:id/share", (req, res) => {
  const todo = getDB().prepare("SELECT * FROM todos WHERE id = ?").get(req.params.id);
  if (!todo) return res.status(404).json({ error: "任务不存在" });
  if (todo.owner_id !== req.userId) return res.status(403).json({ error: "只有创建者可以共享" });

  const newVal = todo.is_shared ? 0 : 1;
  getDB().prepare("UPDATE todos SET is_shared = ? WHERE id = ?").run(newVal, req.params.id);

  // If unsharing, remove all members
  if (!newVal) {
    getDB().prepare("DELETE FROM todo_members WHERE todo_id = ?").run(req.params.id);
    getDB().prepare("DELETE FROM invitations WHERE todo_id = ?").run(req.params.id);
  }

  res.json({ todo: getDB().prepare("SELECT * FROM todos WHERE id = ?").get(req.params.id) });
});

// POST /api/todos/:id/invite — invite user by username
router.post("/:id/invite", (req, res) => {
  const todo = getDB().prepare("SELECT * FROM todos WHERE id = ?").get(req.params.id);
  if (!todo) return res.status(404).json({ error: "任务不存在" });
  if (todo.owner_id !== req.userId) return res.status(403).json({ error: "只有创建者可以邀请" });
  if (!todo.is_shared) return res.status(400).json({ error: "请先开启共享" });

  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "请输入用户名" });

  const invitee = getDB().prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (!invitee) return res.status(404).json({ error: "用户不存在" });
  if (invitee.id === req.userId) return res.status(400).json({ error: "不能邀请自己" });

  // Check already member
  const already = getDB().prepare("SELECT 1 FROM todo_members WHERE todo_id = ? AND user_id = ?").get(req.params.id, invitee.id);
  if (already) return res.status(409).json({ error: "该用户已是成员" });

  // Check pending invitation
  const pending = getDB().prepare("SELECT 1 FROM invitations WHERE todo_id = ? AND invitee_id = ? AND status = 'pending'").get(req.params.id, invitee.id);
  if (pending) return res.status(409).json({ error: "已发送过邀请，等待对方回复" });

  getDB().prepare("INSERT INTO invitations (todo_id, inviter_id, invitee_id) VALUES (?, ?, ?)")
    .run(req.params.id, req.userId, invitee.id);

  res.status(201).json({ ok: true, message: `已邀请 ${username}` });
});

// GET /api/todos/:id/members
router.get("/:id/members", (req, res) => {
  const todo = getDB().prepare("SELECT * FROM todos WHERE id = ?").get(req.params.id);
  if (!todo) return res.status(404).json({ error: "任务不存在" });
  if (todo.owner_id !== req.userId) return res.status(403).json({ error: "无权查看" });

  const members = getDB().prepare(`
    SELECT u.id, u.username, tm.permission, tm.joined_at
    FROM todo_members tm JOIN users u ON u.id = tm.user_id
    WHERE tm.todo_id = ?
  `).all(req.params.id);

  const pending = getDB().prepare(`
    SELECT inv.id, u.username, inv.status, inv.created_at
    FROM invitations inv JOIN users u ON u.id = inv.invitee_id
    WHERE inv.todo_id = ? AND inv.status = 'pending'
  `).all(req.params.id);

  res.json({ members, pendingInvitations: pending });
});

// DELETE /api/todos/:id/members/:userId
router.delete("/:id/members/:userId", (req, res) => {
  const todo = getDB().prepare("SELECT owner_id FROM todos WHERE id = ?").get(req.params.id);
  if (!todo) return res.status(404).json({ error: "任务不存在" });
  if (todo.owner_id !== req.userId) return res.status(403).json({ error: "只有创建者可以移除成员" });

  getDB().prepare("DELETE FROM todo_members WHERE todo_id = ? AND user_id = ?").run(req.params.id, req.params.userId);
  res.json({ ok: true });
});

module.exports = router;
