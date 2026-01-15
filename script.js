const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQodpSGaQTvWB7i7sUMZ-5lS17ILsch4R4OxKofe22s8gKNXt_BCvHiQ6Ddvg0LD14F1KgWlmkh0kri/pub?output=csv";

const app = {
  rawData: [],
  filteredData: [],
  aggregates: {},
  chartInstance: null,
  chartInstanceMobile: null,
  chartMode: "daily",
  currentChartMetric: "ctr",
  rowLimit: 10,

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

  // Column matching (Google Sheet headers may vary)
  keyMap: {
    date: ["date", "day"],
    channel: ["channel", "source", "platform"],
    spend: ["ad spend", "spend", "cost", "amount spent"],
    impressions: ["impressions", "views"],
    clicks: ["clicks", "link clicks"],
    leads: ["leads"],
    booked: ["leads booked", "booked calls", "booked"],
    showUps: ["show-ups", "show ups", "attended"],
    qualifiedCalls: ["qualified calls", "sales calls (qualified)", "sales calls qualified"],
    dealsClosed: ["deals closed", "deal closed", "closed deals"],
    revenue: ["revenue (booked)", "revenue booked", "revenue"],
    cashIn: ["cash-in (collected)", "cash-in", "cash in", "collected", "cash collected"],
  },
};

document.addEventListener("DOMContentLoaded", () => {
  // Default dates = month start to today
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

  // Sync buttons
  const btnSync = document.getElementById("btnSync");
  if (btnSync) btnSync.addEventListener("click", app.fetchData);

  const btnSyncMobile = document.getElementById("btnSyncMobile");
  if (btnSyncMobile) btnSyncMobile.addEventListener("click", app.fetchData);

  // Filters
  const channelFilter = document.getElementById("channelFilter");
  if (channelFilter) channelFilter.addEventListener("change", app.updateDashboard);

  // Search + row limit
  const tableSearch = document.getElementById("tableSearch");
  if (tableSearch) {
    tableSearch.addEventListener("keyup", (e) => app.filterTable(e.target.value));
  }

  const rowLimitEl = document.getElementById("rowLimit");
  if (rowLimitEl) {
    rowLimitEl.addEventListener("change", (e) => {
      app.rowLimit = parseInt(e.target.value, 10) || 10;
      app.renderTable();
    });
  }

  // Chart metric buttons (desktop + mobile share same class)
  document.querySelectorAll(".chart-btn").forEach((btn) => {
    btn.addEventListener("click", () => app.updateChartMetric(btn.dataset.metric));
  });

  // Day/Wk toggles
  const bindModeButtons = (dailyId, weeklyId) => {
    const d = document.getElementById(dailyId);
    const w = document.getElementById(weeklyId);
    if (d) d.addEventListener("click", () => app.setChartMode("daily"));
    if (w) w.addEventListener("click", () => app.setChartMode("weekly"));
  };
  bindModeButtons("btnDaily", "btnWeekly");
  bindModeButtons("btnDailyMobile", "btnWeeklyMobile");

  // Mobile tabs
  app.initTabs();

  // Initial
  app.fetchData();
});

app.initTabs = () => {
  const tabButtons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  const activate = (id) => {
    panels.forEach((p) => p.classList.remove("active"));
    tabButtons.forEach((b) => b.classList.remove("tab-active"));

    const panel = document.getElementById(id);
    if (panel) panel.classList.add("active");

    tabButtons.forEach((b) => {
      if (b.dataset.tab === id) b.classList.add("tab-active");
    });

    // When switching to trends on mobile, redraw chart to fit canvas
    if (id === "tab-trends") {
      setTimeout(() => app.renderCharts(), 50);
    }
  };

  tabButtons.forEach((btn) => btn.addEventListener("click", () => activate(btn.dataset.tab)));

  // Default mobile tab
  activate("tab-kpis");
};

