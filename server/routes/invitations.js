const { Router } = require("express");
const { getDB } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = Router();
router.use(requireAuth);

// GET /api/invitations — my pending invitations
router.get("/", (req, res) => {
  const list = getDB().prepare(`
    SELECT inv.id, inv.status, inv.created_at, t.id AS todo_id, t.text AS todo_text, u.username AS inviter_name
    FROM invitations inv
    JOIN todos t ON t.id = inv.todo_id
    JOIN users u ON u.id = inv.inviter_id
    WHERE inv.invitee_id = ? AND inv.status = 'pending'
    ORDER BY inv.created_at DESC
  `).all(req.userId);
  res.json({ invitations: list });
});

// POST /api/invitations/:id/respond
router.post("/:id/respond", (req, res) => {
  const { accept } = req.body;
  const inv = getDB().prepare("SELECT * FROM invitations WHERE id = ? AND invitee_id = ?").get(req.params.id, req.userId);
  if (!inv) return res.status(404).json({ error: "邀请不存在" });
  if (inv.status !== "pending") return res.status(400).json({ error: "邀请已处理" });

  if (accept) {
    getDB().prepare("UPDATE invitations SET status = 'accepted' WHERE id = ?").run(req.params.id);
    getDB().prepare("INSERT OR IGNORE INTO todo_members (todo_id, user_id) VALUES (?, ?)")
      .run(inv.todo_id, req.userId);
    res.json({ ok: true, message: "已接受邀请" });
  } else {
    getDB().prepare("UPDATE invitations SET status = 'rejected' WHERE id = ?").run(req.params.id);
    res.json({ ok: true, message: "已拒绝邀请" });
  }
});

module.exports = router;
