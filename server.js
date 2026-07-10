import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const dataFile = process.env.DATA_FILE || join(__dirname, "data", "queue.json");
const databaseUrl = process.env.DATABASE_URL || "";
const accessPin = process.env.ACCESS_PIN || "7875";
const publicApiBaseUrl = process.env.PUBLIC_API_BASE_URL || "";
const authCookieName = "install_queue_auth";
const authToken = createHash("sha256").update(`install-queue:${accessPin}`).digest("hex");
const allowedOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const clients = new Set();
const frontDeskClients = new Set();
let entries = [];
let pool = null;
let storageMode = databaseUrl ? "postgres" : "file";

const categoryOrder = ["Quote", "Pickup", "Place Order"];
const statusOrder = ["Waiting", "To-Go", "Install", "Order Taken", "Ready", "Complete"];

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const databaseColumns = [
  "id",
  "category",
  "name",
  "phone",
  "company",
  "email",
  "comments",
  "removal_required",
  "job_type",
  "order_taken_by",
  "order_taken_at",
  "prepared_by",
  "prepared_at",
  "last_edited_by",
  "last_edited_at",
  "status",
  "signed_in_at",
  "status_changed_at",
  "completed_at"
];

function normalizeStoredEntry(entry) {
  return {
    id: String(entry.id || randomUUID()),
    category: categoryOrder.includes(entry.category) ? entry.category : "Quote",
    name: String(entry.name || "").trim() || "Unknown",
    phone: String(entry.phone || "").trim(),
    company: String(entry.company || "").trim(),
    email: String(entry.email || "").trim(),
    comments: String(entry.comments || "").trim(),
    removalRequired: Boolean(entry.removalRequired),
    jobType: String(entry.jobType || "").trim(),
    orderTakenBy: String(entry.orderTakenBy || "").trim(),
    orderTakenAt: entry.orderTakenAt || null,
    preparedBy: String(entry.preparedBy || "").trim(),
    preparedAt: entry.preparedAt || null,
    lastEditedBy: String(entry.lastEditedBy || "").trim(),
    lastEditedAt: entry.lastEditedAt || null,
    status: statusOrder.includes(entry.status) ? entry.status : "Waiting",
    signedInAt: entry.signedInAt || new Date().toISOString(),
    statusChangedAt: entry.statusChangedAt || null,
    completedAt: entry.completedAt || null
  };
}

