require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:true}));

app.use(session({
  secret: process.env.SESSION_SECRET || "CHANGE_ME_BEFORE_DEPLOYMENT",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

let pool;

async function initDB() {
  if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
    console.warn("Database environment variables are not configured.");
    return;
  }
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
      ssl: process.env.DB_SSL === "true" ? {rejectUnauthorized:false} : undefined
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
}

function requireDB(req,res,next) {
  if (!pool) return res.status(503).json({error:"Database is not configured. Add MySQL environment variables in Render."});
  next();
}
function auth(req,res,next) {
  if (!req.session.user) return res.status(401).json({error:"Please sign in."});
  next();
}
function roles(...allowed) {
  return (req,res,next)=>{
    if (!req.session.user) return res.status(401).json({error:"Please sign in."});
    if (!allowed.includes(req.session.user.role)) return res.status(403).json({error:"You do not have permission for this action."});
    next();
  };
}
function publicUser(row) {
  return {id:row.id, fullName:row.full_name, email:row.email, username:row.username, role:row.role, active:!!row.active};
}

app.get("/api/health", async (req,res)=>{
  res.json({ok:true, database:!!pool});
});

app.get("/api/setup/status", requireDB, async (req,res)=>{
  const [[r]] = await pool.query("SELECT COUNT(*) AS count FROM users WHERE role='ADMIN'");
  res.json({setupRequired:Number(r.count)===0});
});

app.post("/api/setup/admin", requireDB, async (req,res)=>{
  const {fullName,email,username,password} = req.body || {};
  if (!fullName || !email || !username || !password)
    return res.status(400).json({error:"All fields are required."});
  if (password.length < 10)
    return res.status(400).json({error:"Admin password must be at least 10 characters."});

  const [[r]] = await pool.query("SELECT COUNT(*) AS count FROM users WHERE role='ADMIN'");
  if (Number(r.count)>0)
    return res.status(409).json({error:"Admin setup is already completed. Please sign in."});

  try {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      "INSERT INTO users(full_name,email,username,password_hash,role) VALUES(?,?,?,?, 'ADMIN')",
      [fullName.trim(),email.trim().toLowerCase(),username.trim(),hash]
    );
    res.status(201).json({ok:true,message:"Main Admin created successfully."});
  } catch(e) {
    if (e.code==="ER_DUP_ENTRY") return res.status(409).json({error:"Email or username already exists."});
    console.error(e);
    res.status(500).json({error:"Could not create Admin."});
  }
});

app.post("/api/login", requireDB, async (req,res)=>{
  const {username,password}=req.body||{};
  if (!username || !password) return res.status(400).json({error:"Username and password are required."});
  const [rows]=await pool.query("SELECT * FROM users WHERE username=? AND active=TRUE LIMIT 1",[username.trim()]);
  if (!rows.length || !(await bcrypt.compare(password,rows[0].password_hash)))
    return res.status(401).json({error:"Invalid username or password."});
  req.session.user=publicUser(rows[0]);
  res.json({user:req.session.user});
});

app.get("/api/me", (req,res)=>res.json({user:req.session.user || null}));
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get("/api/users", roles("ADMIN"), requireDB, async (req,res)=>{
  const [rows]=await pool.query("SELECT id,full_name,email,username,role,active,created_at FROM users ORDER BY role,id");
  res.json(rows.map(publicUser));
});

app.post("/api/users", roles("ADMIN"), requireDB, async (req,res)=>{
  const {fullName,email,username,password,role}=req.body||{};
  if (!fullName || !email || !username || !password || !role)
    return res.status(400).json({error:"All account fields are required."});
  if (!["MANAGER","TEAM_LEAD"].includes(role))
    return res.status(400).json({error:"Admin can create only Manager or Team Leader accounts."});
  if (password.length < 10)
    return res.status(400).json({error:"Password must be at least 10 characters."});
  try {
    const hash=await bcrypt.hash(password,12);
    const [r]=await pool.query(
      "INSERT INTO users(full_name,email,username,password_hash,role) VALUES(?,?,?,?,?)",
      [fullName.trim(),email.trim().toLowerCase(),username.trim(),hash,role]
    );
    const [rows]=await pool.query("SELECT id,full_name,email,username,role,active FROM users WHERE id=?",[r.insertId]);
    res.status(201).json({user:publicUser(rows[0])});
  } catch(e) {
    if(e.code==="ER_DUP_ENTRY") return res.status(409).json({error:"Email or username already exists."});
    console.error(e); res.status(500).json({error:"Could not create account."});
  }
});

app.patch("/api/users/:id/status", roles("ADMIN"), requireDB, async (req,res)=>{
  const id=Number(req.params.id);
  const [rows]=await pool.query("SELECT * FROM users WHERE id=?",[id]);
  if(!rows.length) return res.status(404).json({error:"User not found."});
  if(rows[0].role==="ADMIN") return res.status(400).json({error:"The Main Admin account is protected."});
  await pool.query("UPDATE users SET active=? WHERE id=?",[req.body.active?1:0,id]);
  res.json({ok:true});
});

app.use(express.static(path.join(__dirname,"public")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

initDB().then(()=>app.listen(PORT,()=>console.log(`Software Management System running on ${PORT}`)))
.catch(e=>{console.error("Database startup error:",e);app.listen(PORT,()=>console.log(`Server running on ${PORT}; database unavailable.`));});
