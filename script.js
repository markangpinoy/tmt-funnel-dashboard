/* =========================
   CONFIG
========================= */
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQodpSGaQTvWB7i7sUMZ-5lS17ILsch4R4OxKofe22s8gKNXt_BCvHiQ6Ddvg0LD14F1KgWlmkh0kri/pub?output=csv";
/* =========================
   GLOBAL STATE
========================= */
let rawRows = [];
let filteredRows = [];

let trendChart = null;
let trendChartMobile = null;

let currentMetric = "ctr";
let currentGranularity = "day";

/* =========================
   HELPERS
========================= */
const normKey = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[()]/g, "")
    .replace(/[%]/g, "percent");

const toNumber = (v) => {
  if (v === null || v === undefined) return 0;
  const s = String(v).replace(/₱/g, "").replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const peso = (n) => "₱" + Number(n || 0).toLocaleString("en-PH", { maximumFractionDigits: 0 });
const num0 = (n) => Number(n || 0).toLocaleString("en-PH", { maximumFractionDigits: 0 });
const pct1 = (n) => (Number.isFinite(n) ? (n * 100).toFixed(1) + "%" : "0.0%");
const x2 = (n) => (Number.isFinite(n) ? n.toFixed(2) + "x" : "0.00x");

const parseDate = (v) => {
  // accepts "January 1, 2026" or "1/1/2026"
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const getVal = (row, keyIndex, aliases) => {
  for (const a of aliases) {
    const k = normKey(a);
    const idx = keyIndex.get(k);
    if (idx !== undefined) return row[idx];
  }
  return "";
};

const safeDiv = (a, b) => (b ? a / b : 0);

/* =========================
   COLUMN ALIASES (match your sheet)
========================= */
const COLS = {
  date: ["date"],
  channel: ["channel", "chan"],
  adSpend: ["ad spend", "spend"],
  impressions: ["impressions", "impression"],
  clicks: ["clicks", "click"],
  leads: ["leads", "lead"],
  booked: ["leads booked", "booked", "booked calls", "book"],
  showUps: ["show-ups", "show ups", "show"],
  qualifiedCalls: ["qualified calls", "sales calls tagged qualified", "sales calls qualified", "qual calls"],
  dealsClosed: ["deals closed", "deals", "deal closed"],
  revenueBooked: ["revenue booked", "revenue", "revenue (booked)"],
  cashCollected: ["cash-in collected", "cash-in (collected)", "cash collected", "cash-in", "cash in collected"]
};

/* =========================
   UI ELEMENTS
========================= */
const el = (id) => document.getElementById(id);

const errorBox = el("errorContainer");
const lastUpdated = el("lastUpdated");

const startDate = el("startDate");
const endDate = el("endDate");
const startDateMobile = el("startDateMobile");
const endDateMobile = el("endDateMobile");

const channelFilter = el("channelFilter");

const btnSync = el("btnSync");
const btnSyncMobile = el("btnSyncMobile");

const kpiTopRow = el("kpiTopRow");
const kpiCPAContainer = el("kpiCPAContainer");

const funnelContainer = el("funnelContainer");
const funnelContainerMobile = el("funnelContainerMobile");

const benchmarkBody = el("benchmarkBody");
const focusSummary = el("focusSummary");
const focusList = el("focusList");

const tableHeader = el("tableHeader");
const tableBody = el("tableBody");
const tableSearch = el("tableSearch");
const rowLimit = el("rowLimit");

const btnDaily = el("btnDaily");
const btnWeekly = el("btnWeekly");
const btnDailyMobile = el("btnDailyMobile");
const btnWeeklyMobile = el("btnWeeklyMobile");

/* =========================
   TABS (mobile)
========================= */
function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  const activate = (id) => {
    panels.forEach(p => p.classList.remove("active"));
    buttons.forEach(b => b.classList.remove("tab-active"));
    document.getElementById(id)?.classList.add("active");
    document.querySelector(`.tab-btn[data-tab="${id}"]`)?.classList.add("tab-active");
  };

  // default
  activate("tab-kpis");

  buttons.forEach(btn => {
    btn.addEventListener("click", () => activate(btn.dataset.tab));
  });
}

/* =========================
   LOAD CSV
========================= */
function showError(msg) {
  errorBox.classList.remove("hidden");
  errorBox.textContent = msg;
}

function clearError() {
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

async function fetchCSV() {
  clearError();

  if (!CSV_URL || CSV_URL.includes("PASTE_YOUR")) {
    showError("Please paste your published CSV URL in script.js (CSV_URL).");
    return;
  }

  Papa.parse(CSV_URL, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: (res) => {
      const rows = res.data || [];
      rawRows = rows.map(r => {
        // normalize keys
        const o = {};
        Object.keys(r).forEach(k => o[normKey(k)] = r[k]);
        return o;
      });
      initFilters();
      applyFiltersAndRender();
      lastUpdated.textContent = "Live: " + new Date().toLocaleTimeString();
    },
    error: () => showError("Failed to load Google Sheet CSV. Make sure the sheet is published to web as CSV.")
  });
}

/* =========================
   FILTERS
========================= */
function initFilters() {
  // channel dropdown
  const channels = Array.from(new Set(rawRows.map(r => String(r[normKey("Channel")] || r[normKey("Chan")] || "").trim()).filter(Boolean)));
  channelFilter.innerHTML = `<option value="All">All Channels</option>` + channels.map(c => `<option value="${c}">${c}</option>`).join("");

  // date range defaults
  const dates = rawRows.map(r => parseDate(r[normKey("Date")])).filter(Boolean).sort((a,b)=>a-b);
  if (dates.length) {
    const min = dates[0];
    const max = dates[dates.length - 1];
    const toISO = (d) => d.toISOString().slice(0,10);
    startDate.value = toISO(min);
    endDate.value = toISO(max);
    startDateMobile.value = toISO(min);
    endDateMobile.value = toISO(max);
  }
}

function applyFiltersAndRender() {
  const s = new Date((startDate.value || startDateMobile.value) + "T00:00:00");
  const e = new Date((endDate.value || endDateMobile.value) + "T23:59:59");
  const chan = channelFilter.value || "All";

  filteredRows = rawRows.filter(r => {
    const d = parseDate(r[normKey("Date")]);
    if (!d) return false;
    const inRange = d >= s && d <= e;
    const ch = String(r[normKey("Channel")] || r[normKey("Chan")] || "").trim();
    const inChan = (chan === "All") ? true : (ch === chan);
    return inRange && inChan;
  });

  renderAll();
}

/* =========================
   METRIC GETTERS (from normalized object)
========================= */
function v(row, keyAliases) {
  for (const a of keyAliases) {
    const k = normKey(a);
    if (row[k] !== undefined) return row[k];
  }
  return "";
}

function sum(aliasList) {
  return filteredRows.reduce((acc, r) => acc + toNumber(v(r, aliasList)), 0);
}

/* =========================
   RENDER KPI
========================= */
function kpiCard(title, value, subtitle="") {
  return `
    <div class="bg-white rounded-lg card-shadow p-3">
      <div class="text-[10px] font-bold text-tmt-600 uppercase">${title}</div>
      <div class="text-sm font-extrabold text-slate-800 mt-1">${value}</div>
      ${subtitle ? `<div class="text-[10px] text-slate-500 mt-1">${subtitle}</div>` : ""}
    </div>
  `;
}

function kpiBigCPA(value, status) {
  const statusColor = status === "Risky" ? "text-red-600" : status === "Fair" ? "text-amber-600" : "text-green-700";
  const borderColor = status === "Risky" ? "border-red-400" : status === "Fair" ? "border-amber-400" : "border-green-400";
  return `
    <div class="bg-white rounded-lg card-shadow p-3 border ${borderColor}">
      <div class="text-[10px] font-bold text-tmt-600 uppercase text-center">Cost per Acquisition (CPA)</div>
      <div class="text-xl font-extrabold text-slate-800 text-center mt-1">${value}</div>
      <div class="text-[11px] font-bold ${statusColor} text-center mt-1">${status}</div>
    </div>
  `;
}

/* =========================
   FUNNEL (Image 2 style)
========================= */
function renderFunnel(targetEl, stats, isMobile = false) {
  if (!targetEl) return;

  const steps = [
    { key: "impressions", label: "Impressions", icon: "fa-eye", value: stats.impressions, rate: null },
    { key: "clicks",      label: "Clicks",      icon: "fa-mouse-pointer", value: stats.clicks, rate: stats.ctr },
    { key: "leads",       label: "Leads",       icon: "fa-user-plus", value: stats.leads, rate: stats.leadConv },
    { key: "booked",      label: "Booked",      icon: "fa-phone", value: stats.booked, rate: stats.bookRate },
    { key: "showUps",     label: "Show-Ups",    icon: "fa-video", value: stats.showUps, rate: stats.showRate },
    { key: "qualifiedCalls", label: "Qualified Calls", icon: "fa-user-check", value: stats.qualifiedCalls, rate: stats.qualRate },
    { key: "dealsClosed", label: "Deals Closed", icon: "fa-handshake", value: stats.dealsClosed, rate: stats.closeRate },
  ];

  const maxVal = Math.max(...steps.map(s => Number(s.value || 0)), 1);

  const line = `<div class="funnel-flow-line"></div>`;

  const rows = steps.map((s) => {
    // funnel width: impressions widest, deals narrowest
    // clamp so it still looks good even if values are tiny
    const raw = Math.max(0, Math.min(1, (Number(s.value || 0) / maxVal)));

// make taper more dramatic (power curve)
// higher exponent = more narrowing
const ratio = Math.pow(raw, 0.55);  // try 0.45 (more dramatic) or 0.65 (less)

// width range
const maxPct = 95;   // top width
const minPct = 22;   // bottom minimum width (make smaller if you want)
const finalWidth = minPct + (maxPct - minPct) * ratio;

    const rateChip = (s.rate === null)
      ? ""
      : `<span class="funnel-connector"><i class="fa-solid fa-arrow-trend-up"></i> ${pct1(s.rate)}</span>`;

    // Desktop: keep the chip floating outside (your existing style)
    // Mobile: chip sits inside the row (CSS does this)
    return `
      <div class="funnel-row" style="--roww:${finalWidth}%;">
        <div class="flex items-center">
          <span class="funnel-icon"><i class="fa-solid ${s.icon}"></i></span>
          <span>${s.label}</span>
        </div>

        <div class="flex items-center gap-2">
          <span class="funnel-stat">${num0(s.value)}</span>
          ${rateChip}
        </div>
      </div>
    `;
  }).join("");

  targetEl.innerHTML = line + rows;
}


/* =========================
   BENCHMARKS + FOCUS
========================= */
function statusChip(status) {
  const base = "px-2 py-0.5 rounded-full text-[9px] font-bold inline-block";
  if (status === "Excellent") return `<span class="${base} bg-green-100 text-green-700">Excellent</span>`;
  if (status === "Good") return `<span class="${base} bg-emerald-100 text-emerald-700">Good</span>`;
  if (status === "Fair") return `<span class="${base} bg-amber-100 text-amber-700">Fair</span>`;
  return `<span class="${base} bg-red-100 text-red-700">Risky</span>`;
}

function classify(name, value) {
  // simple thresholds (you can change later)
  if (name.includes("Click-Through")) return value >= 0.01 ? "Good" : value >= 0.007 ? "Fair" : "Risky";
  if (name.includes("Cost per Click")) return value <= 50 ? "Excellent" : value <= 80 ? "Fair" : "Risky";
  if (name.includes("Lead Conversion")) return value >= 0.10 ? "Excellent" : value >= 0.07 ? "Fair" : "Risky";
  if (name.includes("Cost per Lead")) return value <= 250 ? "Excellent" : value <= 400 ? "Fair" : "Risky";
  if (name.includes("Show-Up")) return value >= 0.25 ? "Excellent" : value >= 0.15 ? "Fair" : "Risky";
  if (name.includes("Qualified Call Rate")) return value >= 0.15 ? "Excellent" : value >= 0.10 ? "Fair" : "Risky";
  if (name.includes("Close Rate")) return value >= 0.20 ? "Excellent" : value >= 0.12 ? "Fair" : "Risky";
  if (name.includes("Cost per Acquisition")) return value <= 30000 ? "Excellent" : value <= 60000 ? "Fair" : "Risky";
  if (name.includes("Return on Ad Spend")) return value >= 3 ? "Excellent" : value >= 2 ? "Fair" : "Risky";
  if (name.includes("Marketing Efficiency Ratio")) return value >= 2 ? "Excellent" : value >= 1.2 ? "Fair" : "Risky";
  return "Good";
}

function renderBenchmarks(stats) {
  const rows = [
    { name: "Click-Through Rate (CTR)", val: stats.ctr, fmt: pct1(stats.ctr) },
    { name: "Cost per Click (CPC)", val: stats.cpc, fmt: peso(stats.cpc) },
    { name: "Lead Conversion Rate (Clicks → Leads)", val: stats.leadConv, fmt: pct1(stats.leadConv) },
    { name: "Cost per Lead (CPL)", val: stats.cpl, fmt: peso(stats.cpl) },
    { name: "Show-Up Rate (Booked → Show-Ups)", val: stats.showRate, fmt: pct1(stats.showRate) },
    { name: "Qualified Call Rate (Show-Ups → Qualified Calls)", val: stats.qualRate, fmt: pct1(stats.qualRate) },
    { name: "Close Rate (Qualified Calls → Deals Closed)", val: stats.closeRate, fmt: pct1(stats.closeRate) },
    { name: "Cost per Acquisition (CPA)", val: stats.cpa, fmt: peso(stats.cpa) },
    { name: "Return on Ad Spend (ROAS)", val: stats.roas, fmt: x2(stats.roas) },
    { name: "Marketing Efficiency Ratio (MER)", val: stats.mer, fmt: x2(stats.mer) },
  ];

  benchmarkBody.innerHTML = rows.map(r => {
    const s = classify(r.name, r.val);
    return `
      <tr>
        <td class="px-2 py-1.5 text-slate-700">${r.name}</td>
        <td class="px-2 py-1.5 text-right font-bold text-slate-800">${r.fmt}</td>
        <td class="px-2 py-1.5 text-center">${statusChip(s)}</td>
      </tr>
    `;
  }).join("");

  // Focus Area = list all Fair/Risky
  const needs = rows
    .map(r => ({...r, status: classify(r.name, r.val)}))
    .filter(r => r.status === "Fair" || r.status === "Risky");

  const risky = needs.filter(n => n.status === "Risky").length;
  const fair = needs.filter(n => n.status === "Fair").length;

  focusSummary.textContent = `Needs Attention: ${risky} Risky • ${fair} Fair`;
  focusList.innerHTML = needs.length
    ? needs.map(n => `• ${n.name}: <b>${n.status}</b> (${n.fmt})`).join("<br>")
    : `All key metrics look healthy. Keep scaling with control.`;
}

/* =========================
   TABLE
========================= */
function renderTable() {
  const headers = ["Date","Channel","Ad Spend","Impressions","Clicks","Leads","Qualified Calls","Booked","Show-Ups","Deals Closed","Revenue (Booked)","Cash-In (Collected)"];
  tableHeader.innerHTML = headers.map(h => `<th class="px-2 py-2 text-[10px]">${h}</th>`).join("");

  const q = (tableSearch.value || "").toLowerCase();
  const limit = Number(rowLimit.value || 10);

  const rows = filteredRows
    .filter(r => JSON.stringify(r).toLowerCase().includes(q))
    .slice(0, limit);

  tableBody.innerHTML = rows.map(r => {
    const d = v(r, COLS.date);
    const ch = v(r, COLS.channel);
    const spend = toNumber(v(r, COLS.adSpend));
    const imp = toNumber(v(r, COLS.impressions));
    const clk = toNumber(v(r, COLS.clicks));
    const lead = toNumber(v(r, COLS.leads));
    const qual = toNumber(v(r, COLS.qualifiedCalls));
    const book = toNumber(v(r, COLS.booked));
    const show = toNumber(v(r, COLS.showUps));
    const deals = toNumber(v(r, COLS.dealsClosed));
    const rev = toNumber(v(r, COLS.revenueBooked));
    const cash = toNumber(v(r, COLS.cashCollected));

    return `
      <tr>
        <td class="px-2 py-1.5">${d}</td>
        <td class="px-2 py-1.5 font-bold text-tmt-700">${ch}</td>
        <td class="px-2 py-1.5 text-right">${peso(spend)}</td>
        <td class="px-2 py-1.5 text-right">${num0(imp)}</td>
        <td class="px-2 py-1.5 text-right">${num0(clk)}</td>
        <td class="px-2 py-1.5 text-right">${num0(lead)}</td>
        <td class="px-2 py-1.5 text-right font-bold text-tmt-700">${num0(qual)}</td>
        <td class="px-2 py-1.5 text-right">${num0(book)}</td>
        <td class="px-2 py-1.5 text-right">${num0(show)}</td>
        <td class="px-2 py-1.5 text-right font-bold">${num0(deals)}</td>
        <td class="px-2 py-1.5 text-right font-bold text-tmt-700">${peso(rev)}</td>
        <td class="px-2 py-1.5 text-right font-bold text-tmt-700">${peso(cash)}</td>
      </tr>
    `;
  }).join("");
}

/* =========================
   CHART
========================= */
function buildSeries(metric, granularity) {
  // daily buckets
  const map = new Map();

  const keyFor = (d) => {
    const dd = new Date(d);
    if (granularity === "week") {
      // ISO-ish week key: YYYY-WW (simple)
      const onejan = new Date(dd.getFullYear(),0,1);
      const week = Math.ceil((((dd - onejan) / 86400000) + onejan.getDay()+1)/7);
      return `${dd.getFullYear()}-W${String(week).padStart(2,"0")}`;
    }
    return dd.toISOString().slice(0,10);
  };

  filteredRows.forEach(r => {
    const d = parseDate(v(r, COLS.date));
    if (!d) return;
    const k = keyFor(d);
    if (!map.has(k)) map.set(k, { spend:0, imp:0, clk:0, lead:0, cash:0 });

    const o = map.get(k);
    o.spend += toNumber(v(r, COLS.adSpend));
    o.imp += toNumber(v(r, COLS.impressions));
    o.clk += toNumber(v(r, COLS.clicks));
    o.lead += toNumber(v(r, COLS.leads));
    o.cash += toNumber(v(r, COLS.cashCollected));
  });

  const labels = Array.from(map.keys()).sort();
  const data = labels.map(l => {
    const o = map.get(l);
    if (metric === "ctr") return safeDiv(o.clk, o.imp);
    if (metric === "cpc") return safeDiv(o.spend, o.clk);
    if (metric === "cpl") return safeDiv(o.spend, o.lead);
    if (metric === "mer") return safeDiv(o.cash, o.spend);
    return 0;
  });

  return { labels, data };
}

function renderChart(canvasId, metric, granularity) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const { labels, data } = buildSeries(metric, granularity);

  const isPct = metric === "ctr";
  const isPeso = metric === "cpc" || metric === "cpl";
  const isX = metric === "mer";

  return new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: metric.toUpperCase(),
        data,
        tension: 0.35,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          ticks: {
            callback: (v) => {
              if (isPct) return (v*100).toFixed(1) + "%";
              if (isPeso) return "₱" + Number(v).toLocaleString("en-PH", { maximumFractionDigits: 0 });
              if (isX) return Number(v).toFixed(2) + "x";
              return v;
            }
          }
        }
      }
    }
  });
}

