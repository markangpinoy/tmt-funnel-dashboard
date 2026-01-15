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
const peso = (n) => {
  const val = Number(n || 0);
  return "₱" + val.toLocaleString("en-PH", { maximumFractionDigits: 0 });
};
const num = (n) => Number(n || 0);
const pct = (n, d) => (d ? (n / d) * 100 : 0);

const safeText = (s) => (s == null ? "" : String(s));

function parseDateAny(v) {
  // Supports: "January 1, 2026", "1/1/2026", "2026-01-01"
  if (!v) return null;
  const s = String(v).trim();
  const d1 = new Date(s);
  if (!isNaN(d1)) return d1;

  // try M/D/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    const yy = Number(m[3]);
    const d2 = new Date(yy, mm - 1, dd);
    if (!isNaN(d2)) return d2;
  }
  return null;
}

function formatShortDate(d) {
  if (!d) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function sumBy(rows, key) {
  return rows.reduce((a, r) => a + num(r[key]), 0);
}

function getValByHeader(row, headerMap, expectedHeaders) {
  for (const h of expectedHeaders) {
    const k = headerMap[h];
    if (k) return row[k];
  }
  return 0;
}

/* =========================
   DOM
========================= */
const el = (id) => document.getElementById(id);

function showError(msg) {
  const c = el("errorContainer");
  if (!c) return;
  c.classList.remove("hidden");
  c.innerText = msg;
}

function hideError() {
  const c = el("errorContainer");
  if (!c) return;
  c.classList.add("hidden");
  c.innerText = "";
}

/* =========================
   LOAD CSV
========================= */
async function loadCSV() {
  hideError();

  return new Promise((resolve, reject) => {
    Papa.parse(CSV_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results?.data?.length) {
          reject(new Error("No rows found in CSV."));
          return;
        }
        resolve(results.data);
      },
      error: (err) => reject(err),
    });
  });
}

/* =========================
   NORMALIZE ROWS
========================= */
function normalizeRows(rows) {
  // Build header map by trimming headers
  const headers = Object.keys(rows[0] || {});
  const headerMap = {};
  headers.forEach((h) => (headerMap[h.trim()] = h));

  return rows
    .map((r) => {
      const dateRaw = r[headerMap["Date"]];
      const d = parseDateAny(dateRaw);

      const obj = {
        _date: d,
        date: dateRaw,
        channel: safeText(r[headerMap["Channel"]] || ""),
        campaign: safeText(r[headerMap["Campaign"]] || ""),
        spend: num(getValByHeader(r, headerMap, ["Ad Spend", "Spend"])),
        impressions: num(getValByHeader(r, headerMap, ["Impressions"])),
        clicks: num(getValByHeader(r, headerMap, ["Clicks", "Click"])),
        leads: num(getValByHeader(r, headerMap, ["Leads", "Lead"])),
        booked: num(getValByHeader(r, headerMap, ["Leads Booked", "Booked", "Booked Calls"])),
        showups: num(getValByHeader(r, headerMap, ["Show-Ups", "Show Ups", "Show"])),
        qualifiedCalls: num(getValByHeader(r, headerMap, ["Qualified Calls", "Sales Calls (Tagged Qualified)", "Sales Calls (Qualified Leads)"])),
        dealsClosed: num(getValByHeader(r, headerMap, ["Deals Closed", "Deal Closed"])),
        revenue: num(getValByHeader(r, headerMap, ["Revenue (Booked)", "Revenue"])),
        cashIn: num(getValByHeader(r, headerMap, ["Cash-In (Collected)", "Cash In (Collected)", "Cash Collected"])),
      };

      return obj;
    })
    .filter((r) => r._date && !isNaN(r._date));
}

