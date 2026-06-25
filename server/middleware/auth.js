const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "todo_app_dev_secret_2026";
const JWT_EXPIRES_IN = "7d";

function signToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// Express middleware — verify JWT, attach user to req
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "未提供认证令牌" });
  }

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch {
    return res.status(401).json({ error: "令牌无效或已过期" });
  }
}

module.exports = { signToken, requireAuth, JWT_SECRET };
