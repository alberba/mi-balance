import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { calculateMetrics, validateProfile } from "../metrics.js";
import { getProfile, initializeDataTables, listMeasurements, recordMeasurement, saveProfile } from "../store.js";

test("métricas coinciden con el cálculo Python fijado", () => {
  const actual = calculateMetrics(70, 184, 23, "male", 500);
  const expected = { bmi: 20.675803, body_fat_percent: 14.505479, muscle_mass_kg: 56.798205, water_percent: 58.649242, bone_mass_kg: 3.047960 };
  for (const [key, value] of Object.entries(expected)) assert.ok(Math.abs(actual[key] - value) < 0.00001);
});

test("almacenamiento aísla usuarios, enriquece con impedancia y deduplica", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mi-balance-test-"));
  const db = new Database(path.join(dir, "test.sqlite3"));
  try {
    initializeDataTables(db);
    const profile = validateProfile({ height_cm: 184, birthdate: "2003-09-23", sex: "male" });
    saveProfile(db, "user-a", profile);
    const base = { captured_at: "2026-10-22T20:00:00Z", device_id: "MIBFS", weight_kg: 70, raw_hex: "0204ea070a161334290000b036" };
    assert.equal(recordMeasurement(db, "user-a", base).inserted, true);
    assert.equal(listMeasurements(db, "user-a")[0].metrics, null);
    assert.equal(recordMeasurement(db, "user-a", { ...base, impedance_ohm: 500, raw_hex: "0226ea070a16133539f401b036", captured_at: "2026-10-22T20:00:20Z" }).inserted, true);
    assert.equal(listMeasurements(db, "user-a").length, 1);
    assert.ok(listMeasurements(db, "user-a")[0].metrics.body_fat_percent > 14);
    assert.equal(listMeasurements(db, "user-b").length, 0);
    assert.equal(getProfile(db, "user-b"), null);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("entradas malformadas son rechazadas", () => {
  assert.throws(() => validateProfile({ height_cm: 0, birthdate: "2003-09-23", sex: "male" }));
  assert.throws(() => calculateMetrics(77, 184, 23, "male", 0));
});