/* =========================
   FILTERS
========================= */
function bindFilters() {
  const start = el("startDate");
  const end = el("endDate");
  const startM = el("startDateMobile");
  const endM = el("endDateMobile");
  const ch = el("channelFilter");

  const apply = () => {
    const s = (start?.value || startM?.value) ? new Date((start?.value || startM?.value) + "T00:00:00") : null;
    const e = (end?.value || endM?.value) ? new Date((end?.value || endM?.value) + "T23:59:59") : null;
    const channel = ch?.value || "All";

    filteredRows = rawRows.filter((r) => {
      const okDate =
        (!s || r._date >= s) &&
        (!e || r._date <= e);

      const okChannel =
        channel === "All" || r.channel === channel;

      return okDate && okChannel;
    });

    renderAll();
  };

  [start, end, startM, endM, ch].forEach((x) => x && x.addEventListener("change", apply));

  const sync = el("btnSync");
  const syncM = el("btnSyncMobile");
  sync && sync.addEventListener("click", () => init());
  syncM && syncM.addEventListener("click", () => init());
}

function populateChannels() {
  const ch = el("channelFilter");
  if (!ch) return;

  const unique = [...new Set(rawRows.map((r) => r.channel).filter(Boolean))].sort();
  ch.innerHTML = `<option value="All">All Channels</option>` + unique.map((c) => `<option value="${c}">${c}</option>`).join("");
}

/* =========================
   KPIs
========================= */
function computeKPIs(rows) {
  const spend = sumBy(rows, "spend");
  const revenue = sumBy(rows, "revenue");
  const cashIn = sumBy(rows, "cashIn");
  const impressions = sumBy(rows, "impressions");
  const clicks = sumBy(rows, "clicks");
  const leads = sumBy(rows, "leads");
  const booked = sumBy(rows, "booked");
  const showups = sumBy(rows, "showups");
  const qualifiedCalls = sumBy(rows, "qualifiedCalls");
  const dealsClosed = sumBy(rows, "dealsClosed");

  const ctr = pct(clicks, impressions);
  const cpc = clicks ? spend / clicks : 0;
  const leadConv = pct(leads, clicks); // Clicks -> Leads
  const cpl = leads ? spend / leads : 0;
  const showRate = pct(showups, booked);
  const qualCallRate = pct(qualifiedCalls, showups); // Show-ups -> Qualified calls
  const closeRate = pct(dealsClosed, qualifiedCalls); // Qualified calls -> Deals closed (as requested)

  const roas = spend ? revenue / spend : 0; // Revenue / Spend
  const mer = spend ? cashIn / spend : 0;  // Cash-in / Spend  (correct MER)
  const cpa = dealsClosed ? spend / dealsClosed : 0; // Cost per Acquisition (per deal)

  return {
    spend, revenue, cashIn,
    impressions, clicks, leads, booked, showups, qualifiedCalls, dealsClosed,
    ctr, cpc, leadConv, cpl, showRate, qualCallRate, closeRate,
    roas, mer, cpa
  };
}

function kpiCard(label, value, extra = "") {
  return `
    <div class="bg-white rounded-lg card-shadow p-3">
      <div class="text-[10px] font-bold text-tmt-600 uppercase">${label}</div>
      <div class="text-sm font-extrabold text-slate-800 mt-1">${value}</div>
      ${extra ? `<div class="text-[10px] text-slate-500 mt-1">${extra}</div>` : ""}
    </div>
  `;
}

function cpaCard(kpis) {
  const status = classifyCPA(kpis.cpa);
  return `
    <div class="bg-white rounded-lg card-shadow p-3 border-l-4 ${status.border}">
      <div class="text-[10px] font-bold text-tmt-600 uppercase text-center">Cost per Acquisition (CPA)</div>
      <div class="text-2xl font-extrabold text-slate-900 text-center mt-1">${peso(kpis.cpa)}</div>
      <div class="text-[11px] font-bold text-center mt-1 ${status.text}">${status.label}</div>
    </div>
  `;
}

