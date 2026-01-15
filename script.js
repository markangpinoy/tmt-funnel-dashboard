const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQodpSGaQTvWB7i7sUMZ-5lS17ILsch4R4OxKofe22s8gKNXt_BCvHiQ6Ddvg0LD14F1KgWlmkh0kri/pub?output=csv";

const app = {
  rawData: [],
  filteredData: [],
  aggregates: {},
  chartInstance: null,
  chartMode: 'daily',
  currentChartMetric: 'ctr',

  currencyFormatter: new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }),
  percentFormatter: new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 2 }),
  numberFormatter: new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }),

  // robust column matching via header keywords
  keyMap: {
    date: ['date', 'day'],
    channel: ['channel', 'source', 'platform'],
    spend: ['ad spend', 'spend', 'cost', 'amount spent'],
    impressions: ['impressions', 'views'],
    clicks: ['clicks', 'link clicks'],
    leads: ['leads', 'contacts'],
    booked: ['leads booked', 'booked', 'booked calls', 'appointments'],
    showUps: ['show-ups', 'show ups', 'attended'],
    qualifiedCalls: ['qualified calls', 'sales calls (tagged qualified)', 'tagged qualified', 'qualified'],
    deals: ['deals closed', 'deals', 'deal closed'],
    revenue: ['revenue (booked)', 'revenue', 'sales value'],
    cashIn: ['cash-in (collected)', 'cash-in', 'cash in', 'cash-in collected', 'collected']
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

  const setDates = (startId, endId) => {
    const s = document.getElementById(startId);
    const e = document.getElementById(endId);
    if (s && e) {
      s.valueAsDate = firstDay;
      e.valueAsDate = today;
      s.addEventListener('change', app.updateDashboard);
      e.addEventListener('change', app.updateDashboard);
    }
  };

  setDates('startDate', 'endDate');
  setDates('startDateMobile', 'endDateMobile');

  const channelFilter = document.getElementById('channelFilter');
  if (channelFilter) channelFilter.addEventListener('change', app.updateDashboard);

  const tableSearch = document.getElementById('tableSearch');
  if (tableSearch) tableSearch.addEventListener('keyup', (e) => app.filterTable(e.target.value));

  app.fetchData();
});

app.fetchData = () => {
  const lastUpdated = document.getElementById('lastUpdated');
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
    error: (err) => app.showError("Network Error: " + err.message)
  });
};

app.showError = (msg) => {
  const el = document.getElementById('errorContainer');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
};

app.processData = (data, headers) => {
  const cleanHeaders = headers.map(h => (h || '').toLowerCase().trim());
  const columnMap = {};

  for (const [key, variants] of Object.entries(app.keyMap)) {
    const matchIndex = cleanHeaders.findIndex(h => variants.some(v => h.includes(v)));
    if (matchIndex !== -1) columnMap[key] = headers[matchIndex];
  }

  // helpful warning if required columns missing
  const required = ['date','channel','spend','impressions','clicks','leads','booked','showUps','qualifiedCalls','deals','revenue','cashIn'];
  const missing = required.filter(k => !columnMap[k]);
  if (missing.length) {
    app.showError("Missing columns in sheet: " + missing.join(', ') + ". Please check headers.");
  }

  const safeFloat = (val) => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    const cleaned = String(val).replace(/[₱$,%]/g, '').trim();
    if (cleaned === '—' || cleaned === '-' || cleaned === '') return 0;
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  };

  app.rawData = data.map(row => {
    const dateStr = row[columnMap.date];
    const parsedDate = new Date(dateStr);

    return {
      date: !isNaN(parsedDate) ? parsedDate : null,
      channel: row[columnMap.channel] || 'Unknown',
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
      original: row
    };
  }).filter(item => item.date);

  // channels dropdown
  const channels = [...new Set(app.rawData.map(d => d.channel))].sort();
  const select = document.getElementById('channelFilter');
  if (select) {
    select.innerHTML = '<option value="All">All Channels</option>';
    channels.forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch;
      opt.textContent = ch;
      select.appendChild(opt);
    });
  }

  app.updateDashboard();
};

