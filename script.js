const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQodpSGaQTvWB7i7sUMZ-5lS17ILsch4R4OxKofe22s8gKNXt_BCvHiQ6Ddvg0LD14F1KgWlmkh0kri/pub?output=csv";

const app = {
  rawData: [],
  filteredData: [],
  aggregates: {},
  chartInstance: null,
  chartMode: "daily",
  currentChartMetric: "ctr",

  // Updated: show 2 decimals
  currencyFormatter: new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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
    booked: ["booked calls", "leads booked", "appointments"],
    showUps: ["show-ups", "show ups", "attended"],
    deals: ["deals closed", "sales", "clients"],
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

  document.getElementById("channelFilter").addEventListener("change", app.updateDashboard);
  document.getElementById("tableSearch").addEventListener("keyup", (e) => app.filterTable(e.target.value));

  app.fetchData();
});

app.fetchData = () => {
  document.getElementById("lastUpdated").textContent = "Syncing...";

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
      document.getElementById("lastUpdated").textContent = "Live: " + new Date().toLocaleTimeString();
    },
    error: (err) => app.showError("Network Error: " + err.message),
  });
};

app.showError = (msg) => {
  const el = document.getElementById("errorContainer");
  el.textContent = msg;
  el.classList.remove("hidden");
};

app.processData = (data, headers) => {
  const columnMap = {};
  const cleanHeaders = headers.map((h) => h.toLowerCase().trim());

  for (const [key, variants] of Object.entries(app.keyMap)) {
    const matchIndex = cleanHeaders.findIndex((h) => variants.some((v) => h.includes(v)));
    if (matchIndex !== -1) columnMap[key] = headers[matchIndex];
  }

  app.rawData = data
    .map((row) => {
      const safeFloat = (val) => {
        if (!val) return 0;
        if (typeof val === "number") return val;
        const cleaned = String(val).replace(/[₱$,%]/g, "").trim();
        return cleaned === "—" || cleaned === "-" || cleaned === "" ? 0 : parseFloat(cleaned) || 0;
      };

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
        deals: safeFloat(row[columnMap.deals]),
        revenue: safeFloat(row[columnMap.revenue]),
        cashIn: safeFloat(row[columnMap.cashIn]),
        original: row,
      };
    })
    .filter((item) => item.date);

  const channels = [...new Set(app.rawData.map((d) => d.channel))].sort();
  const select = document.getElementById("channelFilter");
  select.innerHTML = '<option value="All">All Channels</option>';
  channels.forEach((ch) => {
    const opt = document.createElement("option");
    opt.value = ch;
    opt.textContent = ch;
    select.appendChild(opt);
  });

  app.updateDashboard();
};

app.updateDashboard = () => {
  const start = document.getElementById("startDate").valueAsDate || document.getElementById("startDateMobile").valueAsDate;
  const end = document.getElementById("endDate").valueAsDate || document.getElementById("endDateMobile").valueAsDate;

  if (end) end.setHours(23, 59, 59, 999);
  const channel = document.getElementById("channelFilter").value;

  app.filteredData = app.rawData.filter((d) => {
    const inDate = (!start || d.date >= start) && (!end || d.date <= end);
    const inChannel = channel === "All" || d.channel === channel;
    return inDate && inChannel;
  });

  const totals = { spend: 0, impressions: 0, clicks: 0, leads: 0, booked: 0, showUps: 0, deals: 0, revenue: 0, cashIn: 0 };

  app.filteredData.forEach((d) => {
    totals.spend += d.spend;
    totals.impressions += d.impressions;
    totals.clicks += d.clicks;
    totals.leads += d.leads;
    totals.booked += d.booked;
    totals.showUps += d.showUps;
    totals.deals += d.deals;
    totals.revenue += d.revenue;
    totals.cashIn += d.cashIn;
  });

  const safeDiv = (n, d) => (d > 0 ? n / d : 0);

  app.aggregates = {
    totals,
    ctr: safeDiv(totals.clicks, totals.impressions),
    cpc: safeDiv(totals.spend, totals.clicks),
    lcr: safeDiv(totals.leads, totals.clicks),
    cpl: safeDiv(totals.spend, totals.leads),
    bookRate: safeDiv(totals.booked, totals.leads),
    cpbc: safeDiv(totals.spend, totals.booked),
    showRate: safeDiv(totals.showUps, totals.booked),
    closeRate: safeDiv(totals.deals, totals.showUps),
    cpa: safeDiv(totals.spend, totals.deals),
    mer: safeDiv(totals.revenue, totals.spend),
    roas: safeDiv(totals.cashIn, totals.spend),
  };

  app.renderKPICards();
  app.renderFunnel();
  app.renderCharts();
  app.renderBenchmarks();
  app.renderTable();
};