/* =========================
   FUNNEL
========================= */
function renderFunnel(targetId, kpis) {
  const container = el(targetId);
  if (!container) return;

  const steps = [
    { name: "Impressions", icon: "fa-eye", value: kpis.impressions, rate: "" },
    { name: "Clicks", icon: "fa-mouse-pointer", value: kpis.clicks, rate: `${kpis.ctr.toFixed(1)}%` },
    { name: "Leads", icon: "fa-user-plus", value: kpis.leads, rate: `${kpis.leadConv.toFixed(1)}%` },
    { name: "Booked", icon: "fa-phone", value: kpis.booked, rate: `${pct(kpis.booked, kpis.leads).toFixed(1)}%` },
    { name: "Show-Ups", icon: "fa-video", value: kpis.showups, rate: `${kpis.showRate.toFixed(1)}%` },
    { name: "Qualified Calls", icon: "fa-user-check", value: kpis.qualifiedCalls, rate: `${kpis.qualCallRate.toFixed(1)}%` },
    { name: "Deals Closed", icon: "fa-handshake", value: kpis.dealsClosed, rate: `${kpis.closeRate.toFixed(1)}%` },
  ];

  container.innerHTML = `
    <div class="funnel-flow-line"></div>
    ${steps.map(s => `
      <div class="funnel-row">
        <div class="funnel-left">
          <i class="fa-solid ${s.icon} funnel-icon"></i>
          <div class="funnel-title">${s.name}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="funnel-stat">${Number(s.value || 0).toLocaleString()}</span>
          ${s.rate ? `<span class="funnel-connector"><i class="fa-solid fa-arrow-trend-up"></i> ${s.rate}</span>` : ``}
        </div>
      </div>
    `).join("")}
  `;
}

/* =========================
   BENCHMARKS + FOCUS AREA
========================= */
function badge(status) {
  const map = {
    Excellent: "bg-green-100 text-green-700",
    Good: "bg-green-100 text-green-700",
    Fair: "bg-amber-100 text-amber-700",
    Risky: "bg-red-100 text-red-700",
  };
  return map[status] || "bg-slate-100 text-slate-700";
}

function classifyCTR(v) {
  if (v >= 1.5) return { label: "Excellent" };
  if (v >= 1.0) return { label: "Good" };
  if (v >= 0.7) return { label: "Fair" };
  return { label: "Risky" };
}
function classifyCPC(v) {
  if (v <= 20) return { label: "Excellent" };
  if (v <= 40) return { label: "Good" };
  if (v <= 70) return { label: "Fair" };
  return { label: "Risky" };
}
function classifyLeadConv(v) {
  if (v >= 12) return { label: "Excellent" };
  if (v >= 8) return { label: "Good" };
  if (v >= 5) return { label: "Fair" };
  return { label: "Risky" };
}
function classifyCPL(v) {
  if (v <= 150) return { label: "Excellent" };
  if (v <= 250) return { label: "Good" };
  if (v <= 400) return { label: "Fair" };
  return { label: "Risky" };
}
function classifyShowRate(v) {
  if (v >= 40) return { label: "Excellent" };
  if (v >= 30) return { label: "Good" };
  if (v >= 20) return { label: "Fair" };
  return { label: "Risky" };
}
function classifyCloseRate(v) {
  if (v >= 20) return { label: "Excellent" };
  if (v >= 15) return { label: "Good" };
  if (v >= 10) return { label: "Fair" };
  return { label: "Risky" };
}
function classifyMER(v) {
  if (v >= 3) return { label: "Excellent" };
  if (v >= 2) return { label: "Good" };
  if (v >= 1.2) return { label: "Fair" };
  return { label: "Risky" };
}
function classifyCPA(v) {
  // You can tweak these thresholds
  if (v <= 30000) return { label: "Excellent", text: "text-green-700", border: "border-green-400" };
  if (v <= 45000) return { label: "Good", text: "text-green-700", border: "border-green-400" };
  if (v <= 60000) return { label: "Fair", text: "text-amber-700", border: "border-amber-400" };
  return { label: "Risky", text: "text-red-700", border: "border-red-400" };
}

