(() => {
  const $ = (selector) => document.querySelector(selector);
  const els = {
    authScreen: $("#auth-screen"), appShell: $("#app-shell"), loginForm: $("#login-form"), authError: $("#auth-error"), passkeyLogin: $("#passkey-login"),
    dot: $("#connection-dot"), connectionLabel: $("#connection-label"), connectionButton: $("#connection-button"),
    status: $("#status-message"), weight: $("#latest-weight"), date: $("#latest-date"), captureState: $("#capture-state"),
    metricGrid: $("#all-metrics"), metricsDate: $("#metrics-date"), metricSummary: $("#metric-summary"),
    history: $("#history-rows"), historyEmpty: $("#history-empty"), historyCount: $("#history-count"), historySummary: $("#history-summary"),
    chartMetric: $("#chart-metric"), chartPeriod: $("#chart-period"), chartWrap: $("#chart-wrap"), chartSummary: $("#chart-summary"),
    exportButton: $("#export-button"), profileForm: $("#profile-form"), profileDetails: $("#profile-details"),
    accountEmail: $("#account-email"), accountStatus: $("#account-status"), addPasskey: $("#add-passkey"), signOut: $("#sign-out"),
  };
  const NS = "http://www.w3.org/2000/svg";
  const CACHE_KEY = "miBalance.androidBridgeState";
  const metricSpecs = [
    ["body_fat_percent", "Grasa corporal", "%", 1], ["muscle_mass_kg", "Masa muscular", "kg", 1], ["water_percent", "Agua corporal", "%", 1],
    ["bmi", "Índice de masa corporal", "", 1], ["fat_mass_kg", "Masa grasa", "kg", 1], ["fat_free_mass_kg", "Masa libre de grasa", "kg", 1],
    ["water_mass_kg", "Masa de agua", "kg", 1], ["bone_mass_kg", "Masa ósea", "kg", 2], ["protein_percent", "Proteína", "%", 1],
    ["visceral_fat_index", "Índice de grasa visceral", "", 1], ["basal_metabolic_rate_kcal_day", "Metabolismo basal", "kcal/día", 0],
    ["metabolic_age_index_years", "Edad metabólica", "años", 1], ["body_type_code", "Tipo corporal", "", 0],
  ];
  let state = null;
  let profileDirty = new Set();
  let busy = false;
  let lastReadFailed = false;
  let storageKey = CACHE_KEY;
  let currentUser = null;
  let pollTimer = null;

  const fmt = (value, digits = 1) => Number.isFinite(Number(value))
    ? new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value))
    : "—";
  const dateTime = (value) => {
    if (!value) return "Fecha no disponible";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Fecha no disponible" : new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short" }).format(date);
  };
  const shortDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  };
  const unwrap = (value) => {
    if (typeof value === "string") {
      try { return JSON.parse(value); } catch { return value; }
    }
    return value;
  };
  const bridge = () => window.AndroidBridge && typeof window.AndroidBridge.getState === "function" ? window.AndroidBridge : null;
  const pwa = () => window.MiBalanceData && typeof window.MiBalanceData.getState === "function" ? window.MiBalanceData : null;
  const auth = () => window.MiBalanceAuth || null;
  const bridgeCall = async (name, payload) => {
    const api = bridge();
    if (!api || typeof api[name] !== "function") throw new Error(`La operación ${name} no está disponible.`);
    const raw = name === "saveProfile" ? api[name](JSON.stringify(payload)) : payload === undefined ? api[name]() : api[name]();
    const result = unwrap(await raw);
    if (result && typeof result === "object" && result.ok === false) throw new Error(result.error || "No se pudo completar la operación.");
    if (result && typeof result === "object" && result.error) throw new Error(result.error);
    return result;
  };
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function svgNode(tag, attrs = {}, label) {
    const element = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
    if (label !== undefined) element.textContent = label;
    return element;
  }
  function setStatus(message, type = "") {
    els.status.className = `status-line${type ? ` status-${type}` : ""}`;
    els.status.replaceChildren(node("span", "status-symbol", type === "error" ? "!" : "·"), node("span", "", message));
  }
  function authMessage(error) {
    if (!error) return "No se pudo completar el acceso.";
    return error.message || error.statusText || String(error);
  }
  function showAuth(message = "") {
    currentUser = null;
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = null;
    els.appShell.hidden = true;
    els.authScreen.hidden = false;
    els.authError.textContent = message;
  }
  function showApp(user) {
    currentUser = user;
    els.authScreen.hidden = true;
    els.appShell.hidden = false;
    els.authError.textContent = "";
    els.accountEmail.textContent = user?.email || "";
  }
  function profileFromState(profile) {
    if (!profile) return;
    for (const [name, value] of Object.entries(profile)) {
      const input = els.profileForm.elements.namedItem(name);
      if (!input || profileDirty.has(name) || document.activeElement === input) continue;
      input.value = value ?? "";
    }
  }
  function connection(status) {
    const running = Boolean(status?.running);
    els.dot.classList.toggle("is-connected", running);
    els.connectionLabel.textContent = running ? (status.message || "Báscula conectada") : (status?.message || "Báscula desconectada");
    els.connectionButton.textContent = running ? "Desconectar" : "Conectar";
    els.connectionButton.disabled = busy;
  }
  function metricEntry(metrics, key) {
    const entry = metrics?.[key];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) return { value: entry.value ?? null, range: entry.range ?? null };
    return { value: entry ?? null, range: null };
  }
  function metricText(value, suffix, digits) {
    if (value == null || value === "") return "—";
    const formatted = Number.isFinite(Number(value)) ? fmt(value, digits) : String(value);
    return `${formatted}${suffix ? ` ${suffix}` : ""}`;
  }
  function rangeLabel(range) {
    if (!range) return "Sin rango científico";
    if (range?.label) return String(range.label);
    const labels = {
      within: "Dentro del rango", normal: "Dentro del rango", in_range: "Dentro del rango",
      below: "Por debajo del rango", low: "Por debajo del rango", above: "Por encima del rango", high: "Por encima del rango",
    };
    return range?.state ? (labels[String(range.state).toLowerCase()] || String(range.state)) : "Rango sin estado";
  }
  function rangeText(range, suffix) {
    if (!range) return "No hay un rango científico disponible para esta métrica.";
    const hasLow = range.low !== null && range.low !== undefined && range.low !== "";
    const hasHigh = range.high !== null && range.high !== undefined && range.high !== "";
    if (!hasLow && !hasHigh) return "No hay un intervalo numérico individual validado para esta estimación.";
    const low = hasLow ? metricText(range.low, "", 1) : "—";
    const high = hasHigh ? metricText(range.high, "", 1) : "—";
    return `Rango recibido: ${low}–${high}${suffix ? ` ${suffix}` : ""}.`;
  }
  function appendEvidence(details, range, suffix) {
    const summary = node("summary", "evidence-toggle", "Rango y evidencia");
    const content = node("div", "evidence-content");
    content.append(node("p", "range-detail", rangeText(range, suffix)));
    if (range) {
      if (range.evidence_type) content.append(node("p", "evidence-line", `Tipo de evidencia · ${range.evidence_type}`));
      if (range.study) content.append(node("p", "evidence-line", `Estudio · ${range.study}`));
      if (range.note) content.append(node("p", "evidence-line", String(range.note)));
      if (range.source_url) {
        let url;
        try { url = new URL(range.source_url); } catch { url = null; }
        if (url && ["https:", "http:"].includes(url.protocol)) {
          const link = node("a", "source-link", "Consultar fuente ↗");
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          content.append(link);
        }
      }
    }
    details.append(summary, content);
  }
  function renderMetrics(latest) {
    els.metricGrid.replaceChildren();
    els.metricsDate.textContent = latest ? `Última medición · ${shortDate(latest.captured_at)}` : "Sin mediciones guardadas";
    for (const [key, title, suffix, digits] of metricSpecs) {
      const entry = metricEntry(latest?.metrics, key);
      const card = node("article", "metric-card");
      card.append(node("h2", "metric-name", title));
      const value = node("p", "metric-value", metricText(entry.value, suffix, digits));
      card.append(value);
      const badge = node("span", `range-badge${entry.range ? " has-range" : " no-range"}`, rangeLabel(entry.range));
      card.append(badge);
      const details = node("details", "evidence-details");
      appendEvidence(details, entry.range, suffix);
      card.append(details);
      els.metricGrid.append(card);
    }
    els.metricSummary.textContent = latest?.metrics ? "13 estimaciones disponibles" : "Sin estimaciones disponibles";
  }
  function livePacket(status) {
    const packet = status?.last_packet;
    const age = packet?.captured_at ? Date.now() - new Date(packet.captured_at).getTime() : Infinity;
    return packet && status.running && age < 15000 ? packet : null;
  }
  function captureDescription(measurement, status) {
    const packet = livePacket(status);
    if (packet && !packet.load_removed && packet.stabilized === false) {
      return packet.impedance_ohm == null ? "Peso provisional · esperando una lectura estable." : "Peso provisional · la lectura aún no se ha estabilizado.";
    }
    if (measurement?.impedance_ohm == null) return "Peso guardado · composición no disponible.";
    if (!measurement?.metrics) return "Impedancia registrada · estimaciones no disponibles.";
    return "Lectura con impedancia · composición estimada.";
  }
  function renderLatest(measurements, status) {
    const latest = measurements[0];
    const packet = livePacket(status);
    const provisionalWeight = packet?.weight_kg ?? packet?.weight;
    if (packet?.stabilized === false && !packet.load_removed && Number.isFinite(Number(provisionalWeight))) {
      els.weight.textContent = fmt(provisionalWeight, 2);
      els.date.textContent = dateTime(packet.captured_at);
      els.captureState.textContent = captureDescription(null, status);
    } else if (!latest) {
      els.weight.textContent = "—";
      els.date.textContent = status?.phase === "error" ? "No se pudo completar la última pesada" : "Esperando una medición";
      els.captureState.textContent = "Conecta la báscula para guardar una pesada.";
    } else {
      els.weight.textContent = fmt(latest.weight_kg, 2);
      els.date.textContent = dateTime(latest.captured_at);
      els.captureState.textContent = captureDescription(latest, status);
    }
    const count = measurements.length;
    $("#insight-copy").textContent = count
      ? `Tienes ${count} ${count === 1 ? "registro" : "registros"} guardados. Las estimaciones son orientativas y no constituyen un diagnóstico.`
      : "Las estimaciones de composición corporal son orientativas y no constituyen un diagnóstico.";
    els.historySummary.textContent = `${count} ${count === 1 ? "medición guardada" : "mediciones guardadas"}`;
  }
  function renderHistory(measurements) {
    els.history.replaceChildren();
    els.historyCount.textContent = `${measurements.length} ${measurements.length === 1 ? "medición" : "mediciones"}`;
    els.historyEmpty.hidden = measurements.length > 0;
    for (const item of measurements) {
      const card = node("article", "history-item");
      const main = node("div", "history-main");
      main.append(node("time", "history-date", dateTime(item.captured_at)));
      const kind = item.impedance_ohm == null ? "Sin impedancia" : item.metrics ? "Composición estimada" : "Con impedancia";
      main.append(node("span", "history-kind", kind));
      const values = node("div", "history-values");
      const weight = node("span", "history-weight");
      weight.append(document.createTextNode(fmt(item.weight_kg, 2)), node("span", "weight-unit-small", " kg"));
      values.append(weight);
      for (const [key, label, suffix, digits] of [["body_fat_percent", "Grasa", "%", 1], ["muscle_mass_kg", "Músculo", "kg", 1], ["water_percent", "Agua", "%", 1]]) {
        const metric = metricEntry(item.metrics, key);
        const group = node("span", "history-metric");
        group.append(node("small", "", label), node("strong", "", metricText(metric.value, suffix, digits)));
        values.append(group);
      }
      card.append(main, values);
      els.history.append(card);
    }
  }
  function renderChart(measurements) {
    const spec = els.chartMetric.value;
    const period = els.chartPeriod.value;
    const days = period === "all" ? Infinity : Number(period);
    const data = measurements.filter((item) => item.captured_at && (Date.now() - new Date(item.captured_at).getTime()) <= days * 86400000)
      .map((item) => ({ date: new Date(item.captured_at), value: spec === "weight_kg" ? item.weight_kg : metricEntry(item.metrics, spec).value }))
      .filter((item) => item.value != null && Number.isFinite(Number(item.value))).sort((a, b) => a.date - b.date);
    const labels = { weight_kg: ["Peso", "kg"], body_fat_percent: ["Grasa corporal", "%"], muscle_mass_kg: ["Masa muscular", "kg"], water_percent: ["Agua corporal", "%"] };
    const [name, unit] = labels[spec];
    els.chartWrap.replaceChildren();
    els.chartSummary.textContent = data.length ? `${data.length} ${data.length === 1 ? "registro" : "registros"} de ${name.toLowerCase()}` : `Sin registros de ${name.toLowerCase()} en este periodo.`;
    if (!data.length) {
      els.chartWrap.append(node("p", "chart-empty", "Aquí aparecerá tu evolución cuando tengas mediciones."));
      return;
    }
    const width = 720, height = 250, pad = { top: 18, right: 18, bottom: 38, left: 52 };
    const values = data.map((item) => Number(item.value));
    let low = Math.min(...values), high = Math.max(...values);
    const spread = high - low || Math.max(Math.abs(high) * 0.08, 1);
    low -= spread * 0.18; high += spread * 0.18;
    const start = data[0].date.getTime(), end = data[data.length - 1].date.getTime();
    const x = (index) => pad.left + (start === end ? 0.5 : (data[index].date.getTime() - start) / (end - start)) * (width - pad.left - pad.right);
    const y = (value) => pad.top + (high - value) / (high - low) * (height - pad.top - pad.bottom);
    const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `Gráfica de ${name.toLowerCase()} en ${unit}; ${data.length} ${data.length === 1 ? "registro" : "registros"}.` });
    for (let i = 0; i <= 4; i++) {
      const tickY = pad.top + (height - pad.top - pad.bottom) * i / 4;
      svg.append(svgNode("line", { x1: pad.left, x2: width - pad.right, y1: tickY, y2: tickY, class: "chart-grid" }));
    }
    if (data.length > 1) svg.append(svgNode("path", { d: data.map((item, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(Number(item.value))}`).join(" "), class: "chart-line" }));
    data.forEach((item, index) => svg.append(svgNode("circle", { cx: x(index), cy: y(Number(item.value)), r: data.length === 1 ? 6 : 4, class: "chart-point" })));
    svg.append(svgNode("text", { x: pad.left, y: height - 8, class: "chart-axis" }, shortDate(data[0].date)));
    if (data.length > 1) svg.append(svgNode("text", { x: width - pad.right, y: height - 8, "text-anchor": "end", class: "chart-axis" }, shortDate(data[data.length - 1].date)));
    els.chartWrap.append(svg);
  }
  function render(next) {
    if (next?.state && !next.measurements) next = next.state;
    if (!next || typeof next !== "object") throw new Error("El estado recibido no tiene un formato válido.");
    state = next;
    const measurements = Array.isArray(next.measurements) ? next.measurements : [];
    profileFromState(next.profile);
    connection(next.status);
    renderLatest(measurements, next.status);
    renderMetrics(measurements[0]);
    renderHistory(measurements);
    renderChart(measurements);
    if (next.status?.phase === "error") setStatus(next.status.message || "La báscula ha indicado un error.", "error");
    else if (next.status?.running) setStatus(next.status.message || "Escuchando la báscula.", "connected");
    else setStatus(next.status?.message || "La báscula está desconectada. Puedes revisar tus mediciones guardadas.");
  }
  function persist(next) {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* El estado sigue en memoria si el almacenamiento local no está disponible. */ }
  }
  async function refresh(silent = false) {
    try {
      let data;
      if (bridge()) {
        data = unwrap(await bridgeCall("getState"));
      } else if (pwa()) {
        data = await pwa().getState();
      } else {
        const response = await fetch("/api/state", { headers: { Accept: "application/json" }, cache: "no-store" });
        data = await response.json();
        if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
      }
      data = unwrap(data);
      if (data?.error) throw new Error(data.error);
      render(data);
      if (bridge()) persist(data);
      lastReadFailed = false;
    } catch (error) {
      if (!silent || !lastReadFailed) setStatus(error.message || "No se pudo cargar el estado.", "error");
      lastReadFailed = true;
    }
  }
  async function mutate(bridgeMethod, path, payload) {
    busy = true;
    connection(state?.status);
    try {
      if (bridge()) {
        const result = await bridgeCall(bridgeMethod, payload);
        if (result && typeof result === "object" && result.measurements) {
          render(result);
          persist(result);
        }
      } else if (pwa()) {
        const result = await pwa()[bridgeMethod](payload);
        if (result && typeof result === "object" && result.measurements) {
          render(result);
          persist(result);
        }
      } else {
        const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload || {}) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Error ${response.status}`);
        if (result && Array.isArray(result.measurements)) render(result);
      }
      await refresh(true);
      return true;
    } catch (error) {
      setStatus(error.message || "No se pudo completar la operación.", "error");
      return false;
    } finally {
      busy = false;
      connection(state?.status);
    }
  }
  async function exportHistory() {
    els.exportButton.disabled = true;
    try {
      if (bridge()) {
        const result = await bridgeCall("exportCsv");
        const csv = typeof result === "string" && result.includes(",") ? result : result?.csv;
        if (csv) downloadCsv(csv);
        else if (!result || result.ok !== true) throw new Error("No se pudo exportar el historial.");
      } else if (pwa()) {
        downloadCsv(await pwa().exportCsv());
      } else {
        const response = await fetch("/api/export.csv", { headers: { Accept: "text/csv" }, cache: "no-store" });
        if (!response.ok) throw new Error("No se pudo exportar el historial.");
        downloadCsv(await response.text());
      }
    } catch (error) {
      setStatus(error.message || "No se pudo exportar el historial.", "error");
    } finally { els.exportButton.disabled = false; }
  }
  async function finishLogin(user) {
    showApp(user);
    if (pwa()) await pwa().sync();
    await refresh();
    if (!pollTimer) pollTimer = window.setInterval(() => refresh(true), 2000);
  }
  async function checkSession() {
    if (!auth()) return showAuth("No se pudo cargar el sistema de acceso.");
    try {
      const result = await auth().getSession();
      if (result?.error) throw result.error;
      if (!result?.data?.user) return showAuth();
      await finishLogin(result.data.user);
    } catch (error) {
      showAuth(authMessage(error));
    }
  }
  function downloadCsv(csv) {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = node("a");
    link.href = url;
    link.download = "mi-balance.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function activateTab(name, focus = false) {
    const tab = $(`[data-tab="${name}"]`);
    if (!tab) return;
    document.querySelectorAll("[data-tab]").forEach((item) => {
      const active = item === tab;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('[role="tabpanel"]').forEach((panel) => { panel.hidden = panel.id !== `panel-${name}`; });
    if (focus) tab.focus();
    if (history.replaceState) history.replaceState(null, "", `#${name}`);
  }
  document.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
  document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    activateTab(button.dataset.go);
  }));
  $(".bottom-nav").addEventListener("keydown", (event) => {
    const tabs = [...document.querySelectorAll("[data-tab]")];
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); activateTab(tabs[next].dataset.tab, true); }
  });
  els.connectionButton.addEventListener("click", () => mutate(state?.status?.running ? "disconnect" : "connect", state?.status?.running ? "/api/disconnect" : "/api/connect", {}));
  els.exportButton.addEventListener("click", exportHistory);
  els.chartMetric.addEventListener("change", () => renderChart(state?.measurements || []));
  els.chartPeriod.addEventListener("change", () => renderChart(state?.measurements || []));
  els.profileForm.addEventListener("input", (event) => profileDirty.add(event.target.name));
  els.profileForm.addEventListener("change", (event) => profileDirty.add(event.target.name));
  els.profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(els.profileForm);
    const saved = await mutate("saveProfile", "/api/profile", { height_cm: Number(form.get("height_cm")), birthdate: form.get("birthdate"), sex: form.get("sex") });
    if (saved) { profileDirty.clear(); els.profileDetails.open = false; }
  });
  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!auth()) return showAuth("No se pudo cargar Better Auth.");
    const form = new FormData(els.loginForm);
    els.authError.textContent = "Comprobando credenciales…";
    try {
      const result = await auth().signIn.email({ email: String(form.get("email") || "").trim(), password: String(form.get("password") || ""), rememberMe: true });
      if (result?.error) throw result.error;
      await finishLogin(result?.data?.user || { email: String(form.get("email") || "") });
      els.loginForm.reset();
    } catch (error) {
      els.authError.textContent = authMessage(error);
    }
  });
  els.passkeyLogin.addEventListener("click", async () => {
    if (!auth()) return showAuth("No se pudo cargar Better Auth.");
    els.authError.textContent = "Abriendo el verificador del dispositivo…";
    try {
      const result = await auth().signIn.passkey({ autoFill: false });
      if (result?.error) throw result.error;
      await checkSession();
    } catch (error) {
      els.authError.textContent = authMessage(error);
    }
  });
  els.addPasskey.addEventListener("click", async () => {
    if (!auth() || !currentUser) return;
    els.addPasskey.disabled = true;
    els.accountStatus.textContent = "Confirma la passkey en tu dispositivo…";
    try {
      const result = await auth().passkey.addPasskey({ name: "Pixel 10", authenticatorAttachment: "platform" });
      if (result?.error) throw result.error;
      els.accountStatus.textContent = "Passkey añadida correctamente.";
    } catch (error) {
      els.accountStatus.textContent = authMessage(error);
    } finally { els.addPasskey.disabled = false; }
  });
  els.signOut.addEventListener("click", async () => {
    try { if (state?.status?.running) await mutate("disconnect", "/api/disconnect", {}); } catch { /* Se cierra la sesión igualmente. */ }
    try { await auth()?.signOut(); } catch { /* La sesión puede haber caducado ya. */ }
    state = null;
    showAuth("Has cerrado la sesión.");
  });

  if (!window.PublicKeyCredential) {
    els.passkeyLogin.disabled = true;
    els.passkeyLogin.title = "Este navegador no admite passkeys.";
  }

  try {
    storageKey = pwa() ? "miBalance.webState.v2" : bridge() ? "miBalance.androidBridgeState.v2" : CACHE_KEY;
    const cached = localStorage.getItem(storageKey);
    if (cached) render(JSON.parse(cached));
  } catch { /* La primera lectura seguirá cargando el estado vigente. */ }
  const initialTab = location.hash.slice(1);
  if (["inicio", "metricas", "historial"].includes(initialTab)) activateTab(initialTab);
  checkSession();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => { /* La interfaz sigue funcionando sin caché offline. */ });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && currentUser && pwa()) pwa().sync().then(() => refresh(true)).catch(() => {});
  });
})();