/* =========================
   MAIN RENDER
========================= */
function computeStats() {
  const spend = sum(COLS.adSpend);
  const impressions = sum(COLS.impressions);
  const clicks = sum(COLS.clicks);
  const leads = sum(COLS.leads);
  const booked = sum(COLS.booked);
  const showUps = sum(COLS.showUps);
  const qualifiedCalls = sum(COLS.qualifiedCalls);
  const dealsClosed = sum(COLS.dealsClosed);
  const revenue = sum(COLS.revenueBooked);
  const cash = sum(COLS.cashCollected);

  const ctr = safeDiv(clicks, impressions);
  const leadConv = safeDiv(leads, clicks);
  const bookRate = safeDiv(booked, leads);
  const showRate = safeDiv(showUps, booked);
  const qualRate = safeDiv(qualifiedCalls, showUps);
  const closeRate = safeDiv(dealsClosed, qualifiedCalls);

  const cpc = safeDiv(spend, clicks);
  const cpl = safeDiv(spend, leads);

  const roas = safeDiv(revenue, spend);
  const mer = safeDiv(cash, spend);

  const cpa = safeDiv(spend, dealsClosed); // acquisition = deal closed

  return {
    spend, impressions, clicks, leads, booked, showUps, qualifiedCalls, dealsClosed,
    revenue, cash,
    ctr, leadConv, bookRate, showRate, qualRate, closeRate,
    cpc, cpl, roas, mer, cpa
  };
}

