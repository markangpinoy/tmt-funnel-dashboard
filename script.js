/* ===============================
   CONFIG
================================ */
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQodpSGaQTvWB7i7sUMZ-5lS17ILsch4R4OxKofe22s8gKNXt_BCvHiQ6Ddvg0LD14F1KgWlmkh0kri/pub?output=csv";

/* ===============================
   GLOBAL STATE
================================ */
let rawRows = [];
let filteredRows = [];
let trendChart = null;
let trendChartMobile = null;

let currentMetric = "ctr";
let currentGranularity = "day";

/* ===============================
   HELPERS
================================ */
const peso = (n) => {
  const val = Number(n || 0);
  return "₱" + val.toLocaleString("en-PH", { maximumFractionDigits: 0 });
};

const num = (n) => {
  const val = Number(n || 0);
  return isFinite(val) ? val : 0;
};

const pct = (n) => {
  const val = Number(n || 0);
  return (val * 100).toFixed(1) + "%";
};

const safeDiv = (a, b) => (b ? a / b : 0);

const parseDate = (s) => {
  // Accepts: "January 1, 2026" OR "1/1/2026" OR ISO
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const fmtShortDate = (d) => {
  if (!d) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const normalizeHeader = (h) =>
  String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/* ===============================
   COLUMN MAPPING (EXACT)
   Based on your sheet:
   L = Qualified Calls
   M = Deals Closed
   N = Revenue (Booked)
   O = Cash-In (Collected)
================================ */
const COLS = {
  date: ["date"],
  channel: ["channel"],
  campaign: ["campaign"],
  spend: ["ad spend", "spend"],
  impressions: ["impressions"],
  clicks: ["clicks"],
  leads: ["leads", "lead"],
  booked: ["leads booked", "booked", "booked calls"],
  showups: ["show-ups", "show ups", "showup", "show up"],
  qualifiedCalls: ["qualified calls"],         // <-- Column L
  dealsClosed: ["deals closed", "deals"],      // <-- Column M
  revenue: ["revenue (booked)", "revenue booked", "revenue"], // <-- Column N
  cash: ["cash-in (collected)", "cash in (collected)", "cash collected", "cash-in", "cash"] // <-- Column O
};

function findColIndex(headers, aliases) {
  const norm = headers.map(normalizeHeader);
  for (const a of aliases) {
    const idx = norm.indexOf(normalizeHeader(a));
    if (idx !== -1) return idx;
  }
  return -1;
}

function buildRowObj(headers, row) {
  const h = headers;

  const idx = {
    date: findColIndex(h, COLS.date),
    channel: findColIndex(h, COLS.channel),
    campaign: findColIndex(h, COLS.campaign),
    spend: findColIndex(h, COLS.spend),
    impressions: findColIndex(h, COLS.impressions),
    clicks: findColIndex(h, COLS.clicks),
    leads: findColIndex(h, COLS.leads),
    booked: findColIndex(h, COLS.booked),
    showups: findColIndex(h, COLS.showups),
    qualifiedCalls: findColIndex(h, COLS.qualifiedCalls),
    dealsClosed: findColIndex(h, COLS.dealsClosed),
    revenue: findColIndex(h, COLS.revenue),
    cash: findColIndex(h, COLS.cash)
  };

  const get = (i) => (i >= 0 ? row[i] : "");

  const d = parseDate(get(idx.date));
  if (!d) return null;

  return {
    date: d,
    dateRaw: get(idx.date),
    channel: String(get(idx.channel) || "").trim() || "Unknown",
    campaign: String(get(idx.campaign) || "").trim() || "",
    spend: num(get(idx.spend)),
    impressions: num(get(idx.impressions)),
    clicks: num(get(idx.clicks)),
    leads: num(get(idx.leads)),
    booked: num(get(idx.booked)),
    showups: num(get(idx.showups)),
    qualifiedCalls: num(get(idx.qualifiedCalls)),   // ✅ Column L
    dealsClosed: num(get(idx.dealsClosed)),         // ✅ Column M
    revenue: num(get(idx.revenue)),                 // ✅ Column N
    cash: num(get(idx.cash))                        // ✅ Column O
  };
}

/* ===============================
   FETCH + PARSE
================================ */
function showError(msg) {
  const el = document.getElementById("errorContainer");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function clearError() {
  document.getElementById("errorContainer").classList.add("hidden");
}

function setLastUpdated() {
  const el = document.getElementById("lastUpdated");
  const now = new Date();
  el.textContent = `Live: ${now.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

async function loadCSV() {
  clearError();

  return new Promise((resolve) => {
    Papa.parse(CSV_URL, {
      download: true,
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const data = results.data || [];
          if (data.length < 2) throw new Error("CSV returned no rows.");

          const headers = data[0];
          const rows = data.slice(1);

          const parsed = rows
            .map((r) => buildRowObj(headers, r))
            .filter(Boolean);

          rawRows = parsed;
          resolve(true);
        } catch (e) {
          showError("Error parsing CSV. " + e.message);
          resolve(false);
        }
      },
      error: (err) => {
        showError("CSV download error: " + err.message);
        resolve(false);
      }
    });
  });
}

/* ===============================
   FILTERS
================================ */
function uniqueChannels(rows) {
  const s = new Set(rows.map((r) => r.channel));
  return ["All", ...Array.from(s).sort()];
}

function setChannelOptions() {
  const sel = document.getElementById("channelFilter");
  sel.innerHTML = "";
  for (const c of uniqueChannels(rawRows)) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c === "All" ? "All Channels" : c;
    sel.appendChild(opt);
  }
}

function getDateInputs() {
  const isMobile = window.matchMedia("(max-width: 767px)").matches;
  const s = document.getElementById(isMobile ? "startDateMobile" : "startDate").value;
  const e = document.getElementById(isMobile ? "endDateMobile" : "endDate").value;
  return { s, e };
}

function syncDateInputs() {
  // Mirror values both ways (desktop ↔ mobile)
  const sD = document.getElementById("startDate");
  const eD = document.getElementById("endDate");
  const sM = document.getElementById("startDateMobile");
  const eM = document.getElementById("endDateMobile");
  if (sD && sM) sM.value = sD.value;
  if (eD && eM) eM.value = eD.value;
}

function applyFilters() {
  const { s, e } = getDateInputs();
  const channel = document.getElementById("channelFilter")?.value || "All";

  const start = s ? new Date(s + "T00:00:00") : null;
  const end = e ? new Date(e + "T23:59:59") : null;

  filteredRows = rawRows.filter((r) => {
    if (start && r.date < start) return false;
    if (end && r.date > end) return false;
    if (channel !== "All" && r.channel !== channel) return false;
    return true;
  });

  renderAll();
}

/* ===============================
   KPI + METRICS
================================ */
function sum(rows, key) {
  return rows.reduce((acc, r) => acc + num(r[key]), 0);
}

function computeTotals(rows) {
  const spend = sum(rows, "spend");
  const revenue = sum(rows, "revenue");
  const cash = sum(rows, "cash");
  const impressions = sum(rows, "impressions");
  const clicks = sum(rows, "clicks");
  const leads = sum(rows, "leads");
  const booked = sum(rows, "booked");
  const showups = sum(rows, "showups");
  const qualifiedCalls = sum(rows, "qualifiedCalls");
  const dealsClosed = sum(rows, "dealsClosed");

  // Ratios
  const ctr = safeDiv(clicks, impressions);
  const cpc = safeDiv(spend, clicks);
  const leadConv = safeDiv(leads, clicks);
  const cpl = safeDiv(spend, leads);
  const showRate = safeDiv(showups, booked);
  const qualCallRate = safeDiv(qualifiedCalls, showups);
  const closeRate = safeDiv(dealsClosed, qualifiedCalls); // ✅ Deals / Qualified Calls

  const roas = safeDiv(revenue, spend);
  const mer = safeDiv(cash, spend); // ✅ Cash / Spend

  const cpa = dealsClosed > 0 ? spend / dealsClosed : 0; // ✅ Full CPA (₱)

  // For CPA benchmark based on CPA as % of revenue (your table)
  const cpaPctRevenue = revenue > 0 ? (cpa / revenue) : 0;

  return {
    spend, revenue, cash, impressions, clicks, leads, booked, showups, qualifiedCalls, dealsClosed,
    ctr, cpc, leadConv, cpl, showRate, qualCallRate, closeRate,
    roas, mer, cpa, cpaPctRevenue
  };
}

function kpiCard(label, value, sub = "", accent = "") {
  return `
    <div class="bg-white rounded-lg card-shadow p-3">
      <div class="text-[10px] font-bold text-tmt-600 uppercase">${label}</div>
      <div class="text-sm font-extrabold text-slate-800 mt-0.5">${value}</div>
      ${sub ? `<div class="text-[10px] mt-0.5 ${accent}">${sub}</div>` : ""}
    </div>
  `;
}

function cpaBigCard(value, statusText) {
  const isRisk = /risky/i.test(statusText);
  const stripe = isRisk ? "border-red-500" : "border-tmt-400";
  const statusColor = isRisk ? "text-red-600" : "text-tmt-700";

  return `
    <div class="bg-white rounded-lg card-shadow p-3 border-r-4 ${stripe} flex flex-col items-center justify-center">
      <div class="text-[10px] font-bold text-tmt-600 uppercase">Cost per Acquisition (CPA)</div>
      <div class="text-2xl font-extrabold text-slate-900 mt-1">${value}</div>
      <div class="text-[11px] font-bold mt-1 ${statusColor}">${statusText}</div>
    </div>
  `;
}

/* ===============================
   BENCHMARK RULES (Peso + Full Names)
   Based on your provided tables
================================ */
function statusBadge(status) {
  const s = status.toLowerCase();
  let cls = "bg-tmt-100 text-tmt-800";
  if (s.includes("excellent")) cls = "bg-emerald-500 text-white";
  else if (s.includes("very good")) cls = "bg-emerald-400 text-white";
  else if (s.includes("good")) cls = "bg-green-500 text-white";
  else if (s.includes("acceptable") || s.includes("average") || s.includes("break-even") || s.includes("fair")) cls = "bg-amber-400 text-white";
  else if (s.includes("risky") || s.includes("weak") || s.includes("expensive") || s.includes("unprofitable")) cls = "bg-red-500 text-white";

  return `<span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${cls}">${status}</span>`;
}

function benchmarkCTR(v) {
  if (v < 0.007) return "Weak";
  if (v < 0.010) return "Acceptable / Average";
  if (v < 0.015) return "Good";
  if (v < 0.025) return "Very Good";
  return "Excellent";
}

function benchmarkCPC(v) {
  if (v <= 10) return "Excellent";
  if (v <= 20) return "Good";
  if (v <= 40) return "Acceptable";
  if (v <= 70) return "Expensive";
  return "Very Expensive";
}

function benchmarkLeadConv(v) {
  if (v < 0.05) return "Weak";
  if (v < 0.10) return "Acceptable";
  if (v < 0.20) return "Good";
  if (v < 0.30) return "Very Good";
  return "Excellent";
}

function benchmarkCPL(v) {
  if (v <= 150) return "Excellent";
  if (v <= 300) return "Good";
  if (v <= 600) return "Acceptable";
  if (v <= 1000) return "Expensive";
  return "Very Expensive";
}

function benchmarkShowRate(v) {
  if (v < 0.50) return "Weak";
  if (v < 0.60) return "Acceptable";
  if (v < 0.70) return "Good";
  if (v < 0.80) return "Very Good";
  return "Excellent";
}

function benchmarkCloseRate(v) {
  if (v < 0.10) return "Weak";
  if (v < 0.15) return "Acceptable";
  if (v < 0.25) return "Good";
  if (v < 0.35) return "Very Good";
  return "Excellent";
}

function benchmarkMER(v) {
  if (v < 2.0) return "Inefficient / Risky";
  if (v < 3.0) return "Break-even / Acceptable";
  if (v < 4.0) return "Good";
  if (v < 6.0) return "Very Good";
  return "Excellent";
}

// CPA benchmark based on CPA as % of revenue (your table)
function benchmarkCPA_pctRevenue(v) {
  if (v < 0.05) return "Excellent";
  if (v < 0.10) return "Very Good";
  if (v < 0.20) return "Acceptable";
  if (v < 0.30) return "Risky";
  return "Usually Unprofitable";
}

/* ===============================
   RENDER: BENCHMARK TABLE + FOCUS
================================ */
function renderBenchmarks(t) {
  const rows = [
    { name: "Click-Through Rate (CTR)", value: pct(t.ctr), status: benchmarkCTR(t.ctr) },
    { name: "Cost per Click (CPC)", value: peso(t.cpc), status: benchmarkCPC(t.cpc) },
    { name: "Lead Conversion Rate (Clicks → Lead)", value: pct(t.leadConv), status: benchmarkLeadConv(t.leadConv) },
    { name: "Cost per Lead (CPL)", value: peso(t.cpl), status: benchmarkCPL(t.cpl) },
    { name: "Show-Up Rate (Booked → Show-Ups)", value: pct(t.showRate), status: benchmarkShowRate(t.showRate) },
    { name: "Qualified Call Rate (Show-Ups → Qualified Calls)", value: pct(t.qualCallRate), status: benchmarkLeadConv(t.qualCallRate) }, // reuse conversion scale
    { name: "Close Rate (Qualified Calls → Deals Closed)", value: pct(t.closeRate), status: benchmarkCloseRate(t.closeRate) },
    { name: "Cost per Acquisition (CPA)", value: peso(t.cpa), status: benchmarkCPA_pctRevenue(t.cpaPctRevenue) },
    { name: "Return on Ad Spend (ROAS)", value: (t.roas || 0).toFixed(2) + "x", status: (t.roas >= 3 ? "Excellent" : t.roas >= 2 ? "Good" : "Risky") },
    { name: "Marketing Efficiency Ratio (MER)", value: (t.mer || 0).toFixed(2) + "x", status: benchmarkMER(t.mer) }
  ];

  const body = document.getElementById("benchmarkBody");
  body.innerHTML = rows.map(r => `
    <tr>
      <td class="px-2 py-1.5 text-slate-700">${r.name}</td>
      <td class="px-2 py-1.5 text-right font-bold text-slate-800">${r.value}</td>
      <td class="px-2 py-1.5 text-center">${statusBadge(r.status)}</td>
    </tr>
  `).join("");

  renderFocus(rows);
}

function renderFocus(benchRows) {
  const fairOrRisky = benchRows.filter(r => {
    const s = r.status.toLowerCase();
    return s.includes("fair") || s.includes("acceptable") || s.includes("break-even") || s.includes("weak") || s.includes("risky") || s.includes("expensive") || s.includes("unprofitable") || s.includes("inefficient");
  });

  const risky = fairOrRisky.filter(r => /weak|risky|expensive|unprofitable|inefficient/i.test(r.status));
  const fair = fairOrRisky.filter(r => !/weak|risky|expensive|unprofitable|inefficient/i.test(r.status));

  const summary = document.getElementById("focusSummary");
  summary.textContent = `Needs Attention: ${risky.length} Risky • ${fair.length} Fair`;

  const list = document.getElementById("focusList");
  if (fairOrRisky.length === 0) {
    list.innerHTML = `<span class="text-tmt-700 font-bold">All metrics look healthy.</span>`;
    return;
  }

  list.innerHTML = fairOrRisky.map(r => {
    const isRisk = /weak|risky|expensive|unprofitable|inefficient/i.test(r.status);
    const color = isRisk ? "text-red-600" : "text-amber-600";
    return `<div class="mt-0.5"><span class="font-bold ${color}">${r.name}:</span> <span class="font-bold ${color}">${r.status}</span> <span class="text-slate-600">(${r.value})</span></div>`;
  }).join("");
}

/* ===============================
   KPI RENDER (MER back on top row, CPA alone in row 2)
================================ */
function renderKPIs(t) {
  const top = document.getElementById("kpiTopRow");

  // 7 KPI cards in row 1 (MER included here)
  top.innerHTML = [
    kpiCard("Ad Spend", peso(t.spend)),
    kpiCard("Revenue (Booked)", peso(t.revenue)),
    kpiCard("Cash Collected", peso(t.cash)),
    kpiCard("Qualified Calls", String(t.qualifiedCalls)),
    kpiCard("Deals Closed", String(t.dealsClosed)),
    kpiCard("Return on Ad Spend (ROAS)", (t.roas || 0).toFixed(2) + "x"),
    kpiCard("Marketing Efficiency Ratio (MER)", (t.mer || 0).toFixed(2) + "x")
  ].join("");

  // CPA alone, centered in row 2
  const cpaStatus = benchmarkCPA_pctRevenue(t.cpaPctRevenue);
  document.getElementById("kpiCPAContainer").innerHTML = cpaBigCard(peso(t.cpa), cpaStatus);
}

/* ===============================
   FUNNEL RENDER (Image 2 style)
================================ */
function funnelRow(label, iconClass, value, rateText, widthPct) {
  // widthPct: 100 down to smaller
  const width = Math.max(36, Math.min(100, widthPct));
  return `
    <div class="funnel-row" style="width:${width}%">
      <div class="flex items-center">
        <div class="funnel-icon"><i class="${iconClass}"></i></div>
        <div class="text-[12px] text-slate-800">${label}</div>
      </div>
      <div class="flex items-center gap-2">
        <div class="funnel-stat">${value}</div>
      </div>
      ${rateText ? `<div class="funnel-connector"><i class="fa-solid fa-check"></i> ${rateText}</div>` : ``}
    </div>
  `;
}

function renderFunnel(t, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  // Build funnel steps
  const steps = [
    { label: "Impressions", icon: "fa-solid fa-eye", value: t.impressions, denom: null },
    { label: "Clicks", icon: "fa-solid fa-arrow-pointer", value: t.clicks, denom: t.impressions },
    { label: "Leads", icon: "fa-solid fa-user", value: t.leads, denom: t.clicks },
    { label: "Booked", icon: "fa-solid fa-phone", value: t.booked, denom: t.leads },
    { label: "Show-Ups", icon: "fa-solid fa-video", value: t.showups, denom: t.booked },
    { label: "Qualified Calls", icon: "fa-solid fa-user-check", value: t.qualifiedCalls, denom: t.showups },
    { label: "Deals Closed", icon: "fa-solid fa-handshake", value: t.dealsClosed, denom: t.qualifiedCalls }
  ];

  const max = Math.max(...steps.map(s => num(s.value)), 1);

  el.innerHTML = `
    <div class="funnel-flow-line"></div>
    ${steps.map((s, i) => {
      const v = num(s.value);
      const w = (v / max) * 100;
      const rate = (s.denom == null) ? "" : pct(safeDiv(v, s.denom));
      return funnelRow(s.label, s.icon, v.toLocaleString("en-PH"), rate ? rate : "", w);
    }).join("")}
  `;
}

/* ===============================
   TABLE RENDER (Top rows dropdown)
================================ */
function renderTable(rows) {
  const search = (document.getElementById("tableSearch")?.value || "").trim().toLowerCase();
  const limit = Number(document.getElementById("rowLimit")?.value || 10);

  let list = rows.slice().sort((a,b) => a.date - b.date);

  // Search filter
  if (search) {
    list = list.filter(r => {
      return (
        r.dateRaw.toLowerCase().includes(search) ||
        r.channel.toLowerCase().includes(search) ||
        r.campaign.toLowerCase().includes(search)
      );
    });
  }

  // Top N rows only (prevents internal scrolling)
  list = list.slice(0, limit);

  const header = document.getElementById("tableHeader");
  const body = document.getElementById("tableBody");

  const cols = [
    { k: "date", t: "Date", fmt: (r) => fmtShortDate(r.date) },
    { k: "channel", t: "Chan", fmt: (r) => r.channel },
    { k: "spend", t: "Spend", fmt: (r) => peso(r.spend) },
    { k: "clicks", t: "Clicks", fmt: (r) => r.clicks.toLocaleString("en-PH") },
    { k: "leads", t: "Leads", fmt: (r) => r.leads.toLocaleString("en-PH") },
    { k: "qualifiedCalls", t: "Qual Calls", fmt: (r) => r.qualifiedCalls.toLocaleString("en-PH") },
    { k: "booked", t: "Booked", fmt: (r) => r.booked.toLocaleString("en-PH") },
    { k: "showups", t: "Show", fmt: (r) => r.showups.toLocaleString("en-PH") },
    { k: "dealsClosed", t: "Deals", fmt: (r) => r.dealsClosed.toLocaleString("en-PH") },
    { k: "revenue", t: "Rev", fmt: (r) => peso(r.revenue) }
  ];

  header.innerHTML = cols.map(c => `<th class="px-2 py-2 text-[10px] font-bold">${c.t}</th>`).join("");

  body.innerHTML = list.map(r => `
    <tr>
      ${cols.map(c => `<td class="px-2 py-1.5">${c.fmt(r)}</td>`).join("")}
    </tr>
  `).join("");
}

/* ===============================
   TRENDS
================================ */
function groupByDay(rows) {
  const m = new Map();
  for (const r of rows) {
    const key = r.date.toISOString().slice(0,10);
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(r);
  }
  return Array.from(m.entries())
    .sort((a,b) => a[0].localeCompare(b[0]))
    .map(([k, arr]) => ({ key: k, t: computeTotals(arr) }));
}

function groupByWeek(rows) {
  // ISO-week-ish grouping by Monday
  const m = new Map();
  for (const r of rows) {
    const d = new Date(r.date);
    const day = d.getDay(); // 0 Sun
    const diff = (day === 0 ? -6 : 1 - day); // Monday start
    d.setDate(d.getDate() + diff);
    d.setHours(0,0,0,0);
    const key = d.toISOString().slice(0,10);
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(r);
  }
  return Array.from(m.entries())
    .sort((a,b) => a[0].localeCompare(b[0]))
    .map(([k, arr]) => ({ key: k, t: computeTotals(arr) }));
}

function metricValue(t, metric) {
  switch(metric) {
    case "ctr": return t.ctr * 100;
    case "cpc": return t.cpc;
    case "cpl": return t.cpl;
    case "mer": return t.mer;
    default: return t.ctr * 100;
  }
}

function metricLabel(metric) {
  switch(metric) {
    case "ctr": return "Click-Through Rate (%)";
    case "cpc": return "Cost per Click (₱)";
    case "cpl": return "Cost per Lead (₱)";
    case "mer": return "Marketing Efficiency Ratio (x)";
    default: return "CTR (%)";
  }
}

function renderTrends(rows) {
  const grouped = currentGranularity === "week" ? groupByWeek(rows) : groupByDay(rows);

  const labels = grouped.map(g => {
    const d = new Date(g.key);
    return currentGranularity === "week" ? `Wk of ${fmtShortDate(d)}` : fmtShortDate(d);
  });

  const values = grouped.map(g => metricValue(g.t, currentMetric));

  // Desktop chart
  const ctx = document.getElementById("trendChart")?.getContext("2d");
  if (ctx) {
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: metricLabel(currentMetric),
          data: values,
          tension: 0.35,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { font: { size: 10 } } },
          x: { ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  // Mobile chart
  const ctxM = document.getElementById("trendChartMobile")?.getContext("2d");
  if (ctxM) {
    if (trendChartMobile) trendChartMobile.destroy();
    trendChartMobile = new Chart(ctxM, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: metricLabel(currentMetric),
          data: values,
          tension: 0.35,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { font: { size: 10 } } },
          x: { ticks: { font: { size: 10 } } }
        }
      }
    });
  }
}