app.updateDashboard = () => {
  const start = document.getElementById('startDate')?.valueAsDate || document.getElementById('startDateMobile')?.valueAsDate;
  const end = document.getElementById('endDate')?.valueAsDate || document.getElementById('endDateMobile')?.valueAsDate;
  if (end) end.setHours(23, 59, 59, 999);

  const channel = document.getElementById('channelFilter')?.value || 'All';

  app.filteredData = app.rawData.filter(d => {
    const inDate = (!start || d.date >= start) && (!end || d.date <= end);
    const inChannel = channel === 'All' || d.channel === channel;
    return inDate && inChannel;
  });

  const totals = {
    spend: 0, impressions: 0, clicks: 0, leads: 0,
    booked: 0, showUps: 0, qualifiedCalls: 0,
    deals: 0, revenue: 0, cashIn: 0
  };

  app.filteredData.forEach(d => {
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

  const safeDiv = (n, d) => d > 0 ? n / d : 0;

  app.aggregates = {
    totals,

    // rates & costs
    ctr: safeDiv(totals.clicks, totals.impressions),
    cpc: safeDiv(totals.spend, totals.clicks),

    // lead conversion (clicks -> leads)
    leadConv: safeDiv(totals.leads, totals.clicks),
    cpl: safeDiv(totals.spend, totals.leads),

    // booked rate (leads -> booked)
    bookedRate: safeDiv(totals.booked, totals.leads),
    cpbc: safeDiv(totals.spend, totals.booked),

    // show rate (booked -> show-ups)
    showRate: safeDiv(totals.showUps, totals.booked),

    // qualified call rate (show-ups -> qualified calls)
    qualifiedCallRate: safeDiv(totals.qualifiedCalls, totals.showUps),

    // close rate (qualified calls -> deals)  ✅ (your request)
    closeRate: safeDiv(totals.deals, totals.qualifiedCalls),

    // CPA (spend -> deals)
    cpa: safeDiv(totals.spend, totals.deals),

    // ROAS & MER ✅ (your request)
    roas: safeDiv(totals.revenue, totals.spend),  // Revenue (Booked) / Spend
    mer: safeDiv(totals.cashIn, totals.spend),    // Cash-In (Collected) / Spend
  };

  app.renderKPICards();
  app.renderFunnel();
  app.renderCharts();
  app.renderBenchmarks();
  app.renderTable();
  app.renderFocusArea();
};

/* KPI rendering: top row + CPA row */
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
  const container = document.getElementById('funnelContainer');
  if (!container) return;

  const stages = [
    { name: 'Impressions', icon: 'fa-eye', count: ag.totals.impressions, conv: null },
    { name: 'Clicks', icon: 'fa-arrow-pointer', count: ag.totals.clicks, conv: ag.ctr },
    { name: 'Leads', icon: 'fa-user-check', count: ag.totals.leads, conv: ag.leadConv },
    { name: 'Booked Calls', icon: 'fa-phone', count: ag.totals.booked, conv: ag.bookedRate },
    { name: 'Show-Ups', icon: 'fa-video', count: ag.totals.showUps, conv: ag.showRate },
    { name: 'Qualified Calls', icon: 'fa-user-tie', count: ag.totals.qualifiedCalls, conv: ag.qualifiedCallRate },
    { name: 'Deals Closed', icon: 'fa-handshake', count: ag.totals.deals, conv: ag.closeRate }
  ];

  let html = `<div class="funnel-container">`;
  stages.forEach((stage, idx) => {
    const width = 92 - (idx * 7);
    const convLabel = stage.conv === null ? '' : `<span class="text-[10px] font-bold text-tmt-700">${(stage.conv * 100).toFixed(1)}%</span>`;

    html += `
      <div class="funnel-row" style="width:${Math.max(width, 45)}%">
        <div class="flex items-center gap-2">
          <i class="fa-solid ${stage.icon} text-tmt-600"></i>
          <span class="text-[11px] font-bold text-slate-700">${stage.name}</span>
        </div>
        <div class="flex items-center gap-3">
          ${convLabel}
          <span class="px-2 py-0.5 rounded-full bg-tmt-100 text-tmt-800 text-[10px] font-extrabold">
            ${app.numberFormatter.format(stage.count)}
          </span>
        </div>
      </div>
    `;
  });
  html += `</div>`;

  container.innerHTML = html;
};

app.updateChartMetric = (metric) => {
  app.currentChartMetric = metric;
  app.renderCharts();
};

app.renderCharts = () => {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (app.chartInstance) app.chartInstance.destroy();

  const grouped = new Map();

  app.filteredData.forEach(d => {
    const key = d.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (!grouped.has(key)) grouped.set(key, { spend: 0, clicks: 0, imps: 0, leads: 0, rev: 0, cash: 0 });
    const g = grouped.get(key);
    g.spend += d.spend;
    g.clicks += d.clicks;
    g.imps += d.impressions;
    g.leads += d.leads;
    g.rev += d.revenue;
    g.cash += d.cashIn;
  });

  const labels = Array.from(grouped.keys());
  const safeDiv = (n, d) => d > 0 ? n / d : 0;

  const data = Array.from(grouped.values()).map(g => {
    switch (app.currentChartMetric) {
      case 'ctr': return safeDiv(g.clicks, g.imps) * 100;
      case 'cpc': return safeDiv(g.spend, g.clicks);
      case 'cpl': return safeDiv(g.spend, g.leads);
      case 'mer': return safeDiv(g.cash, g.spend);
      default: return 0;
    }
  });

  app.chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#16a34a',
        backgroundColor: (ctx) => {
          const grad = ctx.chart.ctx.createLinearGradient(0, 0, 0, 220);
          grad.addColorStop(0, 'rgba(22, 163, 74, 0.22)');
          grad.addColorStop(1, 'rgba(22, 163, 74, 0)');
          return grad;
        },
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { font: { size: 10 } } },
        x: { ticks: { maxTicksLimit: 8, font: { size: 10 } }, grid: { display: false } }
      }
    }
  });
};

