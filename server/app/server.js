import express from "express";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auth, sqlite } from "../auth.js";
import { validateProfile } from "../metrics.js";
import { getProfile, importSeed, initializeDataTables, listMeasurements, recordMeasurement, saveProfile } from "../store.js";

initializeDataTables(sqlite);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = process.env.PWA_DIR || path.join(root, "pwa");
const baseURL = process.env.BETTER_AUTH_URL || "http://localhost:4322";
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "bluetooth=(self), geolocation=(), camera=(), microphone=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(express.json({ limit: "32kb" }));

function sameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (req.method === "GET") return next();
  if (!origin || origin !== new URL(baseURL).origin) return res.status(403).json({ error: "Origen no permitido." });
  return next();
}

async function requireUser(req, res, next) {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return res.status(401).json({ error: "Inicia sesión para continuar." });
    req.user = session.user;
    req.session = session.session;
    next();
  } catch {
    res.status(401).json({ error: "Sesión no válida." });
  }
}

app.get("/api/health", (_req, res) => res.json({ app: "mi-balance", ok: true }));
app.use("/api", sameOrigin);

app.get("/api/state", requireUser, async (req, res, next) => {
  try {
    let profile = getProfile(sqlite, req.user.id);
    if (!profile && process.env.SEED_FILE) {
      try { importSeed(sqlite, req.user.id, JSON.parse(await fs.readFile(process.env.SEED_FILE, "utf8"))); profile = getProfile(sqlite, req.user.id); } catch (error) { console.warn("No se pudo importar el seed:", error.message); }
    }
    res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name }, profile, measurements: listMeasurements(sqlite, req.user.id) });
  } catch (error) { next(error); }
});

app.put("/api/profile", requireUser, (req, res, next) => {
  try {
    const profile = validateProfile(req.body);
    saveProfile(sqlite, req.user.id, profile);
    res.json({ profile });
  } catch (error) { next(error); }
});

app.post("/api/measurements", requireUser, (req, res, next) => {
  try {
    const result = recordMeasurement(sqlite, req.user.id, req.body);
    res.status(result.inserted ? 201 : 200).json(result);
  } catch (error) { next(error); }
});

app.get("/api/export.csv", requireUser, (req, res) => {
  const rows = listMeasurements(sqlite, req.user.id);
  const keys = ["body_fat_percent", "muscle_mass_kg", "water_percent", "bmi", "fat_mass_kg", "fat_free_mass_kg", "water_mass_kg", "bone_mass_kg", "protein_percent", "visceral_fat_index", "basal_metabolic_rate_kcal_day", "metabolic_age_index_years", "body_type_code"];
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = [["captured_at", "weight_kg", "impedance_ohm", ...keys].map(escape).join(",")];
  for (const row of rows) lines.push([row.captured_at, row.weight_kg, row.impedance_ohm, ...keys.map((key) => row.metrics?.[key])].map(escape).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="mi-balance.csv"');
  res.send("\ufeff" + lines.join("\n"));
});

app.use(express.static(publicDir, {
  etag: true,
  maxAge: "1h",
  setHeaders(res, file) {
    if (file.endsWith("service-worker.js") || file.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
  },
}));

app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, req, res, _next) => {
  const status = /inválid|inválida|fuera|requiere|debe|configura/i.test(error.message) ? 400 : 500;
  if (status === 500) console.error("Request failed:", error.message);
  res.status(status).json({ error: status === 500 ? "No se pudo completar la operación." : error.message });
});

const port = Number(process.env.PORT || 4322);
const host = process.env.HOST || "127.0.0.1";
const server = app.listen(port, host, () => console.log(`Mi Balance listening on http://${host}:${port}`));

function shutdown() {
  server.close(() => { sqlite.close(); process.exit(0); });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
