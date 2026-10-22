import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = {
  window: { addEventListener() {} },
  navigator: {},
  indexedDB: { open: () => ({}) },
  fetch: async () => { throw new Error("No network in unit test"); },
  console,
};
vm.runInNewContext(readFileSync(new URL("./data.js", import.meta.url), "utf8"), context);
const data = context.window.MiBalanceData;
assert.ok(data && data.supported);

const actual = data._test.calculateMetrics(70, 184, 23, "male", 500);
const expected = {
  bmi: 20.675803, body_fat_percent: 14.505479, fat_mass_kg: 10.153835, fat_free_mass_kg: 59.846165,
  muscle_mass_kg: 56.798205, water_percent: 58.649242, water_mass_kg: 41.054469, bone_mass_kg: 3.047960,
  protein_percent: 22.491051, visceral_fat_index: 6.368, basal_metabolic_rate_kcal_day: 1581.888,
  metabolic_age_index_years: 16.3605, body_type_code: 7,
};
for (const [key, value] of Object.entries(expected)) assert.ok(Math.abs(actual[key] - value) < 0.00001, `${key}: ${actual[key]} != ${value}`);

const bytes = Uint8Array.from([0x02, 0x26, 0xea, 0x07, 0x0a, 0x16, 0x13, 0x35, 0x39, 0xf4, 0x01, 0xb0, 0x36]);
const packet = data._test.decodeFrame(new DataView(bytes.buffer));
assert.equal(packet.weight_kg, 70);
assert.equal(packet.impedance_ohm, 500);
assert.equal(packet.stabilized, true);
assert.equal(packet.load_removed, false);

const enriched = data._test.enrichMetrics(actual);
assert.equal(enriched.bmi.range.state, "within");
assert.equal(enriched.body_fat_percent.range.state, "unavailable");
assert.equal(enriched.body_type_code.value, "Atlético y robusto");
assert.equal(Object.keys(enriched).length, 13);
assert.equal(data._test.ageOn("2003-09-23", new Date(2026, 8, 22, 12)), 22);
assert.equal(data._test.ageOn("2003-09-23", new Date(2026, 8, 23, 12)), 23);
assert.throws(() => data._test.validProfile({ height_cm: 250, birthdate: "2003-09-23", sex: "male" }));
console.log("PWA data: 13 metrics, real frame, age and scientific ranges verified");