app.fetchData = () => {
  const lastUpdated = document.getElementById("lastUpdated");
  if (lastUpdated) lastUpdated.textContent = "Syncing...";

  Papa.parse(SHEET_CSV_URL, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      if (results.errors.length && !results.data.length) {
        app.showError("Failed to load CSV data.");
        return;
      }
      app.processData(results.data, results.meta.fields || []);
      if (lastUpdated) lastUpdated.textContent = "Live: " + new Date().toLocaleTimeString();
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
    const matchIndex = cleanHeaders.findIndex((h) => variants.some((v) => h.includes(v)));
    if (matchIndex !== -1) columnMap[key] = headers[matchIndex];
  }

  const safeFloat = (val) => {
    if (val == null) return 0;
    if (typeof val === "number") return val;
    const cleaned = String(val).replace(/[₱$,%]/g, "").trim();
    if (cleaned === "—" || cleaned === "-" || cleaned === "") return 0;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  };

  app.rawData = data
    .map((row) => {
      const dateStr = row[columnMap.date];
      const parsedDate = new Date(dateStr);

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
        dealsClosed: safeFloat(row[columnMap.dealsClosed]),
        revenue: safeFloat(row[columnMap.revenue]),
        cashIn: safeFloat(row[columnMap.cashIn]),
        original: row,
      };
    })
    .filter((r) => r.date);

  // Channels dropdown
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
    dealsClosed: 0,
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
    totals.dealsClosed += d.dealsClosed;
    totals.revenue += d.revenue;
    totals.cashIn += d.cashIn;
  });

  const safeDiv = (n, d) => (d > 0 ? n / d : 0);

  // Core ratios
  const ctr = safeDiv(totals.clicks, totals.impressions);
  const cpc = safeDiv(totals.spend, totals.clicks);
  const lcr = safeDiv(totals.leads, totals.clicks);
  const cpl = safeDiv(totals.spend, totals.leads);

  // Funnel rates
  const bookRate = safeDiv(totals.booked, totals.leads);
  const showRate = safeDiv(totals.showUps, totals.booked);

  // NEW: qualified call rate (Show-ups -> Qualified Calls)
  const qualifiedCallRate = safeDiv(totals.qualifiedCalls, totals.showUps);

  // NEW: close rate = Deals Closed / Qualified Calls (as you requested)
  const closeRate = safeDiv(totals.dealsClosed, totals.qualifiedCalls);

  // CPA = Spend / Deals Closed
  const cpa = safeDiv(totals.spend, totals.dealsClosed);

  // ROAS = Revenue(Booked) / Spend
  const roas = safeDiv(totals.revenue, totals.spend);

  // MER = Cash-in(Collected) / Spend  (corrected)
  const mer = safeDiv(totals.cashIn, totals.spend);

  app.aggregates = {
    totals,
    ctr,
    cpc,
    lcr,
    cpl,
    bookRate,
    showRate,
    qualifiedCallRate,
    closeRate,
    cpa,
    roas,
    mer,
  };

  app.renderKPIs();
  app.renderFunnel();
  app.renderCharts();
  app.renderBenchmarksAndFocus();
  app.renderTable();
};