app.renderKPICards = () => {
  const ag = app.aggregates;
  const kpis = [
    { title: "Ad Spend", val: app.currencyFormatter.format(ag.totals.spend) },
    { title: "Revenue", val: app.currencyFormatter.format(ag.totals.revenue) },
    { title: "Cash Col.", val: app.currencyFormatter.format(ag.totals.cashIn) },
    { title: "CPA", val: app.currencyFormatter.format(ag.cpa), status: app.getBenchmark("cpa", ag.cpa) },
    { title: "MER", val: ag.mer.toFixed(2) + "x", status: app.getBenchmark("mer", ag.mer) },
    { title: "ROAS", val: ag.roas.toFixed(2) + "x" },
  ];

  const container = document.getElementById("kpiContainer");
  container.innerHTML = kpis
    .map(
      (k) => `
      <div class="bg-white rounded border border-tmt-100 p-2 shadow-sm flex flex-col h-14 justify-center relative overflow-hidden group hover:border-tmt-300 transition">
        ${k.status ? `<div class="absolute right-0 top-0 w-1 h-full ${k.status.bgClass}"></div>` : ""}
        <div class="text-[9px] font-bold text-tmt-400 uppercase tracking-wider mb-0.5">${k.title}</div>
        <div class="text-sm font-bold text-slate-800 truncate leading-none">${k.val}</div>
      </div>`
    )
    .join("");
};

app.renderFunnel = () => {
  const ag = app.aggregates;
  const container = document.getElementById("funnelContainer");

  const stages = [
    { name: "Impressions", icon: "fa-eye", count: ag.totals.impressions, conv: null },
    { name: "Clicks", icon: "fa-arrow-pointer", count: ag.totals.clicks, conv: ag.ctr },
    { name: "Leads", icon: "fa-user-check", count: ag.totals.leads, conv: ag.lcr },
    { name: "Booked", icon: "fa-phone", count: ag.totals.booked, conv: ag.bookRate },
    { name: "Show-Ups", icon: "fa-video", count: ag.totals.showUps, conv: ag.showRate },
    { name: "Deals", icon: "fa-handshake", count: ag.totals.deals, conv: ag.closeRate },
  ];

  let html = '<div class="funnel-flow-line"></div>';

  stages.forEach((stage, idx) => {
    const width = 85 - idx * 10;

    let connectorHtml = "";
    if (stage.conv !== null) {
      connectorHtml = `
        <div class="funnel-connector">
          <i class="fa-solid fa-chevron-down text-[8px] text-tmt-400"></i>
          <span class="font-bold text-tmt-800">${(stage.conv * 100).toFixed(1)}%</span>
        </div>`;
    }

    html += `
      <div class="funnel-row" style="width: ${Math.max(width, 40)}%;">
        <div class="flex items-center">
          <i class="fa-solid ${stage.icon} funnel-icon"></i>
          <span class="truncate">${stage.name}</span>
        </div>
        <span class="funnel-stat">${app.numberFormatter.format(stage.count)}</span>
        ${connectorHtml}
      </div>`;
  });

  container.innerHTML = html;

  // Bottleneck
  const metrics = [
    { key: "ctr", name: "CTR", val: ag.ctr },
    { key: "lcr", name: "Lead Conv", val: ag.lcr },
    { key: "showRate", name: "Show Rate", val: ag.showRate },
    { key: "closeRate", name: "Close Rate", val: ag.closeRate },
  ];

  let worst = null;
  let minScore = 4;

  metrics.forEach((m) => {
    const s = app.getBenchmark(m.key, m.val);
    if (s && s.score < minScore) {
      minScore = s.score;
      worst = { ...m, status: s };
    }
  });

  const bStage = document.getElementById("bottleneckStage");
  const bRec = document.getElementById("bottleneckRec");

  if (worst) {
    bStage.textContent = `${worst.name} (${(worst.val * 100).toFixed(1)}%)`;
    bStage.className = `text-[11px] font-bold ${worst.status.textClass}`;
    const recs = {
      ctr: "Test new hooks.",
      lcr: "Fix landing page.",
      showRate: "Improve follow-up.",
      closeRate: "Review sales calls.",
    };
    bRec.textContent = recs[worst.key] || "Optimize this stage.";
  } else {
    bStage.textContent = "Healthy";
    bRec.textContent = "Scale spend.";
  }
};