function databaseSslConfig() {
  if (!databaseUrl) return undefined;
  if (databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1")) return false;
  if (databaseUrl.includes("sslmode=disable")) return false;
  return { rejectUnauthorized: false };
}

async function initDatabase() {
  if (!databaseUrl || pool) return;

  const { Pool } = await import("pg");
  const ssl = databaseSslConfig();
  pool = new Pool({
    connectionString: databaseUrl,
    ...(ssl === undefined ? {} : { ssl })
  });
  storageMode = "postgres";

  await pool.query(`
    CREATE TABLE IF NOT EXISTS queue_entries (
      id text PRIMARY KEY,
      category text NOT NULL,
      name text NOT NULL,
      phone text NOT NULL,
      company text NOT NULL DEFAULT '',
      email text NOT NULL DEFAULT '',
      comments text NOT NULL DEFAULT '',
      removal_required boolean NOT NULL DEFAULT false,
      job_type text NOT NULL DEFAULT '',
      order_taken_by text NOT NULL DEFAULT '',
      order_taken_at timestamptz,
      prepared_by text NOT NULL DEFAULT '',
      prepared_at timestamptz,
      last_edited_by text NOT NULL DEFAULT '',
      last_edited_at timestamptz,
      status text NOT NULL,
      signed_in_at timestamptz NOT NULL,
      status_changed_at timestamptz,
      completed_at timestamptz
    )
  `);
}

function rowToEntry(row) {
  return normalizeStoredEntry({
    id: row.id,
    category: row.category,
    name: row.name,
    phone: row.phone,
    company: row.company,
    email: row.email,
    comments: row.comments,
    removalRequired: row.removal_required,
    jobType: row.job_type,
    orderTakenBy: row.order_taken_by,
    orderTakenAt: row.order_taken_at ? row.order_taken_at.toISOString() : null,
    preparedBy: row.prepared_by,
    preparedAt: row.prepared_at ? row.prepared_at.toISOString() : null,
    lastEditedBy: row.last_edited_by,
    lastEditedAt: row.last_edited_at ? row.last_edited_at.toISOString() : null,
    status: row.status,
    signedInAt: row.signed_in_at ? row.signed_in_at.toISOString() : null,
    statusChangedAt: row.status_changed_at ? row.status_changed_at.toISOString() : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null
  });
}

function entryValues(entry) {
  return [
    entry.id,
    entry.category,
    entry.name,
    entry.phone,
    entry.company || "",
    entry.email || "",
    entry.comments || "",
    Boolean(entry.removalRequired),
    entry.jobType || "",
    entry.orderTakenBy || "",
    entry.orderTakenAt || null,
    entry.preparedBy || "",
    entry.preparedAt || null,
    entry.lastEditedBy || "",
    entry.lastEditedAt || null,
    entry.status,
    entry.signedInAt,
    entry.statusChangedAt || null,
    entry.completedAt || null
  ];
}

async function loadFileEntries() {
  const raw = await readFile(dataFile, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.map(normalizeStoredEntry) : [];
}

async function importFileEntriesIntoDatabase() {
  try {
    const fileEntries = await loadFileEntries();
    if (!fileEntries.length) return;
    entries = fileEntries;
    await persistDatabaseEntries();
    console.log(`Imported ${fileEntries.length} queue entries from JSON file into Postgres.`);
  } catch {
    // Nothing to import. Fresh databases can start empty.
  }
}

async function persistDatabaseEntries() {
  await initDatabase();
  if (!pool) return;

  const placeholders = databaseColumns.map((_, index) => `$${index + 1}`).join(", ");
  const updateColumns = databaseColumns
    .filter((column) => column !== "id")
    .map((column) => `${column}=EXCLUDED.${column}`)
    .join(", ");

  for (const entry of entries.map(normalizeStoredEntry)) {
    await pool.query(
      `
        INSERT INTO queue_entries (${databaseColumns.join(", ")})
        VALUES (${placeholders})
        ON CONFLICT (id) DO UPDATE SET ${updateColumns}
      `,
      entryValues(entry)
    );
  }
}

async function loadEntries() {
  if (databaseUrl) {
    await initDatabase();
    const result = await pool.query("SELECT * FROM queue_entries ORDER BY signed_in_at ASC");
    entries = result.rows.map(rowToEntry);
    if (!entries.length) await importFileEntriesIntoDatabase();
    return;
  }

  try {
    entries = await loadFileEntries();
  } catch {
    entries = [];
    await persistEntries();
  }
}

async function persistEntries() {
  if (databaseUrl) {
    await persistDatabaseEntries();
    return;
  }

  const dataDir = dirname(dataFile);
  await mkdir(dataDir, { recursive: true });
  await writeFile(dataFile, JSON.stringify(entries, null, 2));
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins.length) return {};
  if (!allowedOrigins.includes("*") && !allowedOrigins.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes("*") ? "*" : origin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin"
  };
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return {};
  }
}

function publicEntry(entry) {
  return {
    id: entry.id,
    category: entry.category,
    name: entry.name,
    company: entry.company,
    comments: entry.comments || "",
    removalRequired: Boolean(entry.removalRequired),
    jobType: entry.jobType || (entry.status === "To-Go" || entry.status === "Install" ? entry.status : ""),
    orderTakenBy: entry.orderTakenBy || "",
    orderTakenAt: entry.orderTakenAt || null,
    preparedBy: entry.preparedBy || "",
    preparedAt: entry.preparedAt || null,
    lastEditedBy: entry.lastEditedBy || "",
    lastEditedAt: entry.lastEditedAt || null,
    status: entry.status,
    signedInAt: entry.signedInAt,
    statusChangedAt: entry.statusChangedAt,
    completedAt: entry.completedAt
  };
}

