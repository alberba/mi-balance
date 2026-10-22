/* Local-first storage and Web Bluetooth; all health data stays in this browser. */
(() => {
  const DB_NAME = "mi-balance";
  const DB_VERSION = 1;
  const DEVICE_NAME = "MIBFS";
  const BODY_SERVICE = "0000181b-0000-1000-8000-00805f9b34fb";
  const MEASUREMENT = "00002a9c-0000-1000-8000-00805f9b34fb";
  const ALGORITHM = "lolouk44/xiaomi_mi_scale@e9db989d21b23602a462338a285478658cbaa137";
  const iso = (date = new Date()) => date.toISOString();
  const round = (value, digits) => Number(value.toFixed(digits));
  const ageOn = (birthdate, date) => {
    const [year, month, day] = birthdate.split("-").map(Number);
    return date.getFullYear() - year - (date.getMonth() + 1 < month || (date.getMonth() + 1 === month && date.getDate() < day) ? 1 : 0);
  };

  function validProfile(profile) {
    const height = Number(profile.height_cm);
    const birthdate = String(profile.birthdate || "");
    const sex = String(profile.sex || "");
    const date = new Date(`${birthdate}T12:00:00Z`);
    const age = Number.isNaN(date.getTime()) ? -1 : ageOn(birthdate, new Date());
    if (!Number.isFinite(height) || height < 100 || height > 220) throw new Error("La altura debe estar entre 100 y 220 cm.");
    if (age < 18 || age > 99) throw new Error("El cálculo requiere una edad entre 18 y 99 años.");
    if (!["male", "female"].includes(sex)) throw new Error("Selecciona el sexo usado en el cálculo.");
    return { height_cm: height, birthdate, sex };
  }

  function calculateMetrics(weight, height, age, sex, impedance) {
    if (!(weight >= 10 && weight <= 200 && height > 0 && height <= 220 && age >= 18 && age <= 99 && impedance > 0 && impedance < 3000)) {
      throw new Error("Peso, altura, edad o impedancia fuera del intervalo admitido por el algoritmo.");
    }
    const lbm = (height * 9.058 / 100) * (height / 100) + weight * 0.32 + 12.226 - impedance * 0.0068 - age * 0.0542;
    const constFat = sex === "female" ? (age <= 49 ? 9.25 : 7.25) : 0.8;
    let coefficient = 1;
    if (sex === "male" && weight < 61) coefficient = 0.98;
    else if (sex === "female" && weight > 60) { coefficient = 0.96; if (height > 160) coefficient *= 1.03; }
    else if (sex === "female" && weight < 50) { coefficient = 1.02; if (height > 160) coefficient *= 1.03; }
    let fat = (1 - ((lbm - constFat) * coefficient / weight)) * 100;
    if (fat > 63) fat = 75;
    fat = Math.max(5, Math.min(75, fat));
    let water = (100 - fat) * 0.7;
    water *= water <= 50 ? 1.02 : 0.98;
    if (water >= 65) water = 75;
    water = Math.max(35, Math.min(75, water));
    let bone = ((sex === "female" ? 0.245691014 : 0.18016894) - lbm * 0.05158) * -1;
    bone += bone > 2.2 ? 0.1 : -0.1;
    bone = Math.max(0.5, Math.min(8, bone));
    let muscle = weight - fat / 100 * weight - bone;
    muscle = Math.max(10, Math.min(120, muscle));
    let visceral;
    if (sex === "female") {
      if (weight > (13 - height * 0.5) * -1) {
        const subsub = height * 1.45 + height * 0.1158 * height - 120;
        visceral = weight * 500 / subsub - 6 + age * 0.07;
      } else {
        const sub = 0.691 + height * -0.0024 + height * -0.0024;
        visceral = (height * 0.027 - sub * weight) * -1 + age * 0.07 - age;
      }
    } else if (height < weight * 1.6) {
      const sub = (height * 0.4 - height * (height * 0.0826)) * -1;
      visceral = weight * 305 / (sub + 48) - 2.9 + age * 0.15;
    } else {
      const sub = 0.765 + height * -0.0015;
      visceral = (height * 0.143 - weight * sub) * -1 + age * 0.15 - 5;
    }
    visceral = Math.max(1, Math.min(50, visceral));
    let bmr = sex === "female" ? 864.6 + weight * 10.2036 - height * 0.39336 - age * 6.204 : 877.8 + weight * 14.916 - height * 0.726 - age * 8.976;
    if ((sex === "female" && bmr > 2996) || (sex === "male" && bmr > 2322)) bmr = 5000;
    bmr = Math.max(500, Math.min(10000, bmr));
    const metabolicAge = Math.max(15, Math.min(80, sex === "female"
      ? height * -1.1165 + weight * 1.5784 + age * 0.4615 + impedance * 0.0415 + 83.2548
      : height * -0.7471 + weight * 0.9161 + age * 0.4184 + impedance * 0.0517 + 54.2267));
    const fatScale = sex === "male" ? [11, 17, 22, 27] : [21, 28, 35, 40];
    const muscleScale = height >= 170 ? (sex === "male" ? [49.4, 59.5] : [36.5, 42.6]) : height >= 160 ? (sex === "male" ? [44, 52.5] : [32.9, 37.6]) : (sex === "male" ? [38.5, 46.6] : [29.1, 34.8]);
    const fatFactor = fat > fatScale[2] ? 0 : fat < fatScale[1] ? 2 : 1;
    const bodyType = muscle > muscleScale[1] ? 2 + fatFactor * 3 : muscle < muscleScale[0] ? fatFactor * 3 : 1 + fatFactor * 3;
    return {
      bmi: round(weight / (height / 100) ** 2, 6), body_fat_percent: round(fat, 6), fat_mass_kg: round(weight * fat / 100, 6),
      fat_free_mass_kg: round(weight * (1 - fat / 100), 6), muscle_mass_kg: round(muscle, 6), water_percent: round(water, 6),
      water_mass_kg: round(weight * water / 100, 6), bone_mass_kg: round(bone, 6), protein_percent: round(Math.max(5, Math.min(32, muscle / weight * 100 - water)), 6),
      visceral_fat_index: round(visceral, 6), basal_metabolic_rate_kcal_day: round(bmr, 6), metabolic_age_index_years: round(metabolicAge, 6), body_type_code: bodyType,
    };
  }

  const notes = {
    body_fat_percent: ["Estimación BIA", "No existe un punto de corte universal validado para esta estimación individual. El metaanálisis de grasa y mortalidad muestra una relación en J con alta heterogeneidad.", "PMID 35717418 y 41718193", "https://pubmed.ncbi.nlm.nih.gov/35717418/"],
    fat_mass_kg: ["Derivada", "Se calcula desde el porcentaje de grasa estimado; no tiene un rango en kg aplicable a individuos.", "Cohortes de FM/FFM, PMID 33437985", "https://pubmed.ncbi.nlm.nih.gov/33437985/"],
    fat_free_mass_kg: ["Derivada", "Incluye agua, minerales y otros tejidos. No confundirla con FFMI ni masa muscular.", "Estimación BIA frente a 4C, PMID 41718193", "https://pubmed.ncbi.nlm.nih.gov/41718193/"],
    muscle_mass_kg: ["Proxy algorítmico", "Esta salida no es masa muscular apendicular ni músculo esquelético medido. Los criterios de sarcopenia o ASMI no se pueden aplicar aquí.", "EWGSOP2, PMID 30312372", "https://pubmed.ncbi.nlm.nih.gov/30312372/"],
    water_percent: ["Proxy algorítmico", "El porcentaje se deriva de la grasa estimada, no de una medición independiente de agua corporal total.", "Revisión 4C y terminología, PMID 41718193", "https://pubmed.ncbi.nlm.nih.gov/41718193/"],
    water_mass_kg: ["Derivada", "No es agua corporal total medida; el agua ya forma parte de la masa libre de grasa.", "Métodos de composición corporal, PMID 40754386", "https://pubmed.ncbi.nlm.nih.gov/40754386/"],
    bone_mass_kg: ["Proxy algorítmico", "No equivale al contenido mineral óseo por DXA ni a densidad mineral ósea.", "Terminología de composición corporal, PMID 40754386", "https://pubmed.ncbi.nlm.nih.gov/40754386/"],
    protein_percent: ["Proxy sin validación", "La propia fórmula original se describe como aproximada. No es una medición de proteína corporal ni de alimentación.", "Fórmula del algoritmo y modelo 4C", "https://github.com/lolouk44/xiaomi_mi_scale/blob/e9db989d21b23602a462338a285478658cbaa137/src/Xiaomi_Scale_Body_Metrics.py"],
    visceral_fat_index: ["Índice del algoritmo", "Es distinto del área visceral medida por tomografía o resonancia. No existen umbrales intercambiables entre dispositivos.", "Revisión de grasa visceral, PMID 36082075", "https://pubmed.ncbi.nlm.nih.gov/36082075/"],
    basal_metabolic_rate_kcal_day: ["Ecuación", "No es calorimetría indirecta ni gasto energético diario total. Una revisión encontró que Mifflin–St Jeor es más fiable, pero sigue variando entre personas.", "Revisión BMR, PMID 15883556", "https://pubmed.ncbi.nlm.nih.gov/15883556/"],
    metabolic_age_index_years: ["Información del algoritmo", "No existe una definición fisiológica o clínica validada para este índice. Cerca de tu edad cronológica no demuestra salud metabólica.", "Fórmula del algoritmo", "https://github.com/lolouk44/xiaomi_mi_scale/blob/e9db989d21b23602a462338a285478658cbaa137/src/Xiaomi_Scale_Body_Metrics.py"],
    body_type_code: ["Información del algoritmo", "La taxonomía y sus cortes proceden de la biblioteca, no de una clasificación científica validada.", "Tablas del algoritmo", "https://github.com/lolouk44/xiaomi_mi_scale/blob/e9db989d21b23602a462338a285478658cbaa137/src/body_scales.py"],
  };

  function enrichMetrics(metrics) {
    if (!metrics) return null;
    const result = {};
    for (const [key, value] of Object.entries(metrics)) {
      if (key === "body_type_code") {
        const names = ["Bajo de peso", "Delgado y deportista", "Delgado", "Bajo en músculo", "Equilibrado", "Equilibrado y musculoso", "Con exceso de grasa", "Atlético y robusto", "Robusto"];
        result[key] = { value: names[value] || `Tipo ${value}`, range: { low: null, high: null, state: "unavailable", label: "Sin clasificación científica", evidence_type: notes[key][0], note: notes[key][1], study: notes[key][2], source_url: notes[key][3] } };
      } else if (key === "bmi") {
        const state = value < 18.5 ? "below" : value > 24.9 ? "above" : "within";
        result[key] = { value, range: { low: 18.5, high: 24.9, state, label: state === "within" ? "Dentro del rango de cribado" : state === "below" ? "Por debajo del rango de cribado" : "Por encima del rango de cribado", evidence_type: "Referencia poblacional", study: "Clasificación adulta de IMC; revisión de utilidad, PMID 32728050", note: "El IMC no mide grasa ni salud individual. El intervalo es un cribado poblacional.", source_url: "https://pubmed.ncbi.nlm.nih.gov/32728050/" } };
      } else {
        const note = notes[key] || ["Estimación", "Sin un rango científico directo para esta salida.", "", ""];
        result[key] = { value, range: { low: null, high: null, state: "unavailable", label: "Sin umbral validado", evidence_type: note[0], note: note[1], study: note[2], source_url: note[3] } };
      }
    }
    return result;
  }

  function decodeFrame(data) {
    if (!data || typeof data.getUint8 !== "function" || data.byteLength !== 13) throw new Error("La báscula envió una trama de longitud inesperada.");
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const flags = bytes[1];
    const rawWeight = bytes[11] | bytes[12] << 8;
    const rawImpedance = bytes[9] | bytes[10] << 8;
    const unit = bytes[0] === 2 ? "kg" : bytes[0] === 3 ? "lb" : null;
    const weight = unit === "kg" ? rawWeight / 200 : unit === "lb" ? rawWeight / 100 : null;
    const impedance = flags & 2 && rawImpedance > 0 && rawImpedance < 3000 ? rawImpedance : null;
    return { raw_hex: [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""), control: bytes[0], flags,
      weight_raw: rawWeight, unit, weight_kg: weight == null ? null : (unit === "lb" ? weight * 0.45359237 : weight), impedance_ohm: impedance,
      impedance_raw: rawImpedance, stabilized: Boolean(flags & 0x20), load_removed: Boolean(flags & 0x80), captured_at: iso() };
  }

  class Database {
    constructor() { this.db = null; }
    async open() {
      if (this.db) return this.db;
      this.db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("profile")) db.createObjectStore("profile");
          if (!db.objectStoreNames.contains("measurements")) {
            const store = db.createObjectStore("measurements", { keyPath: "id", autoIncrement: true });
            store.createIndex("captured_at", "captured_at");
            store.createIndex("device_raw", ["device_id", "raw_hex"], { unique: true });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("No se pudo abrir el almacenamiento local."));
      });
      return this.db;
    }
    async tx(storeName, mode = "readonly") { return (await this.open()).transaction(storeName, mode).objectStore(storeName); }
    async getProfile() { const store = await this.tx("profile"); return new Promise((resolve, reject) => { const r = store.get("profile"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
    async setProfile(profile) { const store = await this.tx("profile", "readwrite"); return new Promise((resolve, reject) => { const r = store.put(profile, "profile"); r.onsuccess = () => resolve(profile); r.onerror = () => reject(r.error); }); }
    async all() { const store = await this.tx("measurements"); return new Promise((resolve, reject) => { const r = store.getAll(); r.onsuccess = () => resolve((r.result || []).sort((a, b) => b.captured_at.localeCompare(a.captured_at) || b.id - a.id)); r.onerror = () => reject(r.error); }); }
    async put(record) { const store = await this.tx("measurements", "readwrite"); return new Promise((resolve, reject) => { const r = store.put(record); r.onsuccess = () => { record.id = r.result; resolve(record); }; r.onerror = () => reject(r.error); }); }
    async replaceAll(records) { const store = await this.tx("measurements", "readwrite"); return new Promise((resolve, reject) => { const clear = store.clear(); clear.onerror = () => reject(clear.error); clear.onsuccess = () => { for (const record of records) store.put(record); resolve(); }; }); }
    async seed(data) {
      if (await this.getProfile()) return;
      await this.setProfile(data.profile);
      for (const measurement of data.measurements) {
        const copy = { ...measurement };
        delete copy.id;
        await this.put(copy);
      }
    }
  }

  class Client {
    constructor() {
      this.db = new Database();
      this.device = null;
      this.characteristic = null;
      this.status = { running: false, phase: "idle", message: "Toca conectar y elige tu báscula Mi.", last_packet: null };
      this.ready = this.init();
      window.addEventListener("online", () => this.sync().catch(() => {}));
    }
    async init() {
      await this.db.open();
    }
    async state() {
      await this.ready;
      const measurements = await this.db.all();
      const hydrated = measurements.map((m) => {
        let metrics = m.metrics || (m.metrics_json ? JSON.parse(m.metrics_json) : null);
        const profile = m.profile || (m.profile_json ? JSON.parse(m.profile_json) : null);
        if (!metrics && m.impedance_ohm && profile) {
          const age = ageOn(profile.birthdate, new Date(m.captured_at));
          metrics = calculateMetrics(m.weight_kg, profile.height_cm, age, profile.sex, m.impedance_ohm);
        }
        return { ...m, profile, metrics: enrichMetrics(metrics) };
      });
      return { profile: await this.db.getProfile(), status: { ...this.status }, measurements: hydrated };
    }
    async sync() {
      await this.ready;
      const first = await fetch("/api/state", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      const initial = await first.json().catch(() => ({}));
      if (first.status === 401) throw Object.assign(new Error("Inicia sesión para continuar."), { code: "AUTH_REQUIRED" });
      if (!first.ok) throw new Error(initial.error || "No se pudo sincronizar el historial.");
      const pending = (await this.db.all()).filter((m) => m.synced === false);
      for (const measurement of pending) await this.push(measurement);
      const response = pending.length ? await fetch("/api/state", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } }) : first;
      const data = pending.length ? await response.json() : initial;
      if (!response.ok) throw new Error(data.error || "No se pudo sincronizar el historial.");
      if (data.profile) await this.db.setProfile(data.profile);
      const remote = (data.measurements || []).map((measurement) => ({ ...measurement, synced: true }));
      await this.db.replaceAll(remote);
      this.status = { ...this.status, phase: this.status.phase === "idle" ? "connected" : this.status.phase };
      return this.state();
    }
    async push(measurement) {
      const response = await fetch("/api/measurements", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ captured_at: measurement.captured_at, device_id: measurement.device_id, weight_kg: measurement.weight_kg, impedance_ohm: measurement.impedance_ohm, raw_hex: measurement.raw_hex }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudo guardar la medición en el servidor.");
      await this.db.put({ ...measurement, synced: true });
      return data;
    }
    async connect() {
      if (!navigator.bluetooth) throw new Error("Web Bluetooth no está disponible. Abre la app en Chrome para Android con HTTPS.");
      this.status = { ...this.status, running: true, phase: "scanning", message: "Selecciona tu báscula en el diálogo de Chrome." };
      try {
        const device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: DEVICE_NAME }, { services: [BODY_SERVICE] }], optionalServices: [BODY_SERVICE] });
        this.device = device;
        device.addEventListener("gattserverdisconnected", () => this.disconnected());
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(BODY_SERVICE);
        this.characteristic = await service.getCharacteristic(MEASUREMENT);
        this.characteristic.addEventListener("characteristicvaluechanged", (event) => this.receive(event.target.value));
        await this.characteristic.startNotifications();
        this.status = { ...this.status, running: true, phase: "connected", message: "Báscula conectada. Sube descalzo y espera el resultado." };
        return { ok: true };
      } catch (error) {
        this.status = { ...this.status, running: false, phase: error?.name === "NotFoundError" ? "idle" : "error", message: error?.name === "NotFoundError" ? "No se seleccionó ninguna báscula." : `No se pudo conectar: ${error.message}` };
        throw error;
      }
    }
    async disconnect() {
      if (this.characteristic) { try { await this.characteristic.stopNotifications(); } catch { /* La conexión puede haberse perdido ya. */ } }
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
      this.characteristic = null;
      this.device = null;
      this.status = { ...this.status, running: false, phase: "idle", message: "Bluetooth desconectado. Tu historial sigue disponible." };
      return { ok: true };
    }
    disconnected() {
      this.characteristic = null;
      this.status = { ...this.status, running: false, phase: "connected", message: "Báscula desconectada. Actívala y vuelve a conectar." };
    }
    async receive(view) {
      let packet;
      try { packet = decodeFrame(view); } catch (error) { this.status = { ...this.status, phase: "error", message: error.message }; return; }
      this.status = { ...this.status, last_packet: packet };
      if (packet.load_removed) { this.status = { ...this.status, phase: "connected", message: "Pesada terminada. Esperando la próxima." }; return; }
      if (!packet.stabilized) { this.status = { ...this.status, phase: "measuring", message: "Midiendo. Espera a que el peso se estabilice." }; return; }
      if (!packet.weight_kg) return;
      await this.record(packet);
      this.status = { ...this.status, phase: packet.impedance_ohm ? "saved" : "measuring", message: packet.impedance_ohm ? "Pesada guardada con composición estimada." : "Peso guardado. Sigue descalzo para completar la impedancia." };
    }
    async record(packet) {
      const profile = await this.db.getProfile();
      const rows = await this.db.all();
      if (rows.some((m) => m.raw_hex === packet.raw_hex && m.device_id === DEVICE_NAME)) return;
      const last = rows[0];
      if (last && packet.captured_at && Math.abs(new Date(packet.captured_at) - new Date(last.captured_at)) < 120000 && Math.abs(last.weight_kg - packet.weight_kg) <= 0.1) {
        if (!packet.impedance_ohm || last.impedance_ohm) return;
        const age = ageOn(last.profile.birthdate, new Date(last.captured_at));
        const updated = await this.db.put({ ...last, weight_kg: packet.weight_kg, impedance_ohm: packet.impedance_ohm, raw_hex: packet.raw_hex, metrics: calculateMetrics(packet.weight_kg, last.profile.height_cm, age, last.profile.sex, packet.impedance_ohm), synced: false });
        try { await this.push(updated); } catch { /* Se reintentará al volver la conexión. */ }
        return;
      }
      const age = ageOn(profile.birthdate, new Date(packet.captured_at));
      const record = await this.db.put({ captured_at: packet.captured_at, device_id: DEVICE_NAME, weight_kg: packet.weight_kg, impedance_ohm: packet.impedance_ohm, raw_hex: packet.raw_hex, profile: { ...profile }, algorithm: ALGORITHM, metrics: packet.impedance_ohm ? calculateMetrics(packet.weight_kg, profile.height_cm, age, profile.sex, packet.impedance_ohm) : null, synced: false });
      try { await this.push(record); } catch { this.status = { ...this.status, phase: "sync_pending", message: "Pesada guardada en este dispositivo; se sincronizará al recuperar la conexión." }; }
    }
    async saveProfile(profile) {
      await this.ready;
      const saved = validProfile(profile);
      const response = await fetch("/api/profile", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(saved) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudo guardar el perfil.");
      await this.db.setProfile(saved);
      return { ok: true, profile: saved };
    }
    async exportCsv() {
      const rows = (await this.state()).measurements;
      const keys = ["weight_kg", "impedance_ohm", "body_fat_percent", "muscle_mass_kg", "water_percent", "bmi", "fat_mass_kg", "fat_free_mass_kg", "water_mass_kg", "bone_mass_kg", "protein_percent", "visceral_fat_index", "basal_metabolic_rate_kcal_day", "metabolic_age_index_years"];
      const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
      const lines = [["captured_at", ...keys].map(esc).join(",")];
      for (const row of rows) lines.push([row.captured_at, row.weight_kg, row.impedance_ohm, ...keys.slice(2).map((key) => row.metrics?.[key]?.value)].map(esc).join(","));
      return lines.join("\n");
    }
  }

  const client = new Client();
  window.MiBalanceData = {
    supported: typeof indexedDB !== "undefined",
    bluetoothSupported: Boolean(navigator.bluetooth),
    getState: () => client.state(),
    sync: () => client.sync(),
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
    saveProfile: (json) => client.saveProfile(typeof json === "string" ? JSON.parse(json) : json),
    exportCsv: () => client.exportCsv(),
    _test: { calculateMetrics, decodeFrame, enrichMetrics, validProfile, ageOn },
  };
})();
