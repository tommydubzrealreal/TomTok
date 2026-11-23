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
const DB_FILE = path.join(DATA_DIR, "posts.json");

for (const dir of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]");

app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(ROOT, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

function readPosts() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return []; }
}
function writePosts(posts) {
  const temp = DB_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(posts, null, 2));
  fs.renameSync(temp, DB_FILE);
}
function cleanText(value, max = 180) {
  return String(value || "").trim().replace(/[<>]/g, "").slice(0, max);
}
const allowedTypes = new Set(["video/mp4", "video/webm", "video/ogg", "video/quicktime"]);
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
    if (!allowedTypes.has(file.mimetype)) return cb(new Error("Please upload an MP4, WebM, OGG, or MOV video."));
    cb(null, true);
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true, app: "TomTok" }));
app.get("/api/posts", (_req, res) => {
  const posts = readPosts().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(posts);
});

app.post("/api/posts", upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a video first." });
  const caption = cleanText(req.body.caption, 220);
  const username = cleanText(req.body.username, 24).replace(/\s/g, "") || "@tomtokuser";
  const post = {
    id: crypto.randomUUID(),
    username: username.startsWith("@") ? username : "@" + username,
    caption: caption || "New video on TomTok",
    videoUrl: "/uploads/" + req.file.filename,
    originalName: cleanText(req.file.originalname, 100),
    likes: 0,
    comments: [],
    createdAt: new Date().toISOString()
  };
  const posts = readPosts();
  posts.push(post);
  writePosts(posts);
  res.status(201).json(post);
});

app.post("/api/posts/:id/like", (req, res) => {
  const posts = readPosts();
  const post = posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Post not found." });
  // Demo likes are shared totals, not tied to individual accounts.
  post.likes = Math.max(0, Number(post.likes || 0) + 1);
  writePosts(posts);
  res.json({ likes: post.likes });
});

app.post("/api/posts/:id/comments", (req, res) => {
  const text = cleanText(req.body.text, 300);
  if (!text) return res.status(400).json({ error: "Write a comment first." });
  const posts = readPosts();
  const post = posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Post not found." });
  post.comments = Array.isArray(post.comments) ? post.comments : [];
  const comment = { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() };
  post.comments.push(comment);
  writePosts(posts);
  res.status(201).json(comment);
});

app.use((err, _req, res, _next) => {
  const status = err instanceof multer.MulterError ? 400 : 400;
  res.status(status).json({ error: err.message || "Something went wrong." });
});

app.listen(PORT, () => console.log(`TomTok is running at http://localhost:${PORT}`));