/* Benchmarks */
app.getBenchmark = (metric, value) => {
  const res = (label, bgClass, textClass, score) => ({ label, bgClass, textClass, score });
  const EX = res('Excellent', 'bg-tmt-600', 'text-tmt-700', 3);
  const GD = res('Good', 'bg-tmt-400', 'text-tmt-600', 2);
  const OK = res('Fair', 'bg-amber-400', 'text-amber-700', 1);
  const BD = res('Risky', 'bg-red-500', 'text-red-600', 0);

  switch (metric) {
    case 'ctr': return value >= 0.015 ? EX : value >= 0.01 ? GD : value >= 0.007 ? OK : BD;
    case 'cpc': return value <= 20 ? EX : value <= 40 ? GD : value <= 70 ? OK : BD;
    case 'leadConv': return value >= 0.20 ? EX : value >= 0.10 ? GD : value >= 0.05 ? OK : BD;
    case 'cpl': return value <= 150 ? EX : value <= 300 ? GD : value <= 600 ? OK : BD;
    case 'showRate': return value >= 0.70 ? EX : value >= 0.60 ? GD : value >= 0.50 ? OK : BD;
    case 'qualifiedCallRate': return value >= 0.20 ? EX : value >= 0.10 ? GD : value >= 0.05 ? OK : BD;
    case 'closeRate': return value >= 0.25 ? EX : value >= 0.15 ? GD : value >= 0.10 ? OK : BD;
    case 'mer': return value >= 4 ? EX : value >= 3 ? GD : value >= 2 ? OK : BD;
    case 'cpa': return value <= 5000 ? GD : value <= 15000 ? OK : BD;
    default: return null;
  }
};

app.renderBenchmarks = () => {
  const ag = app.aggregates;
  const items = [
    { name: 'Click-Through Rate (CTR)', val: ag.ctr, fmt: app.percentFormatter, k: 'ctr' },
    { name: 'Cost per Click (CPC)', val: ag.cpc, fmt: app.currencyFormatter, k: 'cpc' },
    { name: 'Lead Conversion Rate (Clicks → Lead)', val: ag.leadConv, fmt: app.percentFormatter, k: 'leadConv' },
    { name: 'Cost per Lead (CPL)', val: ag.cpl, fmt: app.currencyFormatter, k: 'cpl' },
    { name: 'Show-Up Rate (Booked → Show-Ups)', val: ag.showRate, fmt: app.percentFormatter, k: 'showRate' },
    { name: 'Qualified Call Rate (Show-Ups → Qualified Calls)', val: ag.qualifiedCallRate, fmt: app.percentFormatter, k: 'qualifiedCallRate' },
    { name: 'Close Rate (Qualified Calls → Deals Closed)', val: ag.closeRate, fmt: app.percentFormatter, k: 'closeRate' },
    { name: 'Cost per Acquisition (CPA)', val: ag.cpa, fmt: app.currencyFormatter, k: 'cpa' },
    { name: 'Marketing Efficiency Ratio (MER)', val: ag.mer, fmt: { format: (v) => v.toFixed(2) + 'x' }, k: 'mer' }
  ];

  const body = document.getElementById('benchmarkBody');
  if (!body) return;

  body.innerHTML = items.map(i => {
    const s = app.getBenchmark(i.k, i.val);
    const badge = s ? `<span class="px-2 py-0.5 rounded text-[10px] text-white ${s.bgClass}">${s.label}</span>` : '';
    return `
      <tr>
        <td>${i.name}</td>
        <td class="right font-mono">${i.fmt.format(i.val)}</td>
        <td class="center">${badge}</td>
      </tr>
    `;
  }).join('');
};