app.renderKPIs = () => {
  const ag = app.aggregates;

  // Top row KPI cards (7 items)
  const kpis = [
    { title: "Ad Spend", val: app.currencyFormatter.format(ag.totals.spend) },
    { title: "Revenue (Booked)", val: app.currencyFormatter.format(ag.totals.revenue) },
    { title: "Cash Collected", val: app.currencyFormatter.format(ag.totals.cashIn) },
    { title: "Qualified Calls", val: app.numberFormatter.format(ag.totals.qualifiedCalls) },
    { title: "Deals Closed", val: app.numberFormatter.format(ag.totals.dealsClosed) },
    { title: "Return on Ad Spend (ROAS)", val: ag.roas.toFixed(2) + "x", status: app.getBenchmark("roas", ag.roas) },
    { title: "Marketing Efficiency Ratio (MER)", val: ag.mer.toFixed(2) + "x", status: app.getBenchmark("mer", ag.mer) },
  ];

  const top = document.getElementById("kpiTopRow");
  if (top) {
    top.innerHTML = kpis
      .map((k) => {
        const s = k.status;
        const stripe = s ? `<div class="absolute right-0 top-0 w-1 h-full ${s.bgClass}"></div>` : "";
        return `
          <div class="bg-white rounded border border-tmt-100 p-2 shadow-sm flex flex-col h-14 justify-center relative overflow-hidden hover:border-tmt-300 transition">
            ${stripe}
            <div class="text-[9px] font-bold text-tmt-500 uppercase tracking-wider mb-0.5">${k.title}</div>
            <div class="text-sm font-bold text-slate-800 truncate leading-none">${k.val}</div>
          </div>
        `;
      })
      .join("");
  }

  // CPA big card (2nd row only)
  const cpaStatus = app.getBenchmark("cpa", ag.cpa);
  const statusText = cpaStatus ? cpaStatus.label : "";
  const statusColor = cpaStatus ? cpaStatus.textClass : "text-slate-500";
  const stripe = cpaStatus ? `<div class="absolute right-0 top-0 w-1 h-full ${cpaStatus.bgClass}"></div>` : "";

  const cpaEl = document.getElementById("kpiCPAContainer");
  if (cpaEl) {
    cpaEl.innerHTML = `
      <div class="bg-white rounded border border-tmt-100 p-3 shadow-sm relative overflow-hidden flex flex-col items-center justify-center text-center">
        ${stripe}
        <div class="text-[10px] font-bold text-tmt-600 uppercase tracking-wider">Cost per Acquisition (CPA)</div>
        <div class="text-2xl font-extrabold text-slate-800 mt-1">${app.currencyFormatter.format(ag.cpa)}</div>
        <div class="text-[11px] font-bold mt-1 ${statusColor}">${statusText}</div>
      </div>
    `;
  }
};

app.renderFunnel = () => {
  const ag = app.aggregates;

  const stages = [
    { name: "Impressions", icon: "fa-eye", count: ag.totals.impressions, conv: null },
    { name: "Clicks", icon: "fa-arrow-pointer", count: ag.totals.clicks, conv: ag.ctr },
    { name: "Leads", icon: "fa-user-check", count: ag.totals.leads, conv: ag.lcr },
    { name: "Booked", icon: "fa-phone", count: ag.totals.booked, conv: ag.bookRate },
    { name: "Show-Ups", icon: "fa-video", count: ag.totals.showUps, conv: ag.showRate },
    { name: "Qualified Calls", icon: "fa-user-tie", count: ag.totals.qualifiedCalls, conv: ag.qualifiedCallRate },
    { name: "Deals Closed", icon: "fa-handshake", count: ag.totals.dealsClosed, conv: ag.closeRate },
  ];

  const buildHTML = () => {
    let html = '<div class="funnel-flow-line"></div>';
    stages.forEach((stage, idx) => {
      const width = 88 - idx * 8; // funnel effect
      const connector =
        stage.conv === null
          ? ""
          : `
            <div class="funnel-connector">
              <i class="fa-solid fa-chevron-down text-[8px] text-tmt-400"></i>
              <span class="font-bold text-tmt-800">${(stage.conv * 100).toFixed(1)}%</span>
            </div>
          `;

      html += `
        <div class="funnel-row" style="width:${Math.max(width, 44)}%;">
          <div class="flex items-center">
            <i class="fa-solid ${stage.icon} funnel-icon"></i>
            <span class="truncate">${stage.name}</span>
          </div>
          <span class="funnel-stat">${app.numberFormatter.format(stage.count)}</span>
          ${connector}
        </div>
      `;
    });
    return html;
  };

  const desktop = document.getElementById("funnelContainer");
  if (desktop) desktop.innerHTML = buildHTML();

  const mobile = document.getElementById("funnelContainerMobile");
  if (mobile) mobile.innerHTML = buildHTML();
};

