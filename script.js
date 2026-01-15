/* ===========================
   TMT Funnel Tracker - script.js (FULL)
   Fixes:
   - ROAS shown in KPI row
   - MER corrected: Cash-In (Collected) / Ad Spend
   - ROAS: Revenue (Booked) / Ad Spend
   - CPA stays alone on 2nd row (big + centered)
   - Focus Area no overflow (wrap + clamp)
   - Close Rate = Deals Closed / Qualified Calls
   =========================== */

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQodpSGaQTvWB7i7sUMZ-5lS17ILsch4R4OxKofe22s8gKNXt_BCvHiQ6Ddvg0LD14F1KgWlmkh0kri/pub?output=csv";

const app = {
  rawData: [],
  filteredData: [],
  aggregates: {},
  chartInstance: null,
  chartMode: "daily",
  currentChartMetric: "ctr",

  currencyFormatter: new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }),
  percentFormatter: new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }),
  numberFormatter: new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }),

  keyMap: {
    date: ["date", "day"],
    channel: ["channel", "source", "platform"],
    spend: ["ad spend", "spend", "cost", "amount spent"],
    impressions: ["impressions", "views"],
    clicks: ["clicks", "link clicks"],
    leads: ["leads", "contacts"],
    booked: ["leads booked", "booked calls", "appointments", "calls"],
    showUps: ["show-ups", "show ups", "attended"],
    qualifiedCalls: ["qualified calls"],
    deals: ["deals closed", "deal closed"],
    revenue: ["revenue (booked)", "revenue", "sales value"],
    cashIn: ["cash-in (collected)", "cash-in", "cash in", "collected"],
  },
};

document.addEventListener("DOMContentLoaded", () => {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

  const setDates = (startId, endId) => {
    const s = document.getElementById(startId);
    const e = document.getElementById(endId);
    if (s && e) {
      s.valueAsDate = firstDay;
      e.valueAsDate = today;
      s.addEventListener("change", app.updateDashboard);
      e.addEventListener("change", app.updateDashboard);
    }
  };

  setDates("startDate", "endDate");
  setDates("startDateMobile", "endDateMobile");

  document.getElementById("channelFilter")?.addEventListener("change", app.updateDashboard);
  document.getElementById("tableSearch")?.addEventListener("keyup", (e) => app.filterTable(e.target.value));

  app.fetchData();
});

app.fetchData = () => {
  const lu = document.getElementById("lastUpdated");
  if (lu) lu.textContent = "Syncing...";

  Papa.parse(SHEET_CSV_URL, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      if (results.errors.length && !results.data.length) {
        app.showError("Failed to load CSV data.");
        return;
      }
      app.processData(results.data, results.meta.fields);
      if (lu) lu.textContent = "Live: " + new Date().toLocaleTimeString();
    },
    error: (err) => app.showError("Network Error: " + err.message),
  });
};

app.showError = (msg) => {
  const el = document.getElementById("errorContainer");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
};

app.processData = (data, headers) => {
  const columnMap = {};
  const cleanHeaders = headers.map((h) => (h || "").toLowerCase().trim());

  for (const [key, variants] of Object.entries(app.keyMap)) {
    let idx = cleanHeaders.findIndex((h) => variants.some((v) => h === v));
    if (idx === -1) idx = cleanHeaders.findIndex((h) => variants.some((v) => h.includes(v)));
    if (idx !== -1) columnMap[key] = headers[idx];
  }

  const safeFloat = (val) => {
    if (val === null || val === undefined) return 0;
    if (typeof val === "number") return val;
    const cleaned = String(val).replace(/[₱$,%]/g, "").trim();
    if (cleaned === "—" || cleaned === "-" || cleaned === "") return 0;
    const num = parseFloat(cleaned);
    return Number.isFinite(num) ? num : 0;
  };

  app.rawData = data
    .map((row) => {
      const parsedDate = new Date(row[columnMap.date]);
      return {
        date: !isNaN(parsedDate) ? parsedDate : null,
        channel: row[columnMap.channel] || "Unknown",
        spend: safeFloat(row[columnMap.spend]),
        impressions: safeFloat(row[columnMap.impressions]),
        clicks: safeFloat(row[columnMap.clicks]),
        leads: safeFloat(row[columnMap.leads]),
        booked: safeFloat(row[columnMap.booked]),
        showUps: safeFloat(row[columnMap.showUps]),
        qualifiedCalls: safeFloat(row[columnMap.qualifiedCalls]),
        deals: safeFloat(row[columnMap.deals]),
        revenue: safeFloat(row[columnMap.revenue]),
        cashIn: safeFloat(row[columnMap.cashIn]),
        original: row,
      };
    })
    .filter((item) => item.date);

  const channels = [...new Set(app.rawData.map((d) => d.channel))].sort();
  const select = document.getElementById("channelFilter");
  if (select) {
    select.innerHTML = '<option value="All">All Channels</option>';
    channels.forEach((ch) => {
      const opt = document.createElement("option");
      opt.value = ch;
      opt.textContent = ch;
      select.appendChild(opt);
    });
  }

  app.updateDashboard();
};