function staffEntry(entry) {
  return {
    ...publicEntry(entry),
    phone: entry.phone || "",
    email: entry.email || ""
  };
}

function recordEdit(entry, staffName) {
  const editor = String(staffName || "").trim();
  if (!editor) return;
  entry.lastEditedBy = editor.slice(0, 80);
  entry.lastEditedAt = new Date().toISOString();
}

function snapshot() {
  const active = entries
    .filter((entry) => entry.status !== "Complete")
    .sort((a, b) => new Date(a.signedInAt) - new Date(b.signedInAt));

  return active.map((entry, index) => ({
    ...publicEntry(entry),
    position: index + 1,
    ahead: index
  }));
}

function frontDeskSnapshot() {
  const sorted = [...entries].sort((a, b) => new Date(a.signedInAt) - new Date(b.signedInAt));
  const active = sorted.filter((entry) => entry.status !== "Complete");
  const completed = sorted
    .filter((entry) => entry.status === "Complete")
    .sort((a, b) => new Date(b.completedAt || b.statusChangedAt) - new Date(a.completedAt || a.statusChangedAt));

  return {
    active: active.map((entry, index) => ({
      ...staffEntry(entry),
      position: index + 1,
      ahead: index
    })),
    completed: completed.map((entry) => staffEntry(entry))
  };
}

function broadcast() {
  const payload = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const client of clients) client.write(payload);

  const frontDeskPayload = `data: ${JSON.stringify(frontDeskSnapshot())}\n\n`;
  for (const client of frontDeskClients) client.write(frontDeskPayload);
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim().split("="))
      .filter(([name, value]) => name && value)
      .map(([name, value]) => [name, decodeURIComponent(value)])
  );
}

function hasAuth(req) {
  return parseCookies(req)[authCookieName] === authToken;
}

function authCookie() {
  return `${authCookieName}=${encodeURIComponent(authToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`;
}

function isValidEntry(input) {
  return (
    categoryOrder.includes(input.category) &&
    typeof input.name === "string" &&
    input.name.trim().length > 0 &&
    typeof input.phone === "string" &&
    input.phone.trim().length > 0
  );
}