app.setChartMode = (mode) => {
  app.chartMode = mode;

  // Desktop buttons
  const d = document.getElementById("btnDaily");
  const w = document.getElementById("btnWeekly");
  if (d && w) {
    d.className =
      mode === "daily"
        ? "px-1.5 py-0.5 text-[9px] font-bold rounded bg-white shadow-sm text-tmt-700"
        : "px-1.5 py-0.5 text-[9px] font-bold rounded text-tmt-400 hover:text-tmt-700";
    w.className =
      mode === "weekly"
        ? "px-1.5 py-0.5 text-[9px] font-bold rounded bg-white shadow-sm text-tmt-700"
        : "px-1.5 py-0.5 text-[9px] font-bold rounded text-tmt-400 hover:text-tmt-700";
  }

  // Mobile buttons
  const dm = document.getElementById("btnDailyMobile");
  const wm = document.getElementById("btnWeeklyMobile");
  if (dm && wm) {
    dm.className =
      mode === "daily"
        ? "px-1.5 py-0.5 text-[9px] font-bold rounded bg-white shadow-sm text-tmt-700"
        : "px-1.5 py-0.5 text-[9px] font-bold rounded text-tmt-400 hover:text-tmt-700";
    wm.className =
      mode === "weekly"
        ? "px-1.5 py-0.5 text-[9px] font-bold rounded bg-white shadow-sm text-tmt-700"
        : "px-1.5 py-0.5 text-[9px] font-bold rounded text-tmt-400 hover:text-tmt-700";
  }

  app.renderCharts();
};

app.updateChartMetric = (metric) => {
  app.currentChartMetric = metric;

  document.querySelectorAll(".chart-btn").forEach((btn) => {
    if (btn.dataset.metric === metric) btn.classList.add("active");
    else btn.classList.remove("active");
  });

  app.renderCharts();
};

app.renderCharts = () => {
  // Group by day/week
  const grouped = new Map();
  app.filteredData.forEach((d) => {
    let key;
    if (app.chartMode === "weekly") {
      const date = new Date(d.date);
      date.setDate(date.getDate() - date.getDay()); // Sunday start
      key = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } else {
      key = d.date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    if (!grouped.has(key)) grouped.set(key, { s: 0, c: 0, i: 0, l: 0, cash: 0 });
    const g = grouped.get(key);
    g.s += d.spend;
    g.c += d.clicks;
    g.i += d.impressions;
    g.l += d.leads;
    g.cash += d.cashIn;
  });

  const labels = Array.from(grouped.keys());
  const safeDiv = (n, d) => (d > 0 ? n / d : 0);

  const values = Array.from(grouped.values()).map((g) => {
    switch (app.currentChartMetric) {
      case "ctr":
        return safeDiv(g.c, g.i) * 100;
      case "cpc":
        return safeDiv(g.s, g.c);
      case "cpl":
        return safeDiv(g.s, g.l);
      case "mer":
        return safeDiv(g.cash, g.s);
      default:
        return 0;
    }
  });

  // Desktop chart
  const ctx = document.getElementById("trendChart")?.getContext("2d");
  if (ctx) {
    if (app.chartInstance) app.chartInstance.destroy();
    app.chartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            data: values,
            borderColor: "#16a34a",
            backgroundColor: (c) => {
              const grad = c.chart.ctx.createLinearGradient(0, 0, 0, 220);
              grad.addColorStop(0, "rgba(22, 163, 74, 0.20)");
              grad.addColorStop(1, "rgba(22, 163, 74, 0)");
              return grad;
            },
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: "#f0fdf4" },
            ticks: { font: { size: 9 } },
          },
          x: {
            grid: { display: false },
            ticks: { maxTicksLimit: 8, font: { size: 9 } },
          },
        },
      },
    });
  }

  // Mobile chart
  const ctxM = document.getElementById("trendChartMobile")?.getContext("2d");
  if (ctxM) {
    if (app.chartInstanceMobile) app.chartInstanceMobile.destroy();
    app.chartInstanceMobile = new Chart(ctxM, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            data: values,
            borderColor: "#16a34a",
            backgroundColor: (c) => {
              const grad = c.chart.ctx.createLinearGradient(0, 0, 0, 260);
              grad.addColorStop(0, "rgba(22, 163, 74, 0.20)");
              grad.addColorStop(1, "rgba(22, 163, 74, 0)");
              return grad;
            },
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: "#f0fdf4" }, ticks: { font: { size: 10 } } },
          x: { grid: { display: false }, ticks: { maxTicksLimit: 6, font: { size: 10 } } },
        },
      },
    });
  }
};