app.setChartMode = (mode) => {
  app.chartMode = mode;

  document.getElementById("btnDaily").className =
    mode === "daily"
      ? "px-1.5 py-0.5 text-[9px] font-bold rounded bg-white shadow-sm text-tmt-700"
      : "px-1.5 py-0.5 text-[9px] font-bold rounded text-tmt-400 hover:text-tmt-700";

  document.getElementById("btnWeekly").className =
    mode === "weekly"
      ? "px-1.5 py-0.5 text-[9px] font-bold rounded bg-white shadow-sm text-tmt-700"
      : "px-1.5 py-0.5 text-[9px] font-bold rounded text-tmt-400 hover:text-tmt-700";

  app.renderCharts();
};

app.updateChartMetric = (metric) => {
  app.currentChartMetric = metric;
  document.querySelectorAll(".chart-btn").forEach((btn) => {
    if (btn.dataset.metric === metric) {
      btn.classList.add("border-tmt-400", "bg-tmt-100", "text-tmt-800", "font-bold");
      btn.classList.remove("border-tmt-200", "hover:bg-tmt-50");
    } else {
      btn.classList.remove("border-tmt-400", "bg-tmt-100", "text-tmt-800", "font-bold");
      btn.classList.add("border-tmt-200", "hover:bg-tmt-50");
    }
  });
  app.renderCharts();
};