function renderBenchmarks(k) {
  const items = [
    { name: "Click-Through Rate (CTR)", value: `${k.ctr.toFixed(1)}%`, status: classifyCTR(k.ctr).label },
    { name: "Cost per Click (CPC)", value: peso(k.cpc), status: classifyCPC(k.cpc).label },
    { name: "Lead Conversion Rate (Clicks → Leads)", value: `${k.leadConv.toFixed(2)}%`, status: classifyLeadConv(k.leadConv).label },
    { name: "Cost per Lead (CPL)", value: peso(k.cpl), status: classifyCPL(k.cpl).label },
    { name: "Show-Up Rate (Booked → Show-Ups)", value: `${k.showRate.toFixed(2)}%`, status: classifyShowRate(k.showRate).label },
    { name: "Qualified Call Rate (Show-Ups → Qualified Calls)", value: `${k.qualCallRate.toFixed(2)}%`, status: (k.qualCallRate >= 10 ? "Excellent" : k.qualCallRate >= 7 ? "Good" : k.qualCallRate >= 4 ? "Fair" : "Risky") },
    { name: "Close Rate (Qualified Calls → Deals Closed)", value: `${k.closeRate.toFixed(2)}%`, status: classifyCloseRate(k.closeRate).label },
    { name: "Cost per Acquisition (CPA)", value: peso(k.cpa), status: classifyCPA(k.cpa).label },
    { name: "Return on Ad Spend (ROAS)", value: `${k.roas.toFixed(2)}x`, status: (k.roas >= 3 ? "Excellent" : k.roas >= 2 ? "Good" : k.roas >= 1.2 ? "Fair" : "Risky") },
    { name: "Marketing Efficiency Ratio (MER)", value: `${k.mer.toFixed(2)}x`, status: classifyMER(k.mer).label },
  ];

  const body = el("benchmarkBody");
  if (!body) return;

  body.innerHTML = items.map(it => `
    <tr>
      <td class="px-2 py-1.5 text-slate-700">${it.name}</td>
      <td class="px-2 py-1.5 text-right font-bold text-slate-800">${it.value}</td>
      <td class="px-2 py-1.5 text-center">
        <span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${badge(it.status)}">${it.status}</span>
      </td>
    </tr>
  `).join("");

  renderFocus(items);
}

function renderFocus(items) {
  const focus = items.filter(i => i.status === "Fair" || i.status === "Risky");
  const risky = focus.filter(i => i.status === "Risky").length;
  const fair = focus.filter(i => i.status === "Fair").length;

  const summary = el("focusSummary");
  const list = el("focusList");
  if (!summary || !list) return;

  summary.textContent = `Needs Attention: ${risky} Risky · ${fair} Fair`;

  if (!focus.length) {
    list.innerHTML = `<span class="text-green-700 font-bold">All good — no Fair/Risky signals right now.</span>`;
    return;
  }

  list.innerHTML = focus.map(i => {
    const color = i.status === "Risky" ? "text-red-700" : "text-amber-700";
    return `<div class="mb-1"><span class="${color} font-extrabold">${i.status}:</span> ${i.name} <span class="text-slate-700 font-bold">(${i.value})</span></div>`;
  }).join("");
}

/* =========================
   TABLE (Top rows dropdown)
========================= */
function renderTable(rows) {
  const header = el("tableHeader");
  const body = el("tableBody");
  if (!header || !body) return;

  const cols = [
    { key: "_date", label: "DATE", fmt: (v, r) => formatShortDate(r._date) },
    { key: "channel", label: "CHAN", fmt: (v) => v },
    { key: "spend", label: "SPEND", fmt: (v) => peso(v) },
    { key: "clicks", label: "CLICK", fmt: (v) => Number(v).toLocaleString() },
    { key: "leads", label: "LEAD", fmt: (v) => Number(v).toLocaleString() },
    { key: "qualifiedCalls", label: "QUAL CALLS", fmt: (v) => Number(v).toLocaleString() },
    { key: "booked", label: "BOOK", fmt: (v) => Number(v).toLocaleString() },
    { key: "showups", label: "SHOW", fmt: (v) => Number(v).toLocaleString() },
    { key: "dealsClosed", label: "DEALS", fmt: (v) => Number(v).toLocaleString() },
    { key: "revenue", label: "REV", fmt: (v) => peso(v) },
  ];

  header.innerHTML = cols.map(c => `<th class="px-2 py-2 text-[9px] uppercase tracking-wide">${c.label}</th>`).join("");

  const search = (el("tableSearch")?.value || "").toLowerCase().trim();
  const limit = Number(el("rowLimit")?.value || 10);

  const searched = rows.filter(r => {
    if (!search) return true;
    const blob = `${formatShortDate(r._date)} ${r.channel} ${r.campaign}`.toLowerCase();
    return blob.includes(search);
  });

  const limited = searched.slice(0, limit);

  body.innerHTML = limited.map(r => `
    <tr>
      ${cols.map(c => `<td class="px-2 py-1.5">${c.fmt(r[c.key], r)}</td>`).join("")}
    </tr>
  `).join("");
}