app.updateDashboard = () => {
  const start =
    document.getElementById("startDate")?.valueAsDate ||
    document.getElementById("startDateMobile")?.valueAsDate;
  const end =
    document.getElementById("endDate")?.valueAsDate ||
    document.getElementById("endDateMobile")?.valueAsDate;

  if (end) end.setHours(23, 59, 59, 999);

  const channel = document.getElementById("channelFilter")?.value || "All";

  app.filteredData = app.rawData.filter((d) => {
    const inDate = (!start || d.date >= start) && (!end || d.date <= end);
    const inChannel = channel === "All" || d.channel === channel;
    return inDate && inChannel;
  });

  const totals = {
    spend: 0,
    impressions: 0,
    clicks: 0,
    leads: 0,
    booked: 0,
    showUps: 0,
    qualifiedCalls: 0,
    deals: 0,
    revenue: 0,
    cashIn: 0,
  };

  app.filteredData.forEach((d) => {
    totals.spend += d.spend;
    totals.impressions += d.impressions;
    totals.clicks += d.clicks;
    totals.leads += d.leads;
    totals.booked += d.booked;
    totals.showUps += d.showUps;
    totals.qualifiedCalls += d.qualifiedCalls;
    totals.deals += d.deals;
    totals.revenue += d.revenue;
    totals.cashIn += d.cashIn;
  });

  const safeDiv = (n, d) => (d > 0 ? n / d : 0);

  // ✅ Corrected metrics
  app.aggregates = {
    totals,
    ctr: safeDiv(totals.clicks, totals.impressions),
    cpc: safeDiv(totals.spend, totals.clicks),
    lcr: safeDiv(totals.leads, totals.clicks),
    cpl: safeDiv(totals.spend, totals.leads),
    bookRate: safeDiv(totals.booked, totals.leads),
    showRate: safeDiv(totals.showUps, totals.booked),
    qualCallRate: safeDiv(totals.qualifiedCalls, totals.showUps),

    closeRate: safeDiv(totals.deals, totals.qualifiedCalls),
    cpa: safeDiv(totals.spend, totals.deals),

    // ✅ ROAS and MER split correctly
    roas: safeDiv(totals.revenue, totals.spend), // Revenue (Booked) / Spend
    mer: safeDiv(totals.cashIn, totals.spend),   // Cash-In (Collected) / Spend
  };

  app.renderKPICards();
  app.renderFunnel();
  app.renderCharts();
  app.renderBenchmarks();
  app.renderTable();
  app.renderFocusArea();
};

/* ===========================
   KPI Layout:
   Row 1: normal KPIs including ROAS + MER
   Row 2: ONLY CPA big centered
   =========================== */