async function handleApi(req, res, url) {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, uptime: process.uptime(), storage: storageMode }, cors);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    sendJson(res, 200, { authenticated: hasAuth(req) }, cors);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const input = await readJson(req);
    if (String(input.pin || "") !== accessPin) {
      sendJson(res, 401, { error: "Invalid code." }, cors);
      return;
    }

    sendJson(res, 200, { authenticated: true }, { ...cors, "Set-Cookie": authCookie() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/queue") {
    sendJson(res, 200, snapshot(), cors);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/frontdesk") {
    sendJson(res, 200, frontDeskSnapshot(), cors);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...cors
    });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/frontdesk/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...cors
    });
    res.write(`data: ${JSON.stringify(frontDeskSnapshot())}\n\n`);
    frontDeskClients.add(res);
    req.on("close", () => frontDeskClients.delete(res));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/signins") {
    const input = await readJson(req);
    if (!isValidEntry(input)) {
      sendJson(res, 400, { error: "Name, phone, and category are required." }, cors);
      return;
    }

    const now = new Date().toISOString();
    const entry = {
      id: randomUUID(),
      category: input.category,
      name: input.name.trim(),
      phone: input.phone.trim(),
      company: String(input.company || "").trim(),
      email: String(input.email || "").trim(),
      comments: "",
      removalRequired: false,
      jobType: "",
      orderTakenBy: "",
      orderTakenAt: null,
      preparedBy: "",
      preparedAt: null,
      lastEditedBy: "",
      lastEditedAt: null,
      status: "Waiting",
      signedInAt: now,
      statusChangedAt: null,
      completedAt: null
    };
    entries.push(entry);
    await persistEntries();
    broadcast();
    sendJson(res, 201, publicEntry(entry), cors);
    return;
  }

  const statusMatch = url.pathname.match(/^\/api\/signins\/([^/]+)\/status$/);
  if (req.method === "PATCH" && statusMatch) {
    const input = await readJson(req);
    const entry = entries.find((item) => item.id === statusMatch[1]);
    if (!entry) {
      sendJson(res, 404, { error: "Entry not found." }, cors);
      return;
    }
    if (!statusOrder.includes(input.status)) {
      sendJson(res, 400, { error: "Invalid status." }, cors);
      return;
    }

    entry.status = input.status;
    if (Object.hasOwn(input, "removalRequired")) {
      entry.removalRequired = Boolean(input.removalRequired);
    }
    if (input.status === "To-Go" || input.status === "Install") {
      entry.jobType = input.status;
    }
    if (input.status === "Order Taken") {
      const orderTakenBy = String(input.orderTakenBy || input.staffName || "").trim();
      if (orderTakenBy) entry.orderTakenBy = orderTakenBy.slice(0, 80);
      entry.orderTakenAt = new Date().toISOString();
    }
    if (input.status === "Ready") {
      const preparedBy = String(input.preparedBy || input.staffName || "").trim();
      if (preparedBy) entry.preparedBy = preparedBy.slice(0, 80);
      entry.preparedAt = new Date().toISOString();
    }
    if (input.status !== "Order Taken") {
      recordEdit(entry, input.staffName);
    }
    entry.statusChangedAt = input.status === "Waiting" ? null : new Date().toISOString();
    entry.completedAt = input.status === "Complete" ? entry.statusChangedAt : null;
    await persistEntries();
    broadcast();
    sendJson(res, 200, publicEntry(entry), cors);
    return;
  }

  const commentsMatch = url.pathname.match(/^\/api\/signins\/([^/]+)\/comments$/);
  if (req.method === "PATCH" && commentsMatch) {
    const input = await readJson(req);
    const entry = entries.find((item) => item.id === commentsMatch[1]);
    if (!entry) {
      sendJson(res, 404, { error: "Entry not found." }, cors);
      return;
    }

    entry.comments = String(input.comments || "").trim().slice(0, 600);
    recordEdit(entry, input.staffName);
    await persistEntries();
    broadcast();
    sendJson(res, 200, publicEntry(entry), cors);
    return;
  }

  const contactMatch = url.pathname.match(/^\/api\/signins\/([^/]+)\/contact$/);
  if (req.method === "PATCH" && contactMatch) {
    const input = await readJson(req);
    const entry = entries.find((item) => item.id === contactMatch[1]);
    if (!entry) {
      sendJson(res, 404, { error: "Entry not found." }, cors);
      return;
    }

    entry.company = String(input.company || "").trim().slice(0, 120);
    entry.email = String(input.email || "").trim().slice(0, 160);
    recordEdit(entry, input.staffName);
    await persistEntries();
    broadcast();
    sendJson(res, 200, staffEntry(entry), cors);
    return;
  }

  sendJson(res, 404, { error: "Not found." }, cors);
}

function serveStatic(req, res, url) {
  if (url.pathname === "/env.js") {
    res.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(
      `window.INSTALL_QUEUE_CONFIG = ${JSON.stringify({ apiBaseUrl: publicApiBaseUrl })};\n`
    );
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const stream = createReadStream(filePath);
  stream.on("open", () => {
    res.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    stream.pipe(res);
  });
  stream.on("error", () => {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });
}

await loadEntries();

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((error) => {
      console.error(error);
      sendJson(res, 500, { error: "Server error." });
    });
    return;
  }
  serveStatic(req, res, url);
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
server.listen(port, host, () => {
  console.log(`Install queue app running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
});