/* ===============================
   MOBILE TABS
================================ */
function setupTabs() {
  const btns = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  btns.forEach(b => {
    b.addEventListener("click", () => {
      btns.forEach(x => x.classList.remove("tab-active"));
      b.classList.add("tab-active");

      const target = b.getAttribute("data-tab");
      panels.forEach(p => p.classList.remove("active"));
      const el = document.getElementById(target);
      if (el) el.classList.add("active");
    });
  });

  // Default open KPIs on mobile
  const isMobile = window.matchMedia("(max-width: 767px)").matches;
  if (isMobile) {
    panels.forEach(p => p.classList.remove("active"));
    document.getElementById("tab-kpis")?.classList.add("active");
  }
}

/* ===============================
   UI EVENTS
================================ */
function setupUI() {
  // Sync buttons
  document.getElementById("btnSync")?.addEventListener("click", async () => {
    await initLoad();
  });
  document.getElementById("btnSyncMobile")?.addEventListener("click", async () => {
    await initLoad();
  });

  // Filter changes
  document.getElementById("channelFilter")?.addEventListener("change", applyFilters);

  // Date changes
  ["startDate","endDate"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncDateInputs();
      applyFilters();
    });
  });
  ["startDateMobile","endDateMobile"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => {
      // mirror back to desktop
      const sD = document.getElementById("startDate");
      const eD = document.getElementById("endDate");
      const sM = document.getElementById("startDateMobile");
      const eM = document.getElementById("endDateMobile");
      if (sD && sM) sD.value = sM.value;
      if (eD && eM) eD.value = eM.value;
      applyFilters();
    });
  });

  // Table controls
  document.getElementById("rowLimit")?.addEventListener("change", () => renderTable(filteredRows));
  document.getElementById("tableSearch")?.addEventListener("input", () => renderTable(filteredRows));

  // Trend buttons (both desktop and mobile)
  document.querySelectorAll(".chart-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".chart-btn").forEach(x => x.classList.remove("active"));
      // Activate same metric buttons across views
      const metric = btn.getAttribute("data-metric");
      document.querySelectorAll(`.chart-btn[data-metric="${metric}"]`).forEach(x => x.classList.add("active"));
      currentMetric = metric;
      renderTrends(filteredRows);
    });
  });

  document.getElementById("btnDaily")?.addEventListener("click", () => {
    currentGranularity = "day";
    renderTrends(filteredRows);
  });
  document.getElementById("btnWeekly")?.addEventListener("click", () => {
    currentGranularity = "week";
    renderTrends(filteredRows);
  });

  document.getElementById("btnDailyMobile")?.addEventListener("click", () => {
    currentGranularity = "day";
    renderTrends(filteredRows);
  });
  document.getElementById("btnWeeklyMobile")?.addEventListener("click", () => {
    currentGranularity = "week";
    renderTrends(filteredRows);
  });
}