function renderKPIs(stats) {
  const top = [
    kpiCard("Ad Spend", peso(stats.spend)),
    kpiCard("Revenue (Booked)", peso(stats.revenue)),
    kpiCard("Cash Collected", peso(stats.cash)),
    kpiCard("Qualified Calls", num0(stats.qualifiedCalls)),
    kpiCard("Deals Closed", num0(stats.dealsClosed)),
    kpiCard("Return on Ad Spend (ROAS)", x2(stats.roas)),
    kpiCard("Marketing Efficiency Ratio (MER)", x2(stats.mer)),
  ];

  kpiTopRow.innerHTML = top.map(x => x).join("");

  const cpaStatus = classify("Cost per Acquisition", stats.cpa);
  kpiCPAContainer.innerHTML = kpiBigCPA(peso(stats.cpa), cpaStatus);
}

function renderTrends() {
  // destroy old
  if (trendChart) trendChart.destroy();
  if (trendChartMobile) trendChartMobile.destroy();

  trendChart = renderChart("trendChart", currentMetric, currentGranularity);
  trendChartMobile = renderChart("trendChartMobile", currentMetric, currentGranularity);

  // set active button state
  document.querySelectorAll(".chart-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(`.chart-btn[data-metric="${currentMetric}"]`).forEach(b => b.classList.add("active"));
}

function renderAll() {
  const stats = computeStats();

  // KPIs
  renderKPIs(stats);

  // Funnel
  renderFunnel(funnelContainer, stats, false);
renderFunnel(funnelContainerMobile, stats, true);

  // Benchmarks + focus
  renderBenchmarks(stats);

  // Table
  renderTable();

  // Trends
  renderTrends();
}

/* =========================
   EVENTS
========================= */
function wireEvents() {
  btnSync?.addEventListener("click", fetchCSV);
  btnSyncMobile?.addEventListener("click", fetchCSV);

  startDate?.addEventListener("change", applyFiltersAndRender);
  endDate?.addEventListener("change", applyFiltersAndRender);
  startDateMobile?.addEventListener("change", () => { startDate.value = startDateMobile.value; applyFiltersAndRender(); });
  endDateMobile?.addEventListener("change", () => { endDate.value = endDateMobile.value; applyFiltersAndRender(); });

  channelFilter?.addEventListener("change", applyFiltersAndRender);

  tableSearch?.addEventListener("input", renderTable);
  rowLimit?.addEventListener("change", renderTable);

  document.querySelectorAll(".chart-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      currentMetric = btn.dataset.metric;
      renderTrends();
    });
  });

  const setGran = (g) => {
    currentGranularity = g;
    renderTrends();
  };

  btnDaily?.addEventListener("click", () => setGran("day"));
  btnWeekly?.addEventListener("click", () => setGran("week"));
  btnDailyMobile?.addEventListener("click", () => setGran("day"));
  btnWeeklyMobile?.addEventListener("click", () => setGran("week"));
}

/* =========================
   INIT
========================= */
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  wireEvents();
  fetchCSV();
});