app.renderKPICards = () => {
  const ag = app.aggregates;

  const kpiTop = document.getElementById("kpiContainer");
  const kpiCPA = document.getElementById("kpiCPA");
  if (!kpiTop || !kpiCPA) return;

  const cpaStatus = app.getBenchmark("cpa", ag.cpa);

  kpiTop.innerHTML = `
    ${kpiCard("Ad Spend", app.currencyFormatter.format(ag.totals.spend))}
    ${kpiCard("Revenue (Booked)", app.currencyFormatter.format(ag.totals.revenue))}
    ${kpiCard("Cash Collected", app.currencyFormatter.format(ag.totals.cashIn))}
    ${kpiCard("Qualified Calls", app.numberFormatter.format(ag.totals.qualifiedCalls))}
    ${kpiCard("Deals Closed", app.numberFormatter.format(ag.totals.deals))}
    ${kpiCard("Return on Ad Spend (ROAS)", `${ag.roas.toFixed(2)}x`)}
    ${kpiCard("Marketing Efficiency Ratio (MER)", `${ag.mer.toFixed(2)}x`)}
  `;

  kpiCPA.innerHTML = `
    <div class="bg-white rounded border border-tmt-100 p-3 shadow-sm text-center relative overflow-hidden"
         style="width:min(520px, 100%);">
      ${cpaStatus ? `<div class="absolute right-0 top-0 w-1 h-full ${cpaStatus.bgClass}"></div>` : ""}
      <div class="text-[10px] font-bold text-tmt-600 uppercase tracking-wider mb-1">Cost per Acquisition (CPA)</div>
      <div class="text-2xl font-extrabold text-slate-900 leading-none">${app.currencyFormatter.format(ag.cpa)}</div>
      ${cpaStatus ? `<div class="mt-1 text-[10px] font-bold ${cpaStatus.textClass}">${cpaStatus.label}</div>` : ""}
    </div>
  `;

  function kpiCard(label, value) {
    return `
      <div class="bg-white rounded border border-tmt-100 p-2 shadow-sm flex flex-col h-14 justify-center">
        <div class="text-[9px] font-bold text-tmt-400 uppercase tracking-wider mb-0.5">${label}</div>
        <div class="text-sm font-bold text-slate-800 truncate leading-none">${value}</div>
      </div>
    `;
  }
};
app.renderFunnel = () => {
  const ag = app.aggregates;
  const container = document.getElementById("funnelContainer");
  if (!container) return;

  const safeDiv = (n, d) => (d > 0 ? n / d : 0);

  const stages = [
    { name: "Impressions", icon: "fa-eye", count: ag.totals.impressions, conv: null },
    { name: "Clicks", icon: "fa-arrow-pointer", count: ag.totals.clicks, conv: ag.ctr },
    { name: "Leads", icon: "fa-user-check", count: ag.totals.leads, conv: ag.lcr },
    { name: "Booked", icon: "fa-phone", count: ag.totals.booked, conv: safeDiv(ag.totals.booked, ag.totals.leads) },
    { name: "Show-Ups", icon: "fa-video", count: ag.totals.showUps, conv: ag.showRate },
    { name: "Qualified Calls", icon: "fa-user-shield", count: ag.totals.qualifiedCalls, conv: ag.qualCallRate },
    { name: "Deals Closed", icon: "fa-handshake", count: ag.totals.deals, conv: ag.closeRate },
  ];

  let html = '<div class="funnel-flow-line"></div>';

  stages.forEach((stage, idx) => {
    const width = 85 - idx * 8;

    let connectorHtml = "";
    if (stage.conv !== null) {
      connectorHtml = `
        <div class="funnel-connector">
          <i class="fa-solid fa-chevron-down text-[8px] text-tmt-400"></i>
          <span class="font-bold text-tmt-800">${(stage.conv * 100).toFixed(1)}%</span>
        </div>
      `;
    }

    html += `
      <div class="funnel-row" style="width: ${Math.max(width, 40)}%;">
        <div class="flex items-center">
          <i class="fa-solid ${stage.icon} funnel-icon"></i>
          <span class="truncate">${stage.name}</span>
        </div>
        <span class="funnel-stat">${app.numberFormatter.format(stage.count)}</span>
        ${connectorHtml}
      </div>
    `;
  });

  container.innerHTML = html;
};

/* ===== Charts unchanged ===== */
app.setChartMode = (mode) => { app.chartMode = mode; app.renderCharts(); };
app.updateChartMetric = (metric) => { app.currentChartMetric = metric; app.renderCharts(); };

