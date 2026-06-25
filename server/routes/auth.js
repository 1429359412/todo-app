const { Router } = require("express");
const bcrypt = require("bcryptjs");
const { getDB } = require("../db");
const { signToken, requireAuth } = require("../middleware/auth");

const router = Router();

// POST /api/auth/register
router.post("/register", (req, res) => {
  const { username, password } = req.body;

  // Validate
  if (!username || !password) {
    return res.status(400).json({ error: "用户名和密码不能为空" });
  }
  if (username.length < 2 || username.length > 30) {
    return res.status(400).json({ error: "用户名需 2-30 个字符" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "密码至少 6 个字符" });
  }

  // Check duplicate
  const existing = getDB().prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) {
    return res.status(409).json({ error: "用户名已被注册" });
  }

  // Create user
  const hash = bcrypt.hashSync(password, 10);
  const result = getDB()
    .prepare("INSERT INTO users (username, email, password) VALUES (?, ?, ?)")
    .run(username, username + "@todo.app", hash);

  const token = signToken(result.lastInsertRowid);

  res.status(201).json({
    token,
    user: { id: result.lastInsertRowid, username },
  });
});

// POST /api/auth/login
router.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "用户名和密码不能为空" });
  }

  const user = getDB().prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }

  const token = signToken(user.id);

  res.json({
    token,
    user: { id: user.id, username: user.username },
  });
});

// GET /api/auth/me (protected)
router.get("/me", requireAuth, (req, res) => {
  const user = getDB().prepare("SELECT id, username, created_at FROM users WHERE id = ?").get(req.userId);
  if (!user) {
    return res.status(404).json({ error: "用户不存在" });
  }
  res.json({ user });
});

module.exports = router;