app.getBenchmark = (metric, value) => {
  const res = (label, bgClass, textClass, score) => ({ label, bgClass, textClass, score });

  const EX = res("Excellent", "bg-tmt-500", "text-tmt-600", 3);
  const GD = res("Good", "bg-tmt-300", "text-tmt-600", 2);
  const OK = res("Fair", "bg-amber-400", "text-amber-600", 1);
  const BD = res("Risky", "bg-red-500", "text-red-600", 0);

  switch (metric) {
    case "ctr":
      return value >= 0.015 ? EX : value >= 0.01 ? GD : value >= 0.007 ? OK : BD;
    case "cpc":
      return value <= 20 ? EX : value <= 40 ? GD : value <= 70 ? OK : BD;
    case "lcr":
      return value >= 0.2 ? EX : value >= 0.1 ? GD : value >= 0.05 ? OK : BD;
    case "cpl":
      return value <= 150 ? EX : value <= 300 ? GD : value <= 600 ? OK : BD;
    case "showRate":
      return value >= 0.7 ? EX : value >= 0.6 ? GD : value >= 0.5 ? OK : BD;
    case "qualifiedCallRate":
      return value >= 0.3 ? EX : value >= 0.2 ? GD : value >= 0.12 ? OK : BD;
    case "closeRate":
      return value >= 0.25 ? EX : value >= 0.15 ? GD : value >= 0.10 ? OK : BD;
    case "roas":
      return value >= 4 ? EX : value >= 3 ? GD : value >= 2 ? OK : BD;
    case "mer":
      return value >= 2.5 ? EX : value >= 2.0 ? GD : value >= 1.5 ? OK : BD;
    case "cpa":
      // If you want a better benchmark later, we can calibrate based on your offer economics.
      return value <= 10000 ? GD : value <= 25000 ? OK : BD;
    default:
      return null;
  }
};

app.renderBenchmarksAndFocus = () => {
  const ag = app.aggregates;

  const items = [
    { name: "Click-Through Rate (CTR)", val: ag.ctr, fmt: app.percentFormatter, k: "ctr" },
    { name: "Cost per Click (CPC)", val: ag.cpc, fmt: app.currencyFormatter, k: "cpc" },
    { name: "Lead Conversion Rate (Clicks → Leads)", val: ag.lcr, fmt: app.percentFormatter, k: "lcr" },
    { name: "Cost per Lead (CPL)", val: ag.cpl, fmt: app.currencyFormatter, k: "cpl" },
    { name: "Show-Up Rate (Booked → Show-Ups)", val: ag.showRate, fmt: app.percentFormatter, k: "showRate" },
    { name: "Qualified Call Rate (Show-Ups → Qualified Calls)", val: ag.qualifiedCallRate, fmt: app.percentFormatter, k: "qualifiedCallRate" },
    { name: "Close Rate (Qualified Calls → Deals Closed)", val: ag.closeRate, fmt: app.percentFormatter, k: "closeRate" },
    { name: "Cost per Acquisition (CPA)", val: ag.cpa, fmt: app.currencyFormatter, k: "cpa" },
    { name: "Return on Ad Spend (ROAS)", val: ag.roas, fmt: { format: (v) => v.toFixed(2) + "x" }, k: "roas" },
    { name: "Marketing Efficiency Ratio (MER)", val: ag.mer, fmt: { format: (v) => v.toFixed(2) + "x" }, k: "mer" },
  ];

  // Benchmarks table
  const tbody = document.getElementById("benchmarkBody");
  if (tbody) {
    tbody.innerHTML = items
      .map((i) => {
        const s = app.getBenchmark(i.k, i.val);
        const badge = s
          ? `<span class="px-1.5 py-0.5 rounded text-[8px] text-white ${s.bgClass}">${s.label}</span>`
          : "";
        return `
          <tr class="hover:bg-tmt-50">
            <td class="px-2 py-1 text-slate-600">${i.name}</td>
            <td class="px-2 py-1 text-right font-mono">${i.fmt.format(i.val)}</td>
            <td class="px-2 py-1 text-center">${badge}</td>
          </tr>
        `;
      })
      .join("");
  }

  // Focus Area: list ALL Fair/Risky
  const focusList = [];
  let fair = 0, risky = 0;

  items.forEach((i) => {
    const s = app.getBenchmark(i.k, i.val);
    if (!s) return;
    if (s.label === "Fair" || s.label === "Risky") {
      if (s.label === "Fair") fair++;
      if (s.label === "Risky") risky++;
      focusList.push(`${i.name}: <span class="font-bold ${s.textClass}">${s.label}</span> (${i.fmt.format(i.val)})`);
    }
  });

  const summary = document.getElementById("focusSummary");
  if (summary) summary.textContent = `Needs Attention: ${risky} Risky • ${fair} Fair`;

  const focusBox = document.getElementById("focusBox");
  const focusListEl = document.getElementById("focusList");
  if (focusListEl) {
    if (focusList.length) {
      focusListEl.innerHTML = `<ul class="list-disc ml-4">${focusList.map(x => `<li>${x}</li>`).join("")}</ul>`;
    } else {
      focusListEl.innerHTML = `<div class="text-slate-600">All key metrics look healthy. Keep scaling what’s working.</div>`;
    }
  }

  // If nothing to fix, switch border color to green
  if (focusBox) {
    focusBox.classList.remove("border-amber-400");
    focusBox.classList.remove("border-l-4");
    focusBox.classList.add("border-l-4");
    focusBox.classList.add(focusList.length ? "border-amber-400" : "border-tmt-400");
  }
};