app.renderCharts = () => {
  const canvas = document.getElementById("trendChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (app.chartInstance) app.chartInstance.destroy();

  const grouped = new Map();
  const safeDiv = (n, d) => (d > 0 ? n / d : 0);

  app.filteredData.forEach((d) => {
    let key;
    if (app.chartMode === "weekly") {
      const date = new Date(d.date);
      date.setDate(date.getDate() - date.getDay());
      key = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } else {
      key = d.date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    if (!grouped.has(key)) grouped.set(key, { s: 0, c: 0, i: 0, l: 0, rev: 0, cash: 0 });
    const g = grouped.get(key);
    g.s += d.spend;
    g.c += d.clicks;
    g.i += d.impressions;
    g.l += d.leads;
    g.rev += d.revenue;
    g.cash += d.cashIn;
  });

  const labels = Array.from(grouped.keys());

  const data = Array.from(grouped.values()).map((g) => {
    switch (app.currentChartMetric) {
      case "ctr": return safeDiv(g.c, g.i) * 100;
      case "cpc": return safeDiv(g.s, g.c);
      case "cpl": return safeDiv(g.s, g.l);
      case "mer": return safeDiv(g.cash, g.s); // ✅ chart MER = cash/spend
      default: return 0;
    }
  });

  app.chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data,
        borderColor: "#16a34a",
        backgroundColor: (c) => {
          const grad = c.chart.ctx.createLinearGradient(0, 0, 0, 200);
          grad.addColorStop(0, "rgba(22, 163, 74, 0.2)");
          grad.addColorStop(1, "rgba(22, 163, 74, 0)");
          return grad;
        },
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: "#f0fdf4" }, ticks: { font: { size: 9 } } },
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 9 } } },
      },
    },
  });
};

/* ===== Benchmarks / Focus ===== */
app.getBenchmark = (metric, value) => {
  const res = (label, bgClass, textClass, score) => ({ label, bgClass, textClass, score });
  const EX = res("Excellent", "bg-tmt-500", "text-tmt-600", 3);
  const GD = res("Good", "bg-tmt-300", "text-tmt-500", 2);
  const OK = res("Fair", "bg-amber-400", "text-amber-500", 1);
  const BD = res("Risky", "bg-red-500", "text-red-500", 0);

  switch (metric) {
    case "ctr": return value >= 0.015 ? EX : value >= 0.01 ? GD : value >= 0.007 ? OK : BD;
    case "cpc": return value <= 20 ? EX : value <= 40 ? GD : value <= 70 ? OK : BD;
    case "lcr": return value >= 0.2 ? EX : value >= 0.1 ? GD : value >= 0.05 ? OK : BD;
    case "cpl": return value <= 150 ? EX : value <= 300 ? GD : value <= 600 ? OK : BD;
    case "showRate": return value >= 0.7 ? EX : value >= 0.6 ? GD : value >= 0.5 ? OK : BD;
    case "qualCallRate": return value >= 0.2 ? EX : value >= 0.1 ? GD : value >= 0.05 ? OK : BD;
    case "closeRate": return value >= 0.35 ? EX : value >= 0.25 ? GD : value >= 0.15 ? OK : BD;
    case "mer": return value >= 4 ? EX : value >= 3 ? GD : value >= 2 ? OK : BD;
    case "roas": return value >= 4 ? EX : value >= 3 ? GD : value >= 2 ? OK : BD;
    case "cpa": return value <= 3000 ? EX : value <= 5000 ? GD : value <= 8000 ? OK : BD;
    default: return null;
  }
};

app.renderBenchmarks = () => {
  const ag = app.aggregates;

  const items = [
    { name: "Click-Through Rate (CTR)", val: ag.ctr, fmt: app.percentFormatter, k: "ctr" },
    { name: "Cost per Click (CPC)", val: ag.cpc, fmt: app.currencyFormatter, k: "cpc" },
    { name: "Lead Conversion Rate (Clicks → Lead)", val: ag.lcr, fmt: app.percentFormatter, k: "lcr" },
    { name: "Cost per Lead (CPL)", val: ag.cpl, fmt: app.currencyFormatter, k: "cpl" },
    { name: "Show-Up Rate (Booked → Show-Ups)", val: ag.showRate, fmt: app.percentFormatter, k: "showRate" },
    { name: "Qualified Call Rate (Show-Ups → Qualified Calls)", val: ag.qualCallRate, fmt: app.percentFormatter, k: "qualCallRate" },
    { name: "Close Rate (Qualified Calls → Deals Closed)", val: ag.closeRate, fmt: app.percentFormatter, k: "closeRate" },
    { name: "Cost per Acquisition (CPA)", val: ag.cpa, fmt: app.currencyFormatter, k: "cpa" },
    { name: "Return on Ad Spend (ROAS)", val: ag.roas, fmt: { format: (v) => v.toFixed(2) + "x" }, k: "roas" },
    { name: "Marketing Efficiency Ratio (MER)", val: ag.mer, fmt: { format: (v) => v.toFixed(2) + "x" }, k: "mer" },
  ];

  app._benchmarkItems = items;

  const tbody = document.getElementById("benchmarkBody");
  if (!tbody) return;

  tbody.innerHTML = items
    .map((i) => {
      const s = i.k ? app.getBenchmark(i.k, i.val) : null;
      const b = s ? `<span class="px-1.5 rounded text-[8px] text-white ${s.bgClass}">${s.label}</span>` : "";
      return `<tr class="hover:bg-tmt-50">
        <td class="px-2 py-1 text-slate-600">${i.name}</td>
        <td class="px-2 py-1 text-right font-mono">${i.fmt.format(i.val)}</td>
        <td class="px-2 py-1 text-center">${b}</td>
      </tr>`;
    })
    .join("");
};

