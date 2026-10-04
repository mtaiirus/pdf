/**
 * PDF URL Bot — single-file Node.js version (no dependencies).
 *
 * Runs daily (and once at startup). Each run:
 *   1. Clones your GitHub repo into a temp folder
 *   2. Fetches all courses, walks every folder tree (from folder_id=0)
 *   3. Collects PDF file URLs from the pdfurl API
 *   4. Appends ONLY new URLs to data/pdf_urls.jsonl (never edits/deletes old lines)
 *   5. Commits and pushes back to GitHub
 *
 * Required environment variables:
 *   GITHUB_TOKEN - GitHub personal access token (repo scope)
 *   GITHUB_REPO  - e.g. "your-username/pdf"
 * Optional:
 *   PORT - Render sets this automatically (default 3000)
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const BATCHES_URL = "https://mtaiirusapi.onrender.com/api/nt/batches";
const CONTENT_URL = (courseId, folderId) =>
  `https://mtaiirusapi.onrender.com/api/nt/content?course_id=${courseId}&folder_id=${folderId}`;
const PDFURL_URL = (contentId, courseId) =>
  `https://nexttoppers.nextmate.site/api/course/pdfurl?content_id=${contentId}&course_id=${courseId}`;

const REQUEST_DELAY_MS = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "pdf-url-bot/1.0" },
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (e) {
      console.log(`  ! request failed (${attempt}/${retries}): ${url} -> ${e.message}`);
      await sleep(2000 * attempt);
    }
  }
  return null;
}

function loadExistingKeys(dataFile) {
  const keys = new Set();
  if (fs.existsSync(dataFile)) {
    for (const line of fs.readFileSync(dataFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        keys.add(`${rec.course_id}|${rec.content_id}|${rec.file_url}`);
      } catch {}
    }
  }
  return keys;
}

async function getCourses() {
  const data = await fetchJson(BATCHES_URL);
  const courses = [];
  if (data && data.success) {
    for (const cat of data.catalog || []) {
      for (const b of cat.batches || []) {
        courses.push({ id: b.id, title: b.title });
      }
    }
  }
  return courses;
}

async function walkFolder(courseId, folderId, folderPath, results) {
  await sleep(REQUEST_DELAY_MS);
  const data = await fetchJson(CONTENT_URL(courseId, folderId));
  if (!data || !data.success) return;
  for (const item of data.data || []) {
    const entityId = item.entity_id;
    const title = item.title || "";
    const itemPath = folderPath ? `${folderPath}/${title}` : title;
    if (item.type === "folder") {
      await walkFolder(courseId, entityId, itemPath, results);
    } else {
      await sleep(REQUEST_DELAY_MS);
      const pdf = await fetchJson(PDFURL_URL(entityId, courseId));
      if (!pdf) continue;
      const entries = Array.isArray(pdf) ? pdf : [pdf];
      for (const entry of entries) {
        if (entry.file_url) {
          results.push({
            course_id: String(courseId),
            content_id: String(entry.id ?? entityId),
            folder_path: itemPath,
            title: entry.title || title,
            file_url: entry.file_url,
          });
        }
      }
    }
  }
}

async function collectNewRecords(dataFile) {
  const now = new Date().toISOString();
  const existing = loadExistingKeys(dataFile);
  console.log(`Existing records: ${existing.size}`);

  const courses = await getCourses();
  console.log(`Courses found: ${courses.length}`);

  const newRecords = [];
  for (const course of courses) {
    console.log(`Scanning course ${course.id}: ${course.title}`);
    const results = [];
    await walkFolder(course.id, 0, "", results);
    for (const rec of results) {
      rec.course_title = course.title;
      const key = `${rec.course_id}|${rec.content_id}|${rec.file_url}`;
      if (!existing.has(key)) {
        rec.fetched_at = now;
        newRecords.push(rec);
        existing.add(key);
      }
    }
  }
  return newRecords;
}

async function runJob() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) {
    console.error("Set GITHUB_TOKEN and GITHUB_REPO environment variables.");
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdfbot-"));
  const repoDir = path.join(tmp, "repo");
  try {
    execFileSync("git", ["clone", `https://x-access-token:${token}@github.com/${repo}.git`, repoDir], { stdio: "inherit" });

    const dataFile = path.join(repoDir, "data", "pdf_urls.jsonl");
    const newRecords = await collectNewRecords(dataFile);

    if (newRecords.length === 0) {
      console.log("No new URLs today.");
      return;
    }

    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.appendFileSync(dataFile, newRecords.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`New records appended: ${newRecords.length}`);

    const git = (args) => execFileSync("git", args, { cwd: repoDir, stdio: "inherit" });
    git(["config", "user.name", "pdf-url-bot"]);
    git(["config", "user.email", "pdf-url-bot@users.noreply.github.com"]);
    git(["add", "data/pdf_urls.jsonl"]);
    git(["commit", "-m", `Add new PDF URLs (${new Date().toISOString().slice(0, 10)})`]);
    git(["push"]);
    console.log("Pushed updates to GitHub.");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Run once at startup, then every 24 hours.
runJob().catch((e) => console.error("Job failed:", e));
setInterval(() => runJob().catch((e) => console.error("Job failed:", e)), DAY_MS);

// Tiny HTTP server so Render (web service) sees an open port and stays up.
const port = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("PDF URL bot is running. Data is appended daily to the GitHub repo.\n");
  })
  .listen(port, () => console.log(`Health server listening on port ${port}`));
