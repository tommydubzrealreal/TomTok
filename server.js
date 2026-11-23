
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const POSTS_FILE = path.join(DATA_DIR, "posts.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

for (const file of [POSTS_FILE, USERS_FILE, SESSIONS_FILE]) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, "[]");
}

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(ROOT, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function write(file, data) {
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, file);
}

function cleanText(value, max = 180) {
  return String(value || "").trim().replace(/[<>]/g, "").slice(0, max);
}

function passwordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Please log in first." });

  const sessions = read(SESSIONS_FILE);
  const hashed = tokenHash(token);
  const session = sessions.find(s => s.tokenHash === hashed);

  if (!session || session.expiresAt < Date.now()) {
    return res.status(401).json({ error: "Your login expired. Please log in again." });
  }

  const user = read(USERS_FILE).find(u => u.username === session.username);
  if (!user) return res.status(401).json({ error: "Account not found." });

  req.user = user;
  next();
}

app.post("/api/signup", (req, res) => {
  const username = cleanText(req.body.username, 24).replace(/\s/g, "");
  const password = String(req.body.password || "");

  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
    return res.status(400).json({ error: "Username must be 3–24 letters, numbers, or underscores." });
  }
  if (password.length < 10 || password.length > 128) {
    return res.status(400).json({ error: "Password must be 10–128 characters." });
  }

  const users = read(USERS_FILE);
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "That username is already taken." });
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const user = {
    username,
    salt,
    passwordHash: passwordHash(password, salt),
    createdAt: new Date().toISOString()
  };

  users.push(user);
  write(USERS_FILE, users);

  const token = makeToken();
  const sessions = read(SESSIONS_FILE);
  sessions.push({
    username,
    tokenHash: tokenHash(token),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
  });
  write(SESSIONS_FILE, sessions);

  res.status(201).json({ token, username });
});

app.post("/api/login", (req, res) => {
  const username = cleanText(req.body.username, 24);
  const password = String(req.body.password || "");
  const user = read(USERS_FILE).find(
    u => u.username.toLowerCase() === username.toLowerCase()
  );

  if (!user || passwordHash(password, user.salt) !== user.passwordHash) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }

  const token = makeToken();
  const sessions = read(SESSIONS_FILE);
  sessions.push({
    username: user.username,
    tokenHash: tokenHash(token),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
  });
  write(SESSIONS_FILE, sessions);

  res.json({ token, username: user.username });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ username: req.user.username });
});

app.post("/api/logout", requireAuth, (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.slice(7);
  const hashed = tokenHash(token);
  write(SESSIONS_FILE, read(SESSIONS_FILE).filter(s => s.tokenHash !== hashed));
  res.json({ ok: true });
});

const allowedTypes = new Set([
  "video/mp4", "video/webm", "video/ogg", "video/quicktime"
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 8);
    cb(null, crypto.randomUUID() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!allowedTypes.has(file.mimetype)) {
      return cb(new Error("Please upload an MP4, WebM, OGG, or MOV video."));
    }
    cb(null, true);
  }
});

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, app: "TomTok" })
);

app.get("/api/posts", (_req, res) => {
  const posts = read(POSTS_FILE).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.json(posts);
});

app.post("/api/posts", requireAuth, upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a video first." });

  const post = {
    id: crypto.randomUUID(),
    username: "@" + req.user.username,
    caption: cleanText(req.body.caption, 220) || "New video on TomTok",
    videoUrl: "/uploads/" + req.file.filename,
    originalName: cleanText(req.file.originalname, 100),
    likes: 0,
    comments: [],
    createdAt: new Date().toISOString()
  };

  const posts = read(POSTS_FILE);
  posts.push(post);
  write(POSTS_FILE, posts);
  res.status(201).json(post);
});

app.post("/api/posts/:id/like", requireAuth, (req, res) => {
  const posts = read(POSTS_FILE);
  const post = posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Post not found." });

  post.likes = Math.max(0, Number(post.likes || 0) + 1);
  write(POSTS_FILE, posts);
  res.json({ likes: post.likes });
});

app.post("/api/posts/:id/comments", requireAuth, (req, res) => {
  const text = cleanText(req.body.text, 300);
  if (!text) return res.status(400).json({ error: "Write a comment first." });

  const posts = read(POSTS_FILE);
  const post = posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Post not found." });

  post.comments = Array.isArray(post.comments) ? post.comments : [];
  const comment = {
    id: crypto.randomUUID(),
    username: "@" + req.user.username,
    text,
    createdAt: new Date().toISOString()
  };

  post.comments.push(comment);
  write(POSTS_FILE, posts);
  res.status(201).json(comment);
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Something went wrong." });
});

app.listen(PORT, () =>
  console.log(`TomTok is running on port ${PORT}`)
);
