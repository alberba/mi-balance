import { ageOn, ALGORITHM, calculateMetrics } from "./metrics.js";

export function initializeDataTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY, height_cm REAL NOT NULL, birthdate TEXT NOT NULL,
      sex TEXT NOT NULL CHECK(sex IN ('male','female')), updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS measurements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, captured_at TEXT NOT NULL,
      device_id TEXT NOT NULL, weight_kg REAL NOT NULL, impedance_ohm INTEGER,
      raw_hex TEXT NOT NULL, metrics_json TEXT, profile_json TEXT NOT NULL,
      algorithm TEXT NOT NULL, UNIQUE(user_id, device_id, raw_hex)
    );
    CREATE INDEX IF NOT EXISTS measurements_user_time ON measurements(user_id, captured_at DESC);
  `);
}

export function getProfile(db, userId) {
  const row = db.prepare("SELECT height_cm, birthdate, sex FROM user_profiles WHERE user_id = ?").get(userId);
  return row || null;
}

export function saveProfile(db, userId, profile) {
  db.prepare(`INSERT INTO user_profiles(user_id,height_cm,birthdate,sex,updated_at)
    VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET height_cm=excluded.height_cm,
    birthdate=excluded.birthdate,sex=excluded.sex,updated_at=excluded.updated_at`)
    .run(userId, profile.height_cm, profile.birthdate, profile.sex, new Date().toISOString());
  return profile;
}

export function listMeasurements(db, userId) {
  return db.prepare("SELECT * FROM measurements WHERE user_id = ? ORDER BY captured_at DESC, id DESC").all(userId).map((row) => ({
    id: row.id, captured_at: row.captured_at, device_id: row.device_id, weight_kg: row.weight_kg,
    impedance_ohm: row.impedance_ohm, raw_hex: row.raw_hex, metrics: row.metrics_json ? JSON.parse(row.metrics_json) : null,
    profile: JSON.parse(row.profile_json), algorithm: row.algorithm,
  }));
}

export function recordMeasurement(db, userId, measurement) {
  const profile = getProfile(db, userId);
  if (!profile) throw new Error("Configura tu perfil antes de guardar la medición.");
  const weight = Number(measurement.weight_kg);
  const impedance = measurement.impedance_ohm == null ? null : Number(measurement.impedance_ohm);
  const raw = String(measurement.raw_hex || "").toLowerCase();
  const captured = new Date(measurement.captured_at);
  if (!(weight >= 10 && weight <= 200) || !/^[0-9a-f]+$/.test(raw) || raw.length !== 26 || Number.isNaN(captured.getTime())) throw new Error("Medición inválida.");
  if (impedance != null && !(impedance > 0 && impedance < 3000)) throw new Error("Impedancia inválida.");
  const device = String(measurement.device_id || "MIBFS").slice(0, 64);
  const stamp = captured.toISOString();
  const existing = db.prepare("SELECT * FROM measurements WHERE user_id=? AND device_id=? AND raw_hex=?").get(userId, device, raw);
  if (existing) return { inserted: false, measurement: listMeasurements(db, userId)[0] };
  const last = db.prepare("SELECT * FROM measurements WHERE user_id=? ORDER BY captured_at DESC,id DESC LIMIT 1").get(userId);
  const delta = last ? Math.abs(Date.parse(stamp) - Date.parse(last.captured_at)) : Infinity;
  const age = ageOn(profile.birthdate, captured);
  if (last && delta < 120000 && Math.abs(last.weight_kg - weight) <= 0.1) {
    if (!impedance || last.impedance_ohm) return { inserted: false, measurement: null };
    const metrics = calculateMetrics(weight, profile.height_cm, age, profile.sex, impedance);
    db.prepare("UPDATE measurements SET weight_kg=?,impedance_ohm=?,raw_hex=?,metrics_json=? WHERE id=?").run(weight, impedance, raw, JSON.stringify(metrics), last.id);
    return { inserted: true, measurement: null };
  }
  const metrics = impedance ? calculateMetrics(weight, profile.height_cm, age, profile.sex, impedance) : null;
  const result = db.prepare(`INSERT INTO measurements(user_id,captured_at,device_id,weight_kg,impedance_ohm,raw_hex,metrics_json,profile_json,algorithm)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(userId, stamp, device, weight, impedance, raw, JSON.stringify(metrics), JSON.stringify(profile), ALGORITHM);
  return { inserted: true, id: result.lastInsertRowid };
}

export function importSeed(db, userId, seed) {
  if (seed.profile && !getProfile(db, userId)) saveProfile(db, userId, seed.profile);
  for (const measurement of seed.measurements || []) {
    try { recordMeasurement(db, userId, measurement); } catch (error) { console.warn("Seed measurement skipped:", error.message); }
  }
}