app.renderTable = () => {
  const cols = [
    "Date",
    "Chan",
    "Spend",
    "Clicks",
    "Leads",
    "CPL",
    "Booked",
    "Show-Ups",
    "Qualified Calls",
    "Deals",
    "Revenue",
    "Cash Col."
  ];

  const header = document.getElementById("tableHeader");
  if (header) {
    header.innerHTML = cols
      .map((c) => `<th class="px-3 py-2 font-semibold text-[9px] uppercase">${c}</th>`)
      .join("");
  }

  const body = document.getElementById("tableBody");
  if (!body) return;

  const rows = app.filteredData.slice(0, app.rowLimit);

  body.innerHTML = rows
    .map((r) => {
      const cpl = r.leads > 0 ? r.spend / r.leads : 0;

      return `
      <tr class="hover:bg-tmt-50 border-b border-tmt-50 last:border-0">
        <td class="px-3 py-2 text-slate-500">${r.date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</td>
        <td class="px-3 py-2 font-medium text-tmt-700 truncate max-w-[110px]">${r.channel}</td>
        <td class="px-3 py-2 text-right">${app.currencyFormatter.format(r.spend)}</td>
        <td class="px-3 py-2 text-right">${app.numberFormatter.format(r.clicks)}</td>
        <td class="px-3 py-2 text-right">${app.numberFormatter.format(r.leads)}</td>
        <td class="px-3 py-2 text-right text-slate-500">${app.currencyFormatter.format(cpl)}</td>
        <td class="px-3 py-2 text-right">${app.numberFormatter.format(r.booked)}</td>
        <td class="px-3 py-2 text-right">${app.numberFormatter.format(r.showUps)}</td>
        <td class="px-3 py-2 text-right font-bold text-tmt-700">${app.numberFormatter.format(r.qualifiedCalls)}</td>
        <td class="px-3 py-2 text-right font-bold text-tmt-700">${app.numberFormatter.format(r.dealsClosed)}</td>
        <td class="px-3 py-2 text-right font-bold text-tmt-700">${app.currencyFormatter.format(r.revenue)}</td>
        <td class="px-3 py-2 text-right">${app.currencyFormatter.format(r.cashIn)}</td>
      </tr>`;
    })
    .join("");
};

app.filterTable = (q) => {
  const rows = document.getElementById("tableBody")?.children;
  if (!rows) return;
  const l = (q || "").toLowerCase();
  for (let r of rows) {
    r.style.display = r.textContent.toLowerCase().includes(l) ? "" : "none";
  }
};