/* ===============================
   RENDER ALL
================================ */
function renderAll() {
  setLastUpdated();
  const t = computeTotals(filteredRows);

  renderKPIs(t);
  renderFunnel(t, "funnelContainer");
  renderFunnel(t, "funnelContainerMobile");
  renderBenchmarks(t);
  renderTable(filteredRows);
  renderTrends(filteredRows);

  // Default active metric button
  document.querySelectorAll(`.chart-btn[data-metric="${currentMetric}"]`).forEach(x => x.classList.add("active"));
}

/* ===============================
   INIT
================================ */
async function initLoad() {
  const ok = await loadCSV();
  if (!ok) return;

  // Populate channels
  setChannelOptions();

  // Auto-set date range from data (min..max)
  const dates = rawRows.map(r => r.date).sort((a,b) => a-b);
  const min = dates[0];
  const max = dates[dates.length - 1];

  const startISO = min ? min.toISOString().slice(0,10) : "";
  const endISO = max ? max.toISOString().slice(0,10) : "";

  const sD = document.getElementById("startDate");
  const eD = document.getElementById("endDate");
  const sM = document.getElementById("startDateMobile");
  const eM = document.getElementById("endDateMobile");

  if (sD && !sD.value) sD.value = startISO;
  if (eD && !eD.value) eD.value = endISO;
  if (sM) sM.value = sD.value;
  if (eM) eM.value = eD.value;

  applyFilters();
}

document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupUI();
  await initLoad();
  setInterval(setLastUpdated, 1000);
});