function bindTableControls() {
  const s = el("tableSearch");
  const l = el("rowLimit");
  s && s.addEventListener("input", () => renderTable(filteredRows));
  l && l.addEventListener("change", () => renderTable(filteredRows));
}

/* =========================
   TRENDS (simple)
========================= */
function buildTrendSeries(rows, metric, granularity) {
  const sorted = [...rows].sort((a, b) => a._date - b._date);

  // Group by day only (weekly optional)
  const map = new Map();

  for (const r of sorted) {
    const d = new Date(r._date);
    let key;
    if (granularity === "week") {
      // week key: YYYY-W##
      const temp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = temp.getUTCDay() || 7;
      temp.setUTCDate(temp.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((temp - yearStart) / 86400000) + 1) / 7);
      key = `${temp.getUTCFullYear()}-W${weekNo}`;
    } else {
      key = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    }

    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }

  const labels = [];
  const values = [];

  for (const [key, group] of map.entries()) {
    const k = computeKPIs(group);

    let v = 0;
    if (metric === "ctr") v = k.ctr;
    if (metric === "cpc") v = k.cpc;
    if (metric === "cpl") v = k.cpl;
    if (metric === "mer") v = k.mer;

    labels.push(granularity === "week" ? key : formatShortDate(group[0]._date));
    values.push(v);
  }

  return { labels, values };
}

function renderTrend(canvasId, metric, granularity) {
  const canvas = el(canvasId);
  if (!canvas) return;

  const { labels, values } = buildTrendSeries(filteredRows, metric, granularity);

  const isMoney = metric === "cpc" || metric === "cpl";
  const labelMap = {
    ctr: "Click-Through Rate (CTR) %",
    cpc: "Cost per Click (CPC)",
    cpl: "Cost per Lead (CPL)",
    mer: "Marketing Efficiency Ratio (MER)",
  };

  const cfg = {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: labelMap[metric] || metric,
        data: values,
        tension: 0.35,
        fill: true,
        borderWidth: 2,
        pointRadius: 2
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
              if (metric === "ctr") return v.toFixed(1) + "%";
              if (isMoney) return "₱" + Number(v).toFixed(0);
              if (metric === "mer") return Number(v).toFixed(2) + "x";
              return v;
            }
          }
        }
      }
    }
  };

  if (canvasId === "trendChart") {
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(canvas, cfg);
  } else {
    if (trendChartMobile) trendChartMobile.destroy();
    trendChartMobile = new Chart(canvas, cfg);
  }
}

/* =========================
   KPI RENDER
========================= */
function renderKPIs(k) {
  const top = el("kpiTopRow");
  const cpaWrap = el("kpiCPAContainer");
  if (!top || !cpaWrap) return;

  top.innerHTML = [
    kpiCard("Ad Spend", peso(k.spend)),
    kpiCard("Revenue (Booked)", peso(k.revenue)),
    kpiCard("Cash Collected", peso(k.cashIn)),
    kpiCard("Qualified Calls", Number(k.qualifiedCalls).toLocaleString()),
    kpiCard("Deals Closed", Number(k.dealsClosed).toLocaleString()),
    kpiCard("Return on Ad Spend (ROAS)", `${k.roas.toFixed(2)}x`),
    kpiCard("Marketing Efficiency Ratio (MER)", `${k.mer.toFixed(2)}x`),
  ].join("");

  cpaWrap.innerHTML = cpaCard(k);
}