/* Focus Area: list ALL Fair + Risky */
app.renderFocusArea = () => {
  const ag = app.aggregates;

  const checks = [
    { key: 'leadConv', label: 'Lead Conversion Rate (Clicks → Lead)', val: ag.leadConv, display: app.percentFormatter.format(ag.leadConv) },
    { key: 'showRate', label: 'Show-Up Rate (Booked → Show-Ups)', val: ag.showRate, display: app.percentFormatter.format(ag.showRate) },
    { key: 'cpa', label: 'Cost per Acquisition (CPA)', val: ag.cpa, display: app.currencyFormatter.format(ag.cpa) },
    { key: 'mer', label: 'Marketing Efficiency Ratio (MER)', val: ag.mer, display: ag.mer.toFixed(2) + 'x' },
  ];

  const flagged = checks
    .map(x => ({ ...x, status: app.getBenchmark(x.key, x.val) }))
    .filter(x => x.status && (x.status.label === 'Fair' || x.status.label === 'Risky'));

  const stageEl = document.getElementById('bottleneckStage');
  const recEl = document.getElementById('bottleneckRec');

  if (!stageEl || !recEl) return;

  if (!flagged.length) {
    stageEl.textContent = "Healthy";
    recEl.textContent = "No Fair/Risky metrics right now. Keep scaling while monitoring CPA and Show-Up Rate.";
    return;
  }

  const riskyCount = flagged.filter(x => x.status.label === 'Risky').length;
  const fairCount = flagged.filter(x => x.status.label === 'Fair').length;

  stageEl.textContent = `Needs Attention: ${riskyCount} Risky • ${fairCount} Fair`;

  recEl.innerHTML = flagged.map(x => {
    const color = x.status.label === 'Risky' ? 'color:#dc2626;font-weight:800;' : 'color:#b45309;font-weight:800;';
    return `<span style="${color}">${x.label}: ${x.status.label}</span> <span style="color:#334155;">(${x.display})</span>`;
  }).join(' • ');
};

/* Table */
app.renderTable = () => {
  const header = document.getElementById('tableHeader');
  const body = document.getElementById('tableBody');
  if (!header || !body) return;

  const cols = ['Date', 'Chan', 'Spend', 'Click', 'Lead', 'Qual Calls', 'Book', 'Show', 'Deals', 'Rev', 'Cash In'];
  header.innerHTML = cols.map(c => `<th>${c}</th>`).join('');

  body.innerHTML = app.filteredData.slice(0, 60).map(r => `
    <tr>
      <td>${r.date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</td>
      <td style="color:#166534;font-weight:800;">${r.channel}</td>
      <td class="right">${app.currencyFormatter.format(r.spend)}</td>
      <td class="right">${app.numberFormatter.format(r.clicks)}</td>
      <td class="right">${app.numberFormatter.format(r.leads)}</td>
      <td class="right" style="font-weight:800;color:#166534;">${app.numberFormatter.format(r.qualifiedCalls)}</td>
      <td class="right">${app.numberFormatter.format(r.booked)}</td>
      <td class="right">${app.numberFormatter.format(r.showUps)}</td>
      <td class="right" style="font-weight:900;color:#166534;">${app.numberFormatter.format(r.deals)}</td>
      <td class="right" style="font-weight:900;color:#166534;">${app.currencyFormatter.format(r.revenue)}</td>
      <td class="right">${app.currencyFormatter.format(r.cashIn)}</td>
    </tr>
  `).join('');
};

app.filterTable = (q) => {
  const rows = document.getElementById('tableBody')?.children;
  if (!rows) return;
  const l = (q || '').toLowerCase();
  for (let r of rows) {
    r.style.display = r.textContent.toLowerCase().includes(l) ? "" : "none";
  }
};