app.renderFocusArea = () => {
  const stageEl = document.getElementById("bottleneckStage");
  const recEl = document.getElementById("bottleneckRec");
  if (!stageEl || !recEl) return;

  recEl.style.whiteSpace = "normal";
  recEl.style.overflow = "hidden";
  recEl.style.textOverflow = "ellipsis";
  recEl.style.display = "-webkit-box";
  recEl.style.webkitLineClamp = "2";
  recEl.style.webkitBoxOrient = "vertical";
  recEl.style.wordBreak = "break-word";

  const items = app._benchmarkItems || [];
  const flagged = items
    .map((i) => ({ ...i, status: app.getBenchmark(i.k, i.val) }))
    .filter((x) => x.status && x.status.score <= 1);

  if (!flagged.length) {
    stageEl.textContent = "Healthy Funnel";
    stageEl.className = "text-[11px] font-bold text-tmt-700";
    recEl.textContent = "No Fair/Risky metrics detected. You can scale with control.";
    return;
  }

  const riskyCount = flagged.filter((f) => f.status.score === 0).length;
  const fairCount = flagged.filter((f) => f.status.score === 1).length;

  stageEl.textContent = `Needs Attention: ${riskyCount} Risky • ${fairCount} Fair`;
  stageEl.className = "text-[11px] font-bold text-amber-600";

  const lines = flagged.map((f) => {
    const v =
      f.k === "cpc" || f.k === "cpl" || f.k === "cpa"
        ? app.currencyFormatter.format(f.val)
        : (f.val * 100).toFixed(1) + "%";

    const v2 =
      f.k === "mer" || f.k === "roas" ? f.val.toFixed(2) + "x" : null;

    return `${f.name}: ${f.status.label} (${v2 ?? v})`;
  });

  recEl.textContent = lines.join(" • ");
};

app.renderTable = () => {
  const cols = ["Date", "Chan", "Spend", "Click", "Lead", "Qual Calls", "Book", "Show", "Deals", "Rev"];
  const header = document.getElementById("tableHeader");
  const body = document.getElementById("tableBody");
  if (!header || !body) return;

  header.innerHTML = cols.map((c) => `<th class="px-3 py-1 font-semibold text-[9px] uppercase">${c}</th>`).join("");

  body.innerHTML = app.filteredData
    .slice(0, 50)
    .map(
      (r) => `
      <tr class="hover:bg-tmt-50 border-b border-tmt-50 last:border-0">
        <td class="px-3 py-1 text-slate-500">${r.date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</td>
        <td class="px-3 py-1 font-medium text-tmt-700 truncate max-w-[80px]">${r.channel}</td>
        <td class="px-3 py-1 text-right">${app.currencyFormatter.format(r.spend)}</td>
        <td class="px-3 py-1 text-right">${app.numberFormatter.format(r.clicks)}</td>
        <td class="px-3 py-1 text-right">${app.numberFormatter.format(r.leads)}</td>
        <td class="px-3 py-1 text-right font-bold text-tmt-700">${app.numberFormatter.format(r.qualifiedCalls)}</td>
        <td class="px-3 py-1 text-right">${app.numberFormatter.format(r.booked)}</td>
        <td class="px-3 py-1 text-right">${app.numberFormatter.format(r.showUps)}</td>
        <td class="px-3 py-1 text-right font-bold text-tmt-700">${app.numberFormatter.format(r.deals)}</td>
        <td class="px-3 py-1 text-right font-bold text-tmt-700">${app.currencyFormatter.format(r.revenue)}</td>
      </tr>
    `
    )
    .join("");
};

app.filterTable = (q) => {
  const tbody = document.getElementById("tableBody");
  if (!tbody) return;

  const rows = tbody.children;
  const l = (q || "").toLowerCase();

  for (const r of rows) {
    r.style.display = r.textContent.toLowerCase().includes(l) ? "" : "none";
  }
};