app.renderCharts = () => {
  const canvas = document.getElementById("trendChart");
  const ctx = canvas.getContext("2d");
  if (app.chartInstance) app.chartInstance.destroy();

  const grouped = new Map();
  app.filteredData.forEach((d) => {
    let key;
    if (app.chartMode === "weekly") {
      const date = new Date(d.date);
      date.setDate(date.getDate() - date.getDay());
      key = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } else {
      key = d.date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    if (!grouped.has(key)) grouped.set(key, { s: 0, c: 0, i: 0, l: 0, b: 0, rev: 0 });
    const g = grouped.get(key);
    g.s += d.spend;
    g.c += d.clicks;
    g.i += d.impressions;
    g.l += d.leads;
    g.b += d.booked;
    g.rev += d.revenue;
  });

  const labels = Array.from(grouped.keys());
  const data = Array.from(grouped.values()).map((g) => {
    const safeDiv = (n, d) => (d > 0 ? n / d : 0);
    switch (app.currentChartMetric) {
      case "ctr": return safeDiv(g.c, g.i) * 100;
      case "cpc": return safeDiv(g.s, g.c);
      case "cpl": return safeDiv(g.s, g.l);
      case "mer": return safeDiv(g.rev, g.s);
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
        backgroundColor: (ctx) => {
          const grad = ctx.chart.ctx.createLinearGradient(0, 0, 0, 200);
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

app.getBenchmark = (metric, value) => {
  const res = (label, bgClass, textClass, score) => ({ label, bgClass, textClass, score });
  const EX = res("Excellent", "bg-tmt-500", "text-tmt-600", 3);
  const GD = res("Good", "bg-tmt-300", "text-tmt-500", 2);
  const OK = res("Fair", "bg-amber-400", "text-amber-500", 1);
  const BD = res("Risky", "bg-red-500", "text-red-500", 0);

  switch (metric) {
    case "ctr": return value >= 0.015 ? EX : value >= 0.01 ? GD : value >= 0.007 ? OK : BD;
    case "cpc": return value <= 20 ? EX : value <= 40 ? GD : value <= 70 ? OK : BD;
    case "lcr": return value >= 0.20 ? EX : value >= 0.10 ? GD : value >= 0.05 ? OK : BD;
    case "cpl": return value <= 150 ? EX : value <= 300 ? GD : value <= 600 ? OK : BD;
    case "showRate": return value >= 0.70 ? EX : value >= 0.60 ? GD : value >= 0.50 ? OK : BD;
    case "closeRate": return value >= 0.25 ? EX : value >= 0.15 ? GD : value >= 0.10 ? OK : BD;
    case "mer": return value >= 4 ? EX : value >= 3 ? GD : value >= 2 ? OK : BD;
    case "cpa": return value <= 3000 ? GD : OK;
    default: return null;
  }
};

app.renderBenchmarks = () => {
  const ag = app.aggregates;
  const items = [
    { name: "CTR", val: ag.ctr, fmt: app.percentFormatter, k: "ctr" },
    { name: "CPC", val: ag.cpc, fmt: app.currencyFormatter, k: "cpc" },
    { name: "Lead Conv", val: ag.lcr, fmt: app.percentFormatter, k: "lcr" },
    { name: "CPL", val: ag.cpl, fmt: app.currencyFormatter, k: "cpl" },
    { name: "Show Rate", val: ag.showRate, fmt: app.percentFormatter, k: "showRate" },
    { name: "Close Rate", val: ag.closeRate, fmt: app.percentFormatter, k: "closeRate" },
    { name: "MER", val: ag.mer, fmt: { format: (v) => v.toFixed(2) + "x" }, k: "mer" },
  ];

  document.getElementById("benchmarkBody").innerHTML = items
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

app.renderTable = () => {
  const cols = ["Date", "Chan", "Spend", "Click", "Lead", "CPL", "Book", "Deal", "Rev"];
  document.getElementById("tableHeader").innerHTML = cols
    .map((c) => `<th class="px-3 py-1 font-semibold text-[9px] uppercase">${c}</th>`)
    .join("");

  document.getElementById("tableBody").innerHTML = app.filteredData
    .slice(0, 50)
    .map(
      (r) => `
      <tr class="hover:bg-tmt-50 border-b border-tmt-50 last:border-0">
        <td class="px-3 py-1 text-slate-500">${r.date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</td>
        <td class="px-3 py-1 font-medium text-tmt-700 truncate max-w-[80px]">${r.channel}</td>
        <td class="px-3 py-1 text-right">${app.currencyFormatter.format(r.spend)}</td>
        <td class="px-3 py-1 text-right">${r.clicks}</td>
        <td class="px-3 py-1 text-right">${r.leads}</td>
        <td class="px-3 py-1 text-right text-slate-500">${app.currencyFormatter.format(r.leads > 0 ? r.spend / r.leads : 0)}</td>
        <td class="px-3 py-1 text-right">${r.booked}</td>
        <td class="px-3 py-1 text-right font-bold text-tmt-700">${r.deals}</td>
        <td class="px-3 py-1 text-right font-bold text-tmt-700">${app.currencyFormatter.format(r.revenue)}</td>
      </tr>`
    )
    .join("");
};

app.filterTable = (q) => {
  const rows = document.getElementById("tableBody").children;
  const l = q.toLowerCase();
  for (let r of rows) r.style.display = r.textContent.toLowerCase().includes(l) ? "" : "none";
};