/* =========================
   MOBILE TABS
========================= */
function bindTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.remove("tab-active"));
      btn.classList.add("tab-active");

      const id = btn.dataset.tab;
      panels.forEach(p => p.classList.remove("active"));
      const active = el(id);
      active && active.classList.add("active");

      // lazy render for mobile charts
      if (id === "tab-trends") renderTrend("trendChartMobile", currentMetric, currentGranularity);
      if (id === "tab-funnel") renderFunnel("funnelContainerMobile", computeKPIs(filteredRows));
    });
  });

  // default active
  const def = el("tab-kpis");
  def && def.classList.add("active");
}

/* =========================
   CHART BUTTONS
========================= */
function bindChartButtons() {
  const allBtns = document.querySelectorAll(".chart-btn");
  allBtns.forEach(b => {
    b.addEventListener("click", () => {
      allBtns.forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      currentMetric = b.dataset.metric;
      renderTrend("trendChart", currentMetric, currentGranularity);
      renderTrend("trendChartMobile", currentMetric, currentGranularity);
    });
  });

  // default active
  document.querySelectorAll('.chart-btn[data-metric="ctr"]').forEach(b => b.classList.add("active"));

  const day = el("btnDaily");
  const wk = el("btnWeekly");
  const dayM = el("btnDailyMobile");
  const wkM = el("btnWeeklyMobile");

  const setGran = (g) => {
    currentGranularity = g;
    if (g === "day") {
      day && day.classList.add("bg-white","shadow-sm","text-tmt-700");
      wk && wk.classList.remove("bg-white","shadow-sm","text-tmt-700");
      dayM && dayM.classList.add("bg-white","shadow-sm","text-tmt-700");
      wkM && wkM.classList.remove("bg-white","shadow-sm","text-tmt-700");
    } else {
      wk && wk.classList.add("bg-white","shadow-sm","text-tmt-700");
      day && day.classList.remove("bg-white","shadow-sm","text-tmt-700");
      wkM && wkM.classList.add("bg-white","shadow-sm","text-tmt-700");
      dayM && dayM.classList.remove("bg-white","shadow-sm","text-tmt-700");
    }
    renderTrend("trendChart", currentMetric, currentGranularity);
    renderTrend("trendChartMobile", currentMetric, currentGranularity);
  };

  day && day.addEventListener("click", () => setGran("day"));
  wk && wk.addEventListener("click", () => setGran("week"));
  dayM && dayM.addEventListener("click", () => setGran("day"));
  wkM && wkM.addEventListener("click", () => setGran("week"));
}

/* =========================
   RENDER ALL
========================= */
function renderAll() {
  const k = computeKPIs(filteredRows);

  renderKPIs(k);
  renderFunnel("funnelContainer", k);
  renderFunnel("funnelContainerMobile", k);

  renderBenchmarks(k);
  renderTable(filteredRows);

  renderTrend("trendChart", currentMetric, currentGranularity);

  el("lastUpdated").textContent = `Live: ${new Date().toLocaleTimeString()}`;
}

/* =========================
   INIT
========================= */
async function init() {
  try {
    hideError();
    const rows = await loadCSV();
    rawRows = normalizeRows(rows);

    // default date range to min/max
    const minDate = new Date(Math.min(...rawRows.map(r => r._date.getTime())));
    const maxDate = new Date(Math.max(...rawRows.map(r => r._date.getTime())));

    const toISO = (d) => d.toISOString().slice(0, 10);

    if (el("startDate")) el("startDate").value = toISO(minDate);
    if (el("endDate")) el("endDate").value = toISO(maxDate);
    if (el("startDateMobile")) el("startDateMobile").value = toISO(minDate);
    if (el("endDateMobile")) el("endDateMobile").value = toISO(maxDate);

    populateChannels();

    // apply filters once
    filteredRows = rawRows;

    renderAll();
  } catch (e) {
    showError(`Error loading dashboard: ${e.message}`);
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bindTabs();
  bindFilters();
  bindChartButtons();
  bindTableControls();
  init();
});
