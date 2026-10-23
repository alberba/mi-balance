(() => {
  const $ = (selector) => document.querySelector(selector);
  const els = {
    dot: $("#connection-dot"), connectionLabel: $("#connection-label"), connectionButton: $("#connection-button"),
    status: $("#status-message"), weight: $("#latest-weight"), date: $("#latest-date"), captureState: $("#capture-state"),
    pageSummary: $("#page-summary"), compositionDate: $("#composition-date"),
    cards: $("#metric-cards"), allMetrics: $("#all-metrics"), history: $("#history-rows"), historyEmpty: $("#history-empty"),
    historyCount: $("#history-count"), chartMetric: $("#chart-metric"), chartPeriod: $("#chart-period"), chartWrap: $("#chart-wrap"), chartSummary: $("#chart-summary"),
    profileForm: $("#profile-form"), profileDetails: $("#profile-details"),
  };
  const NS = "http://www.w3.org/2000/svg";
  const fmt = (value, digits = 1) => Number.isFinite(Number(value)) ? new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value)) : "—";
  const dateTime = (value) => {
    if (!value) return "Fecha no disponible";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Fecha no disponible" : new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short" }).format(date);
  };
  const shortDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  };
  const metricSpecs = [
    ["body_fat_percent", "Grasa corporal", "%", 1], ["muscle_mass_kg", "Masa muscular", "kg", 1], ["water_percent", "Agua corporal", "%", 1],
    ["bmi", "Índice de masa corporal", "", 1], ["fat_mass_kg", "Masa grasa", "kg", 1], ["fat_free_mass_kg", "Masa libre de grasa", "kg", 1],
    ["water_mass_kg", "Masa de agua", "kg", 1], ["bone_mass_kg", "Masa ósea", "kg", 2], ["protein_percent", "Proteína", "%", 1],
    ["visceral_fat_index", "Índice de grasa visceral", "", 1], ["basal_metabolic_rate_kcal_day", "Metabolismo basal", "kcal/día", 0], ["metabolic_age_index_years", "Edad metabólica", "años", 1],
  ];
  let state = null;
  let profileDirty = new Set();
  let busy = false;
  let fetchFailed = false;
  let chartResizeTimer = 0;
  const livePacket = (status) => {
    const packet = status?.last_packet;
    return packet && status.running && Date.now() - new Date(packet.captured_at).getTime() < 15000 ? packet : null;
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
    els.status.textContent = message;
    els.status.className = `notice${type ? ` notice-${type}` : ""}`;
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
    const phase = status?.phase;
    const label = phase === "error"
      ? "Error de conexión"
      : running
        ? phase === "measuring" ? "Recibiendo pesada" : phase === "scanning" ? "Buscando báscula" : "Báscula conectada"
        : "Báscula desconectada";
    els.dot.classList.toggle("is-connected", running);
    els.connectionLabel.textContent = label;
    els.connectionButton.textContent = running ? "Desconectar" : "Conectar";
    els.connectionButton.disabled = busy;
  }
  function metricValue(metrics, key, suffix, digits) {
    const value = metrics?.[key];
    return value == null || !Number.isFinite(Number(value)) ? "—" : `${fmt(value, digits)}${suffix ? ` ${suffix}` : ""}`;
  }
  function deltaText(current, previous, suffix, digits) {
    if (current == null || previous == null || !Number.isFinite(Number(current)) || !Number.isFinite(Number(previous))) return "Sin comparación anterior";
    const delta = Number(current) - Number(previous);
    if (Math.abs(delta) < 0.05) return "Sin cambio frente a la anterior";
    const direction = delta > 0 ? "↑" : "↓";
    const amount = `${direction} ${fmt(Math.abs(delta), digits)}${suffix === "%" ? " p.p." : ` ${suffix}`}`;
    return `${amount} frente a la anterior`;
  }
  function renderCards(measurements, status) {
    els.cards.replaceChildren();
    const packet = livePacket(status);
    const provisional = Boolean(packet && !packet.load_removed && packet.stabilized === false);
    const latest = provisional ? null : measurements[0];
    const previous = provisional ? null : measurements[1];
    els.compositionDate.textContent = provisional
      ? "Esperando impedancia"
      : latest ? shortDate(latest.captured_at) : "Sin lectura";
    for (const [key, title, suffix, digits] of metricSpecs.slice(0, 3)) {
      const card = node("article", "metric-card");
      const value = node("p", "metric-value", metricValue(latest?.metrics, key, suffix, digits));
      const delta = node("p", "metric-delta", provisional
        ? "Pendiente de la lectura estable"
        : deltaText(latest?.metrics?.[key], previous?.metrics?.[key], suffix, digits));
      card.append(node("h3", "", title), value, delta);
      els.cards.append(card);
    }
  }
  function renderAllMetrics(latest) {
    els.allMetrics.replaceChildren();
    for (const [key, label, suffix, digits] of metricSpecs) {
      const row = document.createElement("tr");
      row.append(node("th", "", label));
      row.lastChild.scope = "row";
      row.append(node("td", "numeric", metricValue(latest?.metrics, key, suffix, digits)));
      els.allMetrics.append(row);
    }
  }
  function captureDescription(measurement, status) {
    const packet = livePacket(status);
    if (packet && !packet.load_removed && packet.stabilized === false) {
      if (packet.impedance_ohm == null) return "Peso provisional · sin impedancia; espera a que la lectura se estabilice.";
      return "Peso provisional · la lectura aún no se ha estabilizado.";
    }
    if (measurement?.impedance_ohm == null) return "Peso registrado sin impedancia · composición no disponible.";
    if (!measurement?.metrics) return "Peso con impedancia registrada · estimaciones no disponibles.";
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
      return;
    }
    if (!latest) {
      els.weight.textContent = "—";
      els.date.textContent = status?.phase === "error" ? "No se pudo completar la última pesada" : "Esperando una medición";
      els.captureState.textContent = status?.last_packet ? captureDescription(null, status) : "Conecta la báscula para guardar una pesada.";
      return;
    }
    els.weight.textContent = fmt(latest.weight_kg, 2);
    els.date.textContent = dateTime(latest.captured_at);
    els.captureState.textContent = captureDescription(latest, status);
    els.pageSummary.textContent = `Peso y composición de la última pesada · ${shortDate(latest.captured_at)}`;
  }
  function renderHistory(measurements, status) {
    els.history.replaceChildren();
    els.historyCount.textContent = `${measurements.length} ${measurements.length === 1 ? "medición" : "mediciones"}`;
    els.historyEmpty.hidden = measurements.length > 0;
    for (const item of measurements) {
      const row = node("article", "history-item");
      const main = node("div", "history-main");
      const reading = item.impedance_ohm == null ? "Sin impedancia" : item.metrics ? "Estimación" : "Con impedancia";
      main.append(node("time", "history-date", dateTime(item.captured_at)), node("span", "history-kind", reading));
      const values = node("div", "history-values");
      const weight = node("span", "history-weight");
      weight.append(document.createTextNode(fmt(item.weight_kg, 2)), node("span", "weight-unit-small", " kg"));
      values.append(weight);
      for (const [key, label, suffix, digits] of [["body_fat_percent", "Grasa", "%", 1], ["muscle_mass_kg", "Músculo", "kg", 1], ["water_percent", "Agua", "%", 1]]) {
        const metric = node("span", "history-metric");
        metric.append(node("small", "", label), node("strong", "", metricValue(item.metrics, key, suffix, digits)));
        values.append(metric);
      }
      row.append(main, values);
      els.history.append(row);
    }
  }
  function renderChart(measurements) {
    const spec = els.chartMetric.value;
    const period = els.chartPeriod.value;
    const now = Date.now();
    const days = period === "all" ? Infinity : Number(period);
    const data = measurements.filter((item) => item.captured_at && (now - new Date(item.captured_at).getTime()) <= days * 86400000)
      .map((item) => ({ date: new Date(item.captured_at), value: spec === "weight_kg" ? item.weight_kg : item.metrics?.[spec] }))
      .filter((item) => item.value != null && Number.isFinite(Number(item.value)))
      .sort((a, b) => a.date - b.date);
    const labels = { weight_kg: ["Peso", "kg"], body_fat_percent: ["Grasa corporal", "%"], muscle_mass_kg: ["Masa muscular", "kg"], water_percent: ["Agua corporal", "%"] };
    const [name, unit] = labels[spec];
    els.chartWrap.replaceChildren();
    els.chartSummary.textContent = data.length === 0
      ? `No hay capturas de ${name.toLowerCase()} en este periodo.`
      : `${data.length} ${data.length === 1 ? "captura" : "capturas"} de ${name.toLowerCase()} · ${fmt(data[0].value, 1)}–${fmt(data[data.length - 1].value, 1)} ${unit}`;
    if (!data.length) {
      els.chartWrap.append(node("p", "chart-empty", "Cuando tengas mediciones, aquí aparecerá tu evolución."));
      return;
    }
    const width = Math.round(Math.max(260, Math.min(760, els.chartWrap.clientWidth || window.innerWidth)));
    const height = width < 480 ? 220 : 300;
    const pad = { top: 18, right: width < 480 ? 12 : 18, bottom: 40, left: width < 480 ? 44 : 52 };
    const values = data.map((item) => Number(item.value));
    let low = Math.min(...values), high = Math.max(...values);
    const spread = high - low || Math.max(Math.abs(high) * 0.08, 1);
    low -= spread * 0.18; high += spread * 0.18;
    const start = data[0].date.getTime(), end = data[data.length - 1].date.getTime();
    const x = (index) => pad.left + (start === end ? 0.5 : (data[index].date.getTime() - start) / (end - start)) * (width - pad.left - pad.right);
    const y = (value) => pad.top + (high - value) / (high - low) * (height - pad.top - pad.bottom);
    const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `Gráfica de ${name.toLowerCase()} en ${unit}, ${data.length} ${data.length === 1 ? "captura" : "capturas"}. ${data.map((d) => `${shortDate(d.date)}: ${fmt(d.value, 1)} ${unit}`).join("; ")}` });
    for (let i = 0; i <= 4; i++) {
      const tickY = pad.top + (height - pad.top - pad.bottom) * i / 4;
      const tickValue = high - (high - low) * i / 4;
      svg.append(svgNode("line", { x1: pad.left, x2: width - pad.right, y1: tickY, y2: tickY, class: "chart-grid" }));
      svg.append(svgNode("text", { x: pad.left - 12, y: tickY + 4, "text-anchor": "end", class: "chart-axis" }, `${fmt(tickValue, 1)} ${unit}`));
    }
    if (data.length > 1) {
      const path = data.map((item, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(Number(item.value))}`).join(" ");
      svg.append(svgNode("path", { d: path, class: "chart-line" }));
    }
    svg.append(svgNode("circle", { cx: x(data.length - 1), cy: y(Number(data[data.length - 1].value)), r: data.length === 1 ? 4 : 3.5, class: "chart-point" }));
    const lastIndex = data.length - 1;
    const candidateIndexes = width < 480
      ? [...new Set([0, Math.floor(lastIndex / 2), lastIndex])]
      : [...new Set([0, Math.floor(lastIndex / 3), Math.round(lastIndex * 2 / 3), lastIndex])];
    const minimumGap = width < 480 ? 104 : 142;
    const labelIndexes = [];
    for (const index of candidateIndexes.sort((a, b) => x(a) - x(b))) {
      const label = shortDate(data[index].date);
      if (labelIndexes.some((selected) => shortDate(data[selected].date) === label)) continue;
      if (labelIndexes.length && x(index) - x(labelIndexes[labelIndexes.length - 1]) < minimumGap) {
        if (index === lastIndex) {
          while (labelIndexes.length && x(index) - x(labelIndexes[labelIndexes.length - 1]) < minimumGap) labelIndexes.pop();
          labelIndexes.push(index);
        }
        continue;
      }
      labelIndexes.push(index);
    }
    for (const index of labelIndexes) {
      svg.append(svgNode("text", { x: x(index), y: height - 10, "text-anchor": index === 0 ? "start" : index === data.length - 1 ? "end" : "middle", class: "chart-axis" }, shortDate(data[index].date)));
    }
    els.chartWrap.append(svg);
    if (data.length === 1) els.chartWrap.append(node("p", "chart-empty single-point", "Una sola captura: todavía no hay una tendencia que mostrar."));
  }
  function render(next) {
    state = next;
    const measurements = Array.isArray(next.measurements) ? next.measurements : [];
    const packet = livePacket(next.status);
    const provisional = Boolean(packet && !packet.load_removed && packet.stabilized === false);
    profileFromState(next.profile);
    connection(next.status);
    renderLatest(measurements, next.status);
    renderCards(measurements, next.status);
    renderAllMetrics(provisional ? null : measurements[0]);
    renderHistory(measurements, next.status);
    renderChart(measurements);
    if (next.status?.phase === "error") setStatus(next.status.message || "La báscula ha indicado un error.", "error");
    else if (next.status?.running) setStatus(next.status.message || "Escuchando la báscula. Súbete descalzo para completar la medición.", "connected");
    else setStatus(next.status?.message || "La báscula está desconectada. Puedes revisar tus mediciones guardadas.");
  }
  async function refresh(silent = false) {
    try {
      const response = await fetch("/api/state", { headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
      fetchFailed = false;
      render(data);
    } catch (error) {
      if (!silent || !fetchFailed) setStatus(error.message || "No se pudo cargar el estado de Mi Balance.", "error");
      fetchFailed = true;
    }
  }
  async function post(path, payload) {
    busy = true;
    connection(state?.status);
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
      if (data && Array.isArray(data.measurements)) render(data);
      else await refresh();
      return true;
    } catch (error) {
      setStatus(error.message || "No se pudo completar la operación.", "error");
      return false;
    } finally {
      busy = false;
      connection(state?.status);
    }
  }
  els.connectionButton.addEventListener("click", () => post(state?.status?.running ? "/api/disconnect" : "/api/connect", {}));
  els.chartMetric.addEventListener("change", () => renderChart(state?.measurements || []));
  els.chartPeriod.addEventListener("change", () => renderChart(state?.measurements || []));
  els.profileForm.addEventListener("input", (event) => profileDirty.add(event.target.name));
  els.profileForm.addEventListener("change", (event) => profileDirty.add(event.target.name));
  els.profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(els.profileForm);
    const saved = await post("/api/profile", { height_cm: Number(form.get("height_cm")), birthdate: form.get("birthdate"), sex: form.get("sex") });
    if (saved) {
      profileDirty.clear();
      els.profileDetails.open = false;
      await refresh(true);
    }
  });
  window.addEventListener("resize", () => {
    if (!state) return;
    window.clearTimeout(chartResizeTimer);
    chartResizeTimer = window.setTimeout(() => renderChart(state.measurements || []), 150);
  }, { passive: true });
  refresh();
  window.setInterval(() => refresh(true), 2000);
})();
