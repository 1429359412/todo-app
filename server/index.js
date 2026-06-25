const express = require("express");
const cors = require("cors");
const path = require("path");
const { initDB } = require("./db");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use("/api/auth", require("./routes/auth"));
app.use("/api/todos", require("./routes/todos"));
app.use("/api/invitations", require("./routes/invitations"));

const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get("*", (_req, res, next) => {
  if (_req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) next();
  });
});

initDB().then(() => {
  const os = require("os");
  const getIP = () => {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === "IPv4" && !net.internal) return net.address;
      }
    }
    return "localhost";
  };
  const ip = getIP();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[server] http://localhost:${PORT}`);
    console.log(`[server] http://${ip}:${PORT}`);
  });
});
