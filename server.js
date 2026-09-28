require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "local-development-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

let pool = null;
let storageMode = "local";

function ensureLocalStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]\n", "utf8");
}
function readUsers() {
  ensureLocalStore();
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}
function writeUsers(users) {
  ensureLocalStore();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2) + "\n", "utf8");
}
function publicUser(row) {
  return {
    id: row.id,
    fullName: row.full_name ?? row.fullName,
    email: row.email,
    username: row.username,
    role: row.role,
    active: !!row.active
  };
}

async function initDB() {
  if (process.env.DATABASE_URL || process.env.DB_HOST) {
    try {
      if (process.env.DATABASE_URL) {
        pool = mysql.createPool(process.env.DATABASE_URL);
      } else {
        pool = mysql.createPool({
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT || 3306),
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
          waitForConnections: true,
          connectionLimit: 5,
          ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined
        });
      }
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          full_name VARCHAR(120) NOT NULL,
          email VARCHAR(190) NOT NULL UNIQUE,
          username VARCHAR(80) NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          role ENUM('ADMIN','MANAGER','TEAM_LEAD') NOT NULL,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      storageMode = "mysql";
      console.log("Storage: MySQL");
      return;
    } catch (e) {
      console.warn("MySQL unavailable; switching to local JSON storage.");
      console.warn(e.message);
      pool = null;
    }
  }
  ensureLocalStore();
  storageMode = "local";
  console.log("Storage: local JSON (no MySQL configuration found)");
}

function requireStorage(req, res, next) {
  next();
}
function roles(...allowed) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: "Please sign in." });
    if (!allowed.includes(req.session.user.role)) {
      return res.status(403).json({ error: "You do not have permission for this action." });
    }
    next();
  };
}

async function countAdmins() {
  if (pool) {
    const [[r]] = await pool.query("SELECT COUNT(*) AS count FROM users WHERE role='ADMIN'");
    return Number(r.count);
  }
  return readUsers().filter(u => u.role === "ADMIN").length;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, storage: storageMode });
});

app.get("/api/setup/status", requireStorage, async (req, res) => {
  res.json({ setupRequired: (await countAdmins()) === 0, storage: storageMode });
});

app.post("/api/setup/admin", requireStorage, async (req, res) => {
  const { fullName, email, username, password } = req.body || {};
  if (!fullName || !email || !username || !password) {
    return res.status(400).json({ error: "All fields are required." });
  }
  if (String(password).length < 10) {
    return res.status(400).json({ error: "Admin password must be at least 10 characters." });
  }
  if ((await countAdmins()) > 0) {
    return res.status(409).json({ error: "Admin setup is already completed. Please sign in." });
  }

  const clean = {
    full_name: String(fullName).trim(),
    email: String(email).trim().toLowerCase(),
    username: String(username).trim(),
    role: "ADMIN",
    active: true
  };

  try {
    const hash = await bcrypt.hash(String(password), 12);
    if (pool) {
      await pool.query(
        "INSERT INTO users(full_name,email,username,password_hash,role) VALUES(?,?,?,?, 'ADMIN')",
        [clean.full_name, clean.email, clean.username, hash]
      );
    } else {
      const users = readUsers();
      if (users.some(u => u.email === clean.email || u.username === clean.username)) {
        return res.status(409).json({ error: "Email or username already exists." });
      }
      users.push({ id: Date.now(), ...clean, password_hash: hash });
      writeUsers(users);
    }
    res.status(201).json({ ok: true, message: "Main Admin created successfully." });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Email or username already exists." });
    }
    console.error(e);
    res.status(500).json({ error: "Could not create Admin." });
  }
});

app.post("/api/login", requireStorage, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  let user;
  if (pool) {
    const [rows] = await pool.query(
      "SELECT * FROM users WHERE username=? AND active=TRUE LIMIT 1",
      [String(username).trim()]
    );
    user = rows[0];
  } else {
    user = readUsers().find(
      u => u.username === String(username).trim() && u.active !== false
    );
  }

  if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  req.session.user = publicUser(user);
  res.json({ user: req.session.user });
});

app.get("/api/me", (req, res) => res.json({ user: req.session.user || null }));

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/users", roles("ADMIN"), requireStorage, async (req, res) => {
  if (pool) {
    const [rows] = await pool.query(
      "SELECT id,full_name,email,username,role,active,created_at FROM users ORDER BY role,id"
    );
    return res.json(rows.map(publicUser));
  }
  res.json(readUsers().map(publicUser));
});

app.post("/api/users", roles("ADMIN"), requireStorage, async (req, res) => {
  const { fullName, email, username, password, role } = req.body || {};
  if (!fullName || !email || !username || !password || !role) {
    return res.status(400).json({ error: "All account fields are required." });
  }
  if (!["MANAGER", "TEAM_LEAD"].includes(role)) {
    return res.status(400).json({ error: "Admin can create only Manager or Team Leader accounts." });
  }
  if (String(password).length < 10) {
    return res.status(400).json({ error: "Password must be at least 10 characters." });
  }

  try {
    const hash = await bcrypt.hash(String(password), 12);
    if (pool) {
      const [r] = await pool.query(
        "INSERT INTO users(full_name,email,username,password_hash,role) VALUES(?,?,?,?,?)",
        [String(fullName).trim(), String(email).trim().toLowerCase(), String(username).trim(), hash, role]
      );
      const [rows] = await pool.query(
        "SELECT id,full_name,email,username,role,active FROM users WHERE id=?",
        [r.insertId]
      );
      return res.status(201).json({ user: publicUser(rows[0]) });
    }

    const users = readUsers();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanUsername = String(username).trim();
    if (users.some(u => u.email === cleanEmail || u.username === cleanUsername)) {
      return res.status(409).json({ error: "Email or username already exists." });
    }
    const user = {
      id: Date.now(),
      full_name: String(fullName).trim(),
      email: cleanEmail,
      username: cleanUsername,
      password_hash: hash,
      role,
      active: true
    };
    users.push(user);
    writeUsers(users);
    res.status(201).json({ user: publicUser(user) });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Email or username already exists." });
    }
    console.error(e);
    res.status(500).json({ error: "Could not create account." });
  }
});

app.patch("/api/users/:id/status", roles("ADMIN"), requireStorage, async (req, res) => {
  const id = Number(req.params.id);

  if (pool) {
    const [rows] = await pool.query("SELECT * FROM users WHERE id=?", [id]);
    if (!rows.length) return res.status(404).json({ error: "User not found." });
    if (rows[0].role === "ADMIN") {
      return res.status(400).json({ error: "The Main Admin account is protected." });
    }
    await pool.query("UPDATE users SET active=? WHERE id=?", [req.body.active ? 1 : 0, id]);
    return res.json({ ok: true });
  }

  const users = readUsers();
  const user = users.find(u => u.id === id);
  if (!user) return res.status(404).json({ error: "User not found." });
  if (user.role === "ADMIN") {
    return res.status(400).json({ error: "The Main Admin account is protected." });
  }
  user.active = !!req.body.active;
  writeUsers(users);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

initDB()
  .then(() => app.listen(PORT, () => {
    console.log(`Software Management System running on http://localhost:${PORT}`);
  }))
  .catch(e => {
    console.error("Startup error:", e);
    process.exit(1);
  });
