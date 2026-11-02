/* ==========================================================================
   Volume Society Macro Space — front-end
   Public macro data from FRED, calendar from ForexFactory.
   ========================================================================== */

(() => {
  'use strict';

  /* ---------------------------------------------------------------------- */
  /* config                                                                  */
  /* ---------------------------------------------------------------------- */

  const SERIES = [
    'DGS1MO', 'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS3', 'DGS5',
    'DGS7', 'DGS10', 'DGS20', 'DGS30', 'T10Y2Y', 'T10Y3M', 'T5YIFR',
    'DFII5', 'DFII10', 'DFII30', 'T5YIE', 'T10YIE',
    'DFF', 'EFFR', 'SOFR', 'IORB', 'DFEDTARU', 'DFEDTARL',
    'NFCI', 'NFCILEVERAGE', 'NFCICREDIT', 'NFCIRISK',
    'BAMLH0A0HYM2', 'BAMLC0A0CM', 'VIXCLS', 'SP500',
    'CPIAUCSL', 'CPILFESL', 'PCEPILFE', 'UNRATE', 'PAYEMS', 'GDPC1',
    'WALCL', 'RRPONTSYD', 'MORTGAGE30US', 'DTWEXBGS', 'DCOILWTICO'
  ];

  const METRICS = [
    { id: 'DGS10', label: 'US 10Y', unit: '%', dec: 2, tag: 'NOM' },
    { id: 'DGS2', label: 'US 2Y', unit: '%', dec: 2, tag: 'NOM' },
    { id: 'T10Y2Y', label: '2s10s', unit: 'bp', dec: 0, mul: 100, tag: 'CURVE' },
    { id: 'DFII10', label: '10Y Real', unit: '%', dec: 2, tag: 'TIPS' },
    { id: 'T10YIE', label: '10Y Breakeven', unit: '%', dec: 2, tag: 'BE' },
    { id: 'NFCI', label: 'NFCI', unit: '', dec: 2, tag: 'FCI' },
    { id: 'VIXCLS', label: 'VIX', unit: '', dec: 1, tag: 'VOL' },
    { id: 'BAMLH0A0HYM2', label: 'HY OAS', unit: 'bp', dec: 0, mul: 100, tag: 'CREDIT' }
  ];

  const TENORS = [
    { label: '1M', id: 'DGS1MO', months: 1, rank: 1 },
    { label: '3M', id: 'DGS3MO', months: 3, rank: 2 },
    { label: '6M', id: 'DGS6MO', months: 6, rank: 3 },
    { label: '1Y', id: 'DGS1', months: 12, rank: 4 },
    { label: '2Y', id: 'DGS2', months: 24, rank: 5 },
    { label: '3Y', id: 'DGS3', months: 36, rank: 6 },
    { label: '5Y', id: 'DGS5', months: 60, rank: 7 },
    { label: '7Y', id: 'DGS7', months: 84, rank: 8 },
    { label: '10Y', id: 'DGS10', months: 120, rank: 9 },
    { label: '20Y', id: 'DGS20', months: 240, rank: 10 },
    { label: '30Y', id: 'DGS30', months: 360, rank: 11 }
  ];

  const CURVE_TENORS = TENORS.filter(t => ['1M', '3M', '6M', '1Y', '2Y', '5Y', '7Y', '10Y', '20Y', '30Y'].includes(t.label));
  const MATRIX_TENORS = TENORS.filter(t => ['3M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '20Y', '30Y'].includes(t.label));

  const COLORS = {
    accent: '#6fe7dd',
    accent2: '#9be8ff',
    amber: '#ffc86b',
    coral: '#ff7f86',
    green: '#73e6a8',
    muted: '#7b9295',
    muted2: '#5c7073',
    text: '#e9f5f4'
  };

  const state = {
    data: null,
    calendar: [],
    calendarOk: false,
    lastLoaded: null,
    demo: false,
    curveAgo: 0,
    realYears: 3,
    calRegion: 'US',
    loading: false
  };

  /* ---------------------------------------------------------------------- */
  /* small helpers                                                           */
  /* ---------------------------------------------------------------------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  function fmt(v, dec = 2) {
    if (v == null || !isFinite(v)) return '—';
    return Number(v).toFixed(dec);
  }

  function fmtSigned(v, dec = 2) {
    if (v == null || !isFinite(v)) return '—';
    const s = Math.abs(v).toFixed(dec);
    return (v > 0 ? '+' : v < 0 ? '−' : '') + s;
  }

  function fmtPct(v, dec = 2) {
    if (v == null) return '—';
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dec)}%`;
  }

  function fmtBp(v, dec = 0) {
    if (v == null) return '—';
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dec)}bp`;
  }

  function trimNum(v, dec = 2) {
    if (v == null || !isFinite(v)) return '—';
    return Number(v).toFixed(dec).replace(/\.?0+$/, '');
  }

  function deltaClass(v, invert = false) {
    if (v == null || Math.abs(v) < 1e-9) return 'delta-flat';
    const up = v > 0;
    return (up !== invert) ? 'delta-up' : 'delta-down';
  }

  function arrow(v) {
    if (v == null || Math.abs(v) < 1e-9) return '·';
    return v > 0 ? '↑' : '↓';
  }

  function dateObj(iso) {
    if (!iso) return null;
    const d = new Date(iso + (iso.length <= 10 ? 'T00:00:00' : ''));
    return isFinite(d) ? d : null;
  }

  function fmtDate(iso, opts = { month: 'short', day: '2-digit' }) {
    const d = dateObj(iso);
    return d ? d.toLocaleDateString('en-US', opts) : '—';
  }

  function fmtDay(iso) {
    const d = dateObj(iso);
    if (!d) return '—';
    const today = new Date();
    const key = x => x.toLocaleDateString('en-CA');
    if (key(d) === key(today)) return 'TODAY';
    const tomorrow = new Date(today.getTime() + 86400000);
    if (key(d) === key(tomorrow)) return 'TOMORROW';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' }).toUpperCase();
  }

  function relativeTime(iso) {
    const d = dateObj(iso);
    if (!d) return '—';
    const diff = Date.now() - d.getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }

  /* ---------------------------------------------------------------------- */
  /* series helpers                                                         */
  /* ---------------------------------------------------------------------- */

  const points = id => (state.data && state.data.series && state.data.series[id]) || [];

  function lastPoint(id) {
    const p = points(id);
    return p.length ? p[p.length - 1] : null;
  }

  function lastVal(id) {
    const p = lastPoint(id);
    return p ? p[1] : null;
  }

  function prevVal(id) {
    const p = points(id);
    return p.length > 1 ? p[p.length - 2][1] : null;
  }

  function valueAgo(id, days) {
    const p = points(id);
    if (!p.length) return null;
    const anchor = dateObj(p[p.length - 1][0]).getTime();
    const target = anchor - days * 86400000;
    let lo = 0, hi = p.length - 1, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = dateObj(p[mid][0]).getTime();
      if (t <= target) { best = p[mid][1]; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  }

  function sliceDays(id, days) {
    const p = points(id);
    if (!p.length) return [];
    const anchor = dateObj(p[p.length - 1][0]).getTime();
    const cutoff = anchor - days * 86400000;
    return p.filter(x => dateObj(x[0]).getTime() >= cutoff);
  }

  function changeBp(id, days) {
    const now = lastVal(id);
    const before = days === 1 ? prevVal(id) : valueAgo(id, days);
    if (now == null || before == null) return null;
    return (now - before) * 100;
  }

  function changeAbs(id, days) {
    const now = lastVal(id);
    const before = days === 1 ? prevVal(id) : valueAgo(id, days);
    if (now == null || before == null) return null;
    return now - before;
  }

  function percentile(id, days = 365) {
    const vals = sliceDays(id, days).map(p => p[1]).filter(v => v != null);
    const now = lastVal(id);
    if (!vals.length || now == null) return null;
    const below = vals.filter(v => v <= now).length;
    return (below / vals.length) * 100;
  }

  function sma(id, n) {
    const p = points(id);
    if (p.length < n) return null;
    const slice = p.slice(-n).map(x => x[1]);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  /* ---------------------------------------------------------------------- */
  /* chart engine                                                           */
  /* ---------------------------------------------------------------------- */

  let gradSeq = 0;

  function nearest(pointsArr, targetX, xOf) {
    if (!pointsArr.length) return null;
    let lo = 0, hi = pointsArr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xOf(pointsArr[mid]) < targetX) lo = mid + 1;
      else hi = mid;
    }
    const a = pointsArr[Math.max(0, lo - 1)];
    const b = pointsArr[lo];
    if (!a) return b;
    if (!b) return a;
    return Math.abs(xOf(a) - targetX) <= Math.abs(xOf(b) - targetX) ? a : b;
  }

  function renderChart(el, cfg) {
    if (!el) return;
    const width = Math.max(300, Math.round(el.clientWidth || 600));
    const height = Math.round(el.clientHeight || cfg.height || 260);
    const m = cfg.margins || { l: 44, r: 14, t: 16, b: 25 };
    const innerW = Math.max(10, width - m.l - m.r);
    const innerH = Math.max(10, height - m.t - m.b);

    const datasets = cfg.datasets
      .map(d => ({ ...d, pts: d.points.filter(p => p && p[1] != null) }))
      .filter(d => d.pts.length);

    if (!datasets.length) {
      el.innerHTML = `<div class="chart-empty">Data unavailable</div>`;
      return;
    }

    const xMin = cfg.xType === 'index' ? 0 : Math.min(...datasets.map(d => +xOfTime(d.pts[0])));
    const xMax = cfg.xType === 'index'
      ? Math.max(...datasets.map(d => d.pts.length - 1))
      : Math.max(...datasets.map(d => +xOfTime(d.pts[d.pts.length - 1])));

    const allY = datasets.flatMap(d => d.pts.map(p => p[1]));
    let yMin = Math.min(...allY);
    let yMax = Math.max(...allY);
    if (cfg.includeZero) { yMin = Math.min(yMin, 0); yMax = Math.max(yMax, 0); }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const padY = (yMax - yMin) * (cfg.yPad == null ? 0.12 : cfg.yPad);
    yMin -= padY; yMax += padY;

    const X = v => m.l + ((v - xMin) / (xMax - xMin || 1)) * innerW;
    const Y = v => m.t + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;

    const xOf = (p) => cfg.xType === 'index' ? X(p[0]) : X(+xOfTime(p));
    const keyOf = (p) => cfg.xType === 'index' ? p[0] : +xOfTime(p);
    const xMinKey = cfg.xType === 'index' ? 0 : +xOfTime(datasets[0].pts[0]);
    const xMaxKey = cfg.xType === 'index'
      ? Math.max(...datasets.map(d => d.pts.length - 1))
      : Math.max(...datasets.map(d => +xOfTime(d.pts[d.pts.length - 1])));

    const yTicks = cfg.yTicks || 4;
    const yFmt = cfg.yFmt || (v => fmt(v, 2));
    const xFmt = cfg.xFmt || (v => fmtDate(new Date(v).toISOString().slice(0, 10), { month: 'short', year: '2-digit' }));

    let svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(cfg.label || 'macro chart')}">`;

    // horizontal grid + y labels
    for (let i = 0; i <= yTicks; i++) {
      const t = i / yTicks;
      const v = yMin + (yMax - yMin) * (1 - t);
      const y = m.t + t * innerH;
      svg += `<line class="grid-line" x1="${m.l}" y1="${y.toFixed(1)}" x2="${width - m.r}" y2="${y.toFixed(1)}"/>`;
      svg += `<text class="axis-label" x="${m.l - 7}" y="${(y + 3).toFixed(1)}" text-anchor="end">${esc(yFmt(v))}</text>`;
    }

    // zero line
    if (cfg.includeZero && yMin < 0 && yMax > 0) {
      svg += `<line class="zero-line" x1="${m.l}" y1="${Y(0).toFixed(1)}" x2="${width - m.r}" y2="${Y(0).toFixed(1)}"/>`;
    }

    // x labels
    if (cfg.xType === 'index' && cfg.xLabels) {
      const step = Math.ceil(cfg.xLabels.length / (width < 520 ? 6 : 10));
      cfg.xLabels.forEach((label, i) => {
        if (i % step !== 0 && i !== cfg.xLabels.length - 1) return;
        const x = X(i);
        svg += `<text class="axis-label" x="${x.toFixed(1)}" y="${height - 7}" text-anchor="middle">${esc(label)}</text>`;
      });
    } else {
      const tickN = width < 520 ? 3 : 5;
      for (let i = 0; i <= tickN; i++) {
        const v = xMin + (xMax - xMin) * (i / tickN);
        const x = X(v);
        svg += `<text class="axis-label" x="${x.toFixed(1)}" y="${height - 7}" text-anchor="${i === 0 ? 'start' : i === tickN ? 'end' : 'middle'}">${esc(xFmt(v))}</text>`;
      }
    }

    // areas + lines
    datasets.forEach((d, idx) => {
      const isMain = idx === 0 || d.main;
      if (d.area) {
        const gid = `grad-${++gradSeq}`;
        svg += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${d.color}" stop-opacity="${d.areaOpacity == null ? 0.17 : d.areaOpacity}"/>
          <stop offset="1" stop-color="${d.color}" stop-opacity="0"/>
        </linearGradient></defs>`;
        const base = Y(clamp(0, yMin, yMax));
        let area = '';
        d.pts.forEach((p, i) => {
          area += (i ? 'L' : 'M') + xOf(p).toFixed(1) + ',' + Y(p[1]).toFixed(1);
        });
        area += `L${xOf(d.pts[d.pts.length - 1]).toFixed(1)},${base.toFixed(1)}L${xOf(d.pts[0]).toFixed(1)},${base.toFixed(1)}Z`;
        svg += `<path d="${area}" fill="url(#${gid})" stroke="none"/>`;
      }

      let path = '';
      d.pts.forEach((p, i) => {
        path += (i ? 'L' : 'M') + xOf(p).toFixed(1) + ',' + Y(p[1]).toFixed(1);
      });

      svg += `<path class="line ${isMain ? 'main' : ''} ${d.dashed ? 'dashed' : ''}" d="${path}" stroke="${d.color}" ${d.width ? `stroke-width="${d.width}"` : ''} ${d.opacity ? `opacity="${d.opacity}"` : ''} pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1;animation:drawLine 1.1s cubic-bezier(.22,1,.36,1) forwards;"/>`;

      if (d.endDot !== false) {
        const p = d.pts[d.pts.length - 1];
        svg += `<circle class="dot" cx="${xOf(p).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="3" fill="${d.color}"/>`;
      }
    });

    // end label for primary
    if (cfg.endLabel !== false && datasets[0]) {
      const p = datasets[0].pts[datasets[0].pts.length - 1];
      const x = xOf(p), y = Y(p[1]);
      const anchor = x > width - 60 ? 'end' : 'start';
      svg += `<text class="end-label" x="${(x + (anchor === 'end' ? -7 : 7)).toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="${anchor}" fill="${datasets[0].color}">${esc(cfg.endText != null ? cfg.endText : yFmt(p[1]))}</text>`;
    }

    // hover layer
    svg += `<g class="hover-layer" style="display:none"><line class="crosshair" y1="${m.t}" y2="${height - m.b}"/></g>`;
    datasets.forEach((d, i) => {
      svg += `<circle class="hover-dot" data-ds="${i}" r="3.4" fill="${d.color}" style="display:none"/>`;
    });

    svg += `</svg><div class="chart-tip"></div>`;
    el.innerHTML = svg;

    const svgEl = $('svg', el);
    const tip = $('.chart-tip', el);
    const hoverGroup = $('.hover-layer', el);
    const crosshair = $('.crosshair', hoverGroup);
    const hoverDots = $$('.hover-dot', el);

    const move = (ev) => {
      const rect = svgEl.getBoundingClientRect();
      const px = (ev.clientX - rect.left) / rect.width * width;
      if (px < m.l || px > width - m.r) { leave(); return; }

      let key;
      if (cfg.xType === 'index') {
        key = clamp(Math.round((px - m.l) / innerW * (xMaxKey - xMinKey)), 0, xMaxKey);
      } else {
        key = xMinKey + ((px - m.l) / innerW) * (xMaxKey - xMinKey);
      }

      const rows = [];
      let topY = null;
      datasets.forEach((d, i) => {
        const p = cfg.xType === 'index'
          ? d.pts.find(x => x[0] === key)
          : nearest(d.pts, key, xOfTime);
        if (!p) { hoverDots[i].style.display = 'none'; return; }
        const x = xOf(p), y = Y(p[1]);
        hoverDots[i].setAttribute('cx', x.toFixed(1));
        hoverDots[i].setAttribute('cy', y.toFixed(1));
        hoverDots[i].style.display = '';
        if (topY == null) topY = y;
        rows.push({ name: d.name, color: d.color, value: yFmt(p[1]), raw: p[1] });
      });

      if (!rows.length) { leave(); return; }

      const p0 = cfg.xType === 'index'
        ? datasets[0].pts.find(x => x[0] === key) || datasets[0].pts[0]
        : nearest(datasets[0].pts, key, xOfTime);
      const anchorX = xOf(p0);
      crosshair.setAttribute('x1', anchorX.toFixed(1));
      crosshair.setAttribute('x2', anchorX.toFixed(1));
      hoverGroup.style.display = '';

      const label = cfg.tipTitle
        ? cfg.tipTitle(p0, key)
        : (cfg.xType === 'index' ? (cfg.xLabels ? cfg.xLabels[key] : key) : fmtDate(p0[0], { month: 'short', day: '2-digit', year: 'numeric' }));

      tip.innerHTML = `<span class="tip-date">${esc(label)}</span>` + rows.map(r =>
        `<div class="tip-row"><span><i style="display:inline-block;width:8px;height:2px;background:${r.color};margin-right:6px;vertical-align:2px"></i>${esc(r.name)}</span><b>${esc(r.value)}</b></div>`
      ).join('');

      tip.style.left = clamp(anchorX, 78, width - 78) + 'px';
      tip.style.top = clamp(topY - 8, 40, height) + 'px';
      tip.classList.add('show');
    };

    const leave = () => {
      tip.classList.remove('show');
      hoverGroup.style.display = 'none';
      hoverDots.forEach(d => d.style.display = 'none');
    };

    svgEl.addEventListener('pointermove', move);
    svgEl.addEventListener('pointerleave', leave);
    svgEl.addEventListener('touchstart', (e) => move(e.touches[0]), { passive: true });
    svgEl.addEventListener('touchmove', (e) => move(e.touches[0]), { passive: true });
    svgEl.addEventListener('touchend', leave);

    // expose for resize
    el._redraw = () => renderChart(el, cfg);
  }

  function xOfTime(p) {
    return dateObj(p[0]).getTime();
  }

  function renderSparkline(el, pts, color, opts = {}) {
    if (!el) return;
    const data = (pts || []).filter(p => p && p[1] != null);
    if (data.length < 2) { el.innerHTML = ''; return; }
    const w = 120, h = opts.height || 30;
    const vals = data.map(p => p[1]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { lo -= 1; hi += 1; }
    const X = i => (i / (data.length - 1)) * w;
    const Y = v => h - 2 - ((v - lo) / (hi - lo)) * (h - 5);
    let d = '';
    data.forEach((p, i) => { d += (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(p[1]).toFixed(1); });
    const gid = `sp-${++gradSeq}`;
    const last = data[data.length - 1];
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity="${opts.opacity || 0.22}"/>
        <stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      ${opts.area === false ? '' : `<path d="${d}L${w},${h}L0,${h}Z" fill="url(#${gid})"/>`}
      <path d="${d}" fill="none" stroke="${color}" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${X(data.length - 1).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="1.8" fill="${color}"/>
    </svg>`;
  }

  /* ---------------------------------------------------------------------- */
  /* render: metrics                                                        */
  /* ---------------------------------------------------------------------- */

  function renderMetrics() {
    const host = $('#metricGrid');
    host.innerHTML = METRICS.map((m, i) => {
      const raw = lastVal(m.id);
      const val = raw == null ? null : raw * (m.mul || 1);
      const diff = changeAbs(m.id, 30);
      const diffScaled = diff == null ? null : diff * (m.mul || 1);
      const spark = sliceDays(m.id, 90);
      return `<article class="metric reveal" style="--i:${i}">
        <div class="metric-top">
          <span class="metric-label">${esc(m.label)}</span>
          <span class="metric-tag">${esc(m.tag)}</span>
        </div>
        <div class="metric-value">${fmt(val, m.dec)}${m.unit ? `<span class="unit">${esc(m.unit)}</span>` : ''}</div>
        <div class="metric-delta ${deltaClass(diffScaled)}">
          <span>${arrow(diffScaled)}</span>
          <span>${diffScaled == null ? '—' : (m.unit === 'bp' ? fmtBp(diffScaled, 0) : fmtSigned(diffScaled, m.dec))}</span>
          <span style="color:var(--muted-2)">vs 1M</span>
        </div>
        <div class="metric-spark" data-spark="${i}"></div>
      </article>`;
    }).join('');

    METRICS.forEach((m, i) => {
      const spark = $(`[data-spark="${i}"]`);
      const raw = lastVal(m.id);
      const diff = changeAbs(m.id, 30);
      const color = diff == null ? COLORS.muted : diff >= 0 ? COLORS.accent : COLORS.coral;
      renderSparkline(spark, sliceDays(m.id, 90), color);
      if (raw == null) spark.innerHTML = '';
    });
  }

  /* ---------------------------------------------------------------------- */
  /* render: regime                                                         */
  /* ---------------------------------------------------------------------- */

  function renderRegime() {
    const curve = lastVal('T10Y3M');
    const nfci = lastVal('NFCI');
    const vix = lastVal('VIXCLS');
    const hy = lastVal('BAMLH0A0HYM2');
    const spx = lastVal('SP500');
    const spx200 = sma('SP500', 200);

    const signals = [];

    const curveScore = curve == null ? 0 : curve > 0.5 ? 1 : curve > 0 ? 0 : -1;
    signals.push({
      label: `Curve ${curve == null ? '—' : fmtSigned(curve, 2) + '%'}`,
      state: curveScore > 0 ? 'pos' : curveScore < 0 ? 'neg' : 'neu'
    });

    const nfciScore = nfci == null ? 0 : nfci < -0.1 ? 1 : nfci < 0.25 ? 0 : -1;
    signals.push({
      label: `NFCI ${nfci == null ? '—' : fmtSigned(nfci, 2)}`,
      state: nfciScore > 0 ? 'pos' : nfciScore < 0 ? 'neg' : 'neu'
    });

    const vixScore = vix == null ? 0 : vix < 18 ? 1 : vix < 26 ? 0 : -1;
    signals.push({
      label: `VIX ${vix == null ? '—' : fmt(vix, 1)}`,
      state: vixScore > 0 ? 'pos' : vixScore < 0 ? 'neg' : 'neu'
    });

    const hyScore = hy == null ? 0 : hy < 3.5 ? 1 : hy < 5 ? 0 : -1;
    signals.push({
      label: `HY OAS ${hy == null ? '—' : fmt(hy * 100, 0) + 'bp'}`,
      state: hyScore > 0 ? 'pos' : hyScore < 0 ? 'neg' : 'neu'
    });

    const trendScore = (spx != null && spx200 != null) ? (spx > spx200 ? 1 : -1) : 0;
    signals.push({
      label: `SPX ${spx200 == null ? '—' : (spx > spx200 ? '> 200d' : '< 200d')}`,
      state: trendScore > 0 ? 'pos' : trendScore < 0 ? 'neg' : 'neu'
    });

    const score = curveScore + nfciScore + vixScore + hyScore + trendScore;
    const label = score >= 3 ? 'RISK-ON' : score >= 1 ? 'MILD RISK-ON' : score <= -3 ? 'RISK-OFF' : score <= -1 ? 'DEFENSIVE' : 'NEUTRAL';
    const color = score >= 1 ? COLORS.green : score <= -1 ? COLORS.coral : COLORS.amber;

    $('#regimeLabel').textContent = label;
    $('#regimeLabel').style.color = color;
    $('#regimeScore').textContent = `score ${score > 0 ? '+' : ''}${score.toFixed(0)} / 5`;

    const needle = $('#gaugeNeedle');
    const angle = (score / 5) * 90;
    needle.style.transform = `rotate(${angle}deg)`;
    needle.setAttribute('stroke', color);

    const read = score >= 3
      ? 'Broad risk-on. Curve, credit and volatility are all leaning constructive; crowding is the main risk.'
      : score >= 1
        ? 'Mild risk-on. Conditions are supportive but not uniformly so — watch the laggards in the signal stack.'
        : score <= -3
          ? 'Risk-off. Curve, credit and volatility are flashing stress together; capital preservation comes first.'
          : score <= -1
            ? 'Defensive tilt. At least two macro signals are deteriorating; rallies need confirmation from credit.'
            : 'Mixed regime. Signals disagree, so treat directional conviction with caution and let the data resolve it.';

    $('#regimeRead').textContent = read;
    $('#signalChips').innerHTML = signals.map(s =>
      `<span class="signal-chip ${s.state}"><i></i>${esc(s.label)}</span>`
    ).join('');

    const latest = lastPoint('DGS10');
    $('#regimeUpdated').textContent = latest ? `As of ${fmtDate(latest[0], { month: 'short', day: '2-digit', year: 'numeric' })}` : 'Awaiting data';
  }

  /* ---------------------------------------------------------------------- */
  /* render: curve                                                          */
  /* ---------------------------------------------------------------------- */

  function curveDatasets() {
    const current = CURVE_TENORS.map(t => ({ x: t.rank, y: lastVal(t.id) }));
    const sets = [{
      name: 'Now', color: COLORS.accent2, points: current, main: true, area: true, areaOpacity: 0.1
    }];
    if (state.curveAgo > 0) {
      sets.push({
        name: state.curveAgo === 30 ? '1M ago' : '1Y ago',
        color: COLORS.muted,
        dashed: true,
        area: false,
        points: CURVE_TENORS.map(t => ({ x: t.rank, y: valueAgo(t.id, state.curveAgo) }))
      });
    }
    return sets;
  }

  function renderCurve() {
    const sets = curveDatasets();
    const el = $('#curveChart');
    const labels = CURVE_TENORS.map(t => t.label);
    // map ranked x back to compact index positions
    const rankToIndex = new Map(CURVE_TENORS.map((t, i) => [t.rank, i]));
    sets.forEach(s => s.points = s.points.map(p => ({ 0: rankToIndex.get(p.x), 1: p.y })));
    const indexSets = sets.map(s => ({ ...s, points: s.points }));

    renderChart(el, {
      datasets: indexSets,
      xType: 'index',
      xLabels: labels,
      height: 286,
      label: 'US Treasury yield curve',
      yFmt: v => `${fmt(v, 2)}%`,
      endLabel: false,
      tipTitle: (p, key) => `${labels[key]} tenor`,
      yTicks: 4
    });

    $('#curveLegend').innerHTML = sets.map(s =>
      `<span class="${s.dashed ? 'dash' : ''}"><i style="color:${s.color}"></i>${esc(s.name)}</span>`
    ).join('');

    const s2 = lastVal('DGS2'), s10 = lastVal('DGS10'), s30 = lastVal('DGS30');
    const spread210 = s2 != null && s10 != null ? (s10 - s2) * 100 : null;
    const spread310 = lastVal('T10Y3M') != null ? lastVal('T10Y3M') * 100 : null;
    const belly = lastVal('DGS5');
    const stats = [
      { label: '2s10s', value: spread210 == null ? '—' : fmtBp(spread210, 0), note: spread210 != null && spread210 < 0 ? 'inverted' : 'positive' },
      { label: '3m10y', value: spread310 == null ? '—' : fmtBp(spread310, 0), note: spread310 != null && spread310 < 0 ? 'inverted' : 'positive' },
      { label: '10Y–30Y', value: s10 != null && s30 != null ? fmtBp((s30 - s10) * 100, 0) : '—', note: 'long end' },
      { label: '5Y belly', value: belly == null ? '—' : `${fmt(belly, 2)}%`, note: 'nominal' }
    ];
    $('#curveStats').innerHTML = stats.map(s =>
      `<div class="stat"><span>${esc(s.label)}</span><strong>${esc(s.value)}<em>${esc(s.note)}</em></strong></div>`
    ).join('');

    $('#curveSub').textContent = state.curveAgo === 0
      ? 'Par yields across the curve'
      : `Now vs ${state.curveAgo === 30 ? 'one month' : 'one year'} ago`;
  }

  /* ---------------------------------------------------------------------- */
  /* render: rates matrix                                                   */
  /* ---------------------------------------------------------------------- */

  function renderRates() {
    const body = $('#ratesBody');
    body.innerHTML = MATRIX_TENORS.map(t => {
      const now = lastVal(t.id);
      if (now == null) {
        return `<tr><td>${esc(t.label)}</td><td class="spread">—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`;
      }
      const d1 = changeBp(t.id, 1);
      const d7 = changeBp(t.id, 7);
      const d30 = changeBp(t.id, 30);
      const d365 = changeBp(t.id, 365);
      const cell = v => `<td class="${deltaClass(v)}">${v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(0)}</td>`;
      const inverted = t.label === '2Y' && lastVal('DGS10') != null && lastVal('DGS10') < now;
      return `<tr class="${inverted ? 'inverted' : ''}">
        <td>${esc(t.label)}</td>
        <td class="yield-cell">${fmt(now, 2)}%</td>
        ${cell(d1)}${cell(d7)}${cell(d30)}${cell(d365)}
      </tr>`;
    }).join('');

    const s2 = lastVal('DGS2'), s10 = lastVal('DGS10');
    const spread = s2 != null && s10 != null ? (s10 - s2) * 100 : null;
    const latest = lastPoint('DGS10');
    $('#ratesFoot').innerHTML = `
      <span>2s10s <b style="color:${spread != null && spread < 0 ? COLORS.coral : COLORS.green}">${spread == null ? '—' : fmtBp(spread, 0)}</b></span>
      <span>${latest ? 'As of ' + esc(fmtDate(latest[0], { month: 'short', day: '2-digit' })) : ''}</span>`;
  }

  /* ---------------------------------------------------------------------- */
  /* render: real rates                                                     */
  /* ---------------------------------------------------------------------- */

  function renderReal() {
    const days = state.realYears * 365;
    const sets = [
      { name: '10Y nominal', color: COLORS.muted, points: sliceDays('DGS10', days), dashed: true, endDot: false },
      { name: '10Y real', color: COLORS.accent, points: sliceDays('DFII10', days), main: true, area: true, areaOpacity: 0.09 },
      { name: '10Y breakeven', color: COLORS.amber, points: sliceDays('T10YIE', days), endDot: false }
    ];
    renderChart($('#realChart'), {
      datasets: sets,
      height: 258,
      label: 'Nominal, real and breakeven 10 year yields',
      yFmt: v => `${fmt(v, 1)}%`,
      endLabel: false,
      yTicks: 4
    });

    $('#realLegend').innerHTML = sets.map(s =>
      `<span class="${s.dashed ? 'dash' : ''}"><i style="color:${s.color}"></i>${esc(s.name)}</span>`
    ).join('');

    const nom = lastVal('DGS10');
    const real = lastVal('DFII10');
    const be = lastVal('T10YIE');
    const fwd = lastVal('T5YIFR');
    const pct = (a, b) => (a != null && b) ? clamp(a / b * 100, 0, 100) : 0;

    $('#realDecomp').innerHTML = `
      <div class="decomp-item">
        <span>10Y nominal</span>
        <strong>${nom == null ? '—' : fmt(nom, 2) + '%'}</strong>
        <div class="decomp-bar"><i class="real" style="width:${pct(real, nom)}%"></i><i class="be" style="width:${pct(be, nom)}%"></i></div>
      </div>
      <div class="decomp-item">
        <span>10Y real (TIPS)</span>
        <strong style="color:${COLORS.accent}">${real == null ? '—' : fmt(real, 2) + '%'}</strong>
        <span style="display:block;margin-top:6px;font-size:9px;color:var(--muted)">${changeBp('DFII10', 30) == null ? '' : fmtBp(changeBp('DFII10', 30), 0) + ' / 1M'}</span>
      </div>
      <div class="decomp-item">
        <span>5y5y forward</span>
        <strong style="color:${COLORS.amber}">${fwd == null ? '—' : fmt(fwd, 2) + '%'}</strong>
        <span style="display:block;margin-top:6px;font-size:9px;color:var(--muted)">inflation compensation</span>
      </div>`;
  }

  /* ---------------------------------------------------------------------- */
  /* render: NFCI                                                           */
  /* ---------------------------------------------------------------------- */

  function renderNfci() {
    const pts = sliceDays('NFCI', 365 * 3);
    renderChart($('#nfciChart'), {
      datasets: [{
        name: 'NFCI', color: COLORS.accent, points: pts, main: true, area: true, areaOpacity: 0.12
      }],
      height: 176,
      label: 'Chicago Fed National Financial Conditions Index',
      yFmt: v => fmtSigned(v, 1),
      includeZero: true,
      yTicks: 3,
      endLabel: false
    });

    const comps = [
      { label: 'Overall', id: 'NFCI' },
      { label: 'Leverage', id: 'NFCILEVERAGE' },
      { label: 'Credit', id: 'NFCICREDIT' },
      { label: 'Risk', id: 'NFCIRISK' }
    ];
    const maxAbs = 1.6;
    $('#nfciComponents').innerHTML = comps.map(c => {
      const v = lastVal(c.id);
      if (v == null) return '';
      const w = clamp(Math.abs(v) / maxAbs, 0, 1) * 50;
      const positive = v >= 0;
      const style = positive
        ? `left:50%;width:${w}%;background:linear-gradient(90deg,rgba(255,127,134,.55),${COLORS.coral})`
        : `right:50%;width:${w}%;background:linear-gradient(90deg,${COLORS.green},rgba(115,230,168,.55))`;
      return `<div class="nfci-row">
        <span>${esc(c.label)}</span>
        <div class="bar-track"><span class="bar-fill" style="${style}"></span></div>
        <b class="${positive ? 'tight' : 'loose'}">${fmtSigned(v, 2)}</b>
      </div>`;
    }).join('');

    const overall = lastVal('NFCI');
    $('#nfciNote').textContent = overall == null ? '0 = average' : (overall < 0 ? 'loose vs average' : 'tight vs average');
    $('#nfciNote').style.color = overall == null ? '' : overall < 0 ? COLORS.green : COLORS.coral;
  }

  /* ---------------------------------------------------------------------- */
  /* render: volatility                                                     */
  /* ---------------------------------------------------------------------- */

  function renderVol() {
    const vix = lastVal('VIXCLS');
    const d1 = changeAbs('VIXCLS', 1);
    $('#vixValue').textContent = vix == null ? '—' : fmt(vix, 2);
    $('#vixDelta').innerHTML = d1 == null ? '—' : `<span class="${deltaClass(d1, true)}">${arrow(d1)} ${fmtSigned(d1, 2)}</span> <span style="color:var(--muted-2)">1D</span>`;

    const pct = percentile('VIXCLS', 365);
    $('#vixPct').textContent = pct == null ? '—' : `${pct.toFixed(0)}%`;
    $('#vixMeter').style.left = pct == null ? '50%' : `${clamp(pct, 1, 99)}%`;

    const tag = vix == null ? { t: '—', c: '' }
      : vix < 15 ? { t: 'CALM', c: 'calm' }
      : vix < 20 ? { t: 'NORMAL', c: 'normal' }
      : vix < 28 ? { t: 'ELEVATED', c: 'elevated' }
      : { t: 'STRESSED', c: 'stressed' };
    const tagEl = $('#volTag');
    tagEl.textContent = tag.t;
    tagEl.className = `regime-tag ${tag.c}`;

    renderChart($('#vixChart'), {
      datasets: [{
        name: 'VIX', color: vix != null && vix > 25 ? COLORS.coral : COLORS.accent2, points: sliceDays('VIXCLS', 365), main: true, area: true, areaOpacity: 0.12
      }],
      height: 150,
      label: 'VIX one year',
      yFmt: v => fmt(v, 0),
      yTicks: 3,
      endLabel: true,
      margins: { l: 32, r: 40, t: 12, b: 22 }
    });

    const hy = lastVal('BAMLH0A0HYM2');
    const hyPct = percentile('BAMLH0A0HYM2', 365);
    const vals = sliceDays('VIXCLS', 365).map(p => p[1]);
    const lo = vals.length ? Math.min(...vals) : null;
    const hi = vals.length ? Math.max(...vals) : null;

    $('#volMini').innerHTML = `
      <div class="mini-stat"><span>HY OAS</span><strong>${hy == null ? '—' : fmt(hy * 100, 0) + 'bp'}<em style="font-style:normal;color:var(--muted-2);font-size:9px;margin-left:6px">${hyPct == null ? '' : hyPct.toFixed(0) + 'th pct'}</em></strong></div>
      <div class="mini-stat"><span>VIX 1Y range</span><strong>${lo == null ? '—' : fmt(lo, 1) + ' – ' + fmt(hi, 1)}</strong></div>`;
  }

  /* ---------------------------------------------------------------------- */
  /* render: policy                                                         */
  /* ---------------------------------------------------------------------- */

  function renderPolicy() {
    const effr = lastVal('EFFR');
    const sofr = lastVal('SOFR');
    const iorb = lastVal('IORB');
    const upper = lastVal('DFEDTARU');
    const lower = lastVal('DFEDTARL');
    const be = lastVal('T10YIE');
    const realPolicy = effr != null && be != null ? effr - be : null;

    $('#policyNote').textContent = realPolicy == null ? '—' : `real policy ${fmtSigned(realPolicy, 2)}%`;
    $('#policyNote').style.color = realPolicy == null ? '' : realPolicy > 0 ? COLORS.coral : COLORS.green;

    const items = [
      { label: 'EFFR', value: effr, tag: 'o/n', sub: 'effective fed funds', color: COLORS.text },
      { label: 'SOFR', value: sofr, tag: 'o/n', sub: 'secured overnight', color: COLORS.text },
      { label: 'IORB', value: iorb, tag: 'admin', sub: 'reserve balances', color: COLORS.text },
      {
        label: 'Target range',
        value: (lower != null && upper != null) ? `${trimNum(lower)}–${trimNum(upper)}%` : null,
        tag: 'band',
        sub: 'FOMC band',
        color: COLORS.accent,
        raw: true
      }
    ];
    $('#policyGrid').innerHTML = items.map(it => `
      <div class="policy-item">
        <div class="p-label"><span>${esc(it.label)}</span><span>${esc(it.tag)}</span></div>
        <div class="p-value" style="color:${it.color}">${it.value == null ? '—' : (it.raw ? esc(it.value) : fmt(it.value, 2) + '%')}</div>
        <div class="p-sub">${esc(it.sub)}</div>
      </div>`).join('');

    const walcl = lastVal('WALCL');
    const walcl13 = valueAgo('WALCL', 91);
    const walclDelta = walcl != null && walcl13 != null ? (walcl - walcl13) / 1000000 : null; // $M -> $T
    $('#walclValue').textContent = walcl == null ? '—' : `$${fmt(walcl / 1000000, 2)}T`;
    $('#walclSub').textContent = walclDelta == null ? '' : `${walclDelta > 0 ? '+' : '−'}$${Math.abs(walclDelta).toFixed(2)}T / 13w`;
    renderSparkline($('#walclSpark'), sliceDays('WALCL', 365 * 2), COLORS.accent);

    const rrp = lastVal('RRPONTSYD');
    const rrp4 = valueAgo('RRPONTSYD', 28);
    const rrpDelta = rrp != null && rrp4 != null ? rrp - rrp4 : null;
    $('#rrpValue').textContent = rrp == null ? '—' : `$${fmt(rrp, 1)}B`;
    $('#rrpSub').textContent = rrpDelta == null ? '' : `${rrpDelta > 0 ? '+' : '−'}$${Math.abs(rrpDelta).toFixed(0)}B / 4w`;
    renderSparkline($('#rrpSpark'), sliceDays('RRPONTSYD', 365), COLORS.amber);
  }

  /* ---------------------------------------------------------------------- */
  /* render: macro sentiment                                                */
  /* ---------------------------------------------------------------------- */

  function sentimentInputs() {
    const vix = lastVal('VIXCLS');
    const vixCh = changeAbs('VIXCLS', 30);
    const hy = lastVal('BAMLH0A0HYM2');
    const hyCh = changeBp('BAMLH0A0HYM2', 30);
    const nfci = lastVal('NFCI');
    const nfciCh = changeAbs('NFCI', 30);
    const real10 = lastVal('DFII10');
    const realCh = changeBp('DFII10', 30);
    const curve = lastVal('T10Y2Y');
    const spx = lastVal('SP500');
    const spx200 = sma('SP500', 200);
    const walcl = lastVal('WALCL');
    const walcl13 = valueAgo('WALCL', 91);
    const walclCh = walcl != null && walcl13 != null ? (walcl - walcl13) / 1000000 : null; // $T / 13w
    const rrp = lastVal('RRPONTSYD');
    const rrp4 = valueAgo('RRPONTSYD', 28);
    const rrpCh = rrp != null && rrp4 != null ? rrp - rrp4 : null; // $B / 4w
    const effrCh = changeBp('EFFR', 365);

    const s = {};
    s.vixLevel = vix == null ? 0 : vix < 14 ? 1 : vix < 17 ? 0.65 : vix < 20 ? 0.25 : vix < 24 ? -0.25 : vix < 30 ? -0.7 : -1;
    s.vixTrend = vixCh == null ? 0 : vixCh < -2 ? 0.6 : vixCh < -0.5 ? 0.3 : vixCh < 0.5 ? 0 : vixCh < 2 ? -0.3 : -0.6;
    s.hyLevel = hy == null ? 0 : hy < 3 ? 1 : hy < 3.75 ? 0.55 : hy < 4.5 ? 0 : hy < 5.5 ? -0.6 : -1;
    s.hyTrend = hyCh == null ? 0 : hyCh < -20 ? 0.6 : hyCh < -5 ? 0.3 : hyCh < 5 ? 0 : hyCh < 20 ? -0.3 : -0.6;
    s.nfciLevel = nfci == null ? 0 : nfci < -0.4 ? 1 : nfci < -0.1 ? 0.55 : nfci < 0.2 ? 0 : nfci < 0.6 ? -0.6 : -1;
    s.nfciTrend = nfciCh == null ? 0 : nfciCh < -0.1 ? 0.5 : nfciCh < -0.02 ? 0.2 : nfciCh < 0.02 ? 0 : nfciCh < 0.1 ? -0.25 : -0.5;
    s.realLevel = real10 == null ? 0 : real10 < 0.5 ? 1 : real10 < 1.25 ? 0.5 : real10 < 1.9 ? 0 : real10 < 2.5 ? -0.55 : -1;
    s.realTrend = realCh == null ? 0 : realCh < -15 ? 0.55 : realCh < -3 ? 0.25 : realCh < 3 ? 0 : realCh < 15 ? -0.3 : -0.6;
    s.curveLevel = curve == null ? 0 : curve > 0.75 ? 1 : curve > 0.25 ? 0.55 : curve > -0.1 ? 0 : curve > -0.5 ? -0.55 : -1;
    s.trend = (spx != null && spx200 != null) ? (spx > spx200 ? 1 : -1) : 0;
    s.policyDir = effrCh == null ? 0 : effrCh < -50 ? 1 : effrCh < -10 ? 0.5 : effrCh < 10 ? 0 : effrCh < 50 ? -0.5 : -1;

    let liq = 0, liqParts = 0;
    if (walclCh != null) {
      liq += walclCh > 0.01 ? 0.75 : walclCh < -0.01 ? -0.75 : 0;
      liqParts++;
    }
    if (rrpCh != null) {
      liq += rrpCh < -20 ? 0.65 : rrpCh < 0 ? 0.25 : rrpCh > 20 ? -0.65 : -0.25;
      liqParts++;
    }
    s.liq = liqParts ? liq / liqParts : 0;

    return {
      vix, vixCh, hy, hyCh, nfci, nfciCh, real10, realCh, curve,
      spx, spx200, walclCh, rrp, rrpCh, effrCh, s
    };
  }

  const SENTIMENT_PROFILES = {
    ndq: {
      intraday: [['vixLevel', 1.1], ['vixTrend', 0.8], ['hyLevel', 0.9], ['hyTrend', 0.6], ['nfciLevel', 0.6], ['nfciTrend', 0.3], ['liq', 0.4], ['curveLevel', 0.2]],
      daily: [['trend', 1.1], ['hyLevel', 1.0], ['hyTrend', 0.6], ['nfciLevel', 0.8], ['nfciTrend', 0.4], ['realLevel', 1.0], ['realTrend', 0.5], ['vixLevel', 0.5], ['liq', 0.4]],
      long: [['realLevel', 1.2], ['realTrend', 0.5], ['curveLevel', 1.0], ['nfciLevel', 0.8], ['nfciTrend', 0.4], ['liq', 0.7], ['policyDir', 0.6]]
    },
    btc: {
      intraday: [['vixLevel', 1.0], ['vixTrend', 0.7], ['hyLevel', 1.0], ['hyTrend', 0.7], ['nfciLevel', 0.8], ['nfciTrend', 0.4], ['liq', 0.9], ['curveLevel', 0.15]],
      daily: [['trend', 0.9], ['hyLevel', 1.0], ['hyTrend', 0.6], ['nfciLevel', 0.9], ['nfciTrend', 0.5], ['realLevel', 1.0], ['realTrend', 0.5], ['vixLevel', 0.6], ['liq', 0.9]],
      long: [['realLevel', 1.2], ['realTrend', 0.5], ['curveLevel', 0.6], ['nfciLevel', 1.0], ['nfciTrend', 0.4], ['liq', 1.3], ['policyDir', 0.7]]
    }
  };

  function horizonScore(profile, s) {
    let sum = 0, wsum = 0;
    profile.forEach(([key, w]) => {
      const v = s[key];
      if (v == null) return;
      sum += v * w;
      wsum += w;
    });
    return wsum ? (sum / wsum) * 5 : null;
  }

  function sentimentBias(score) {
    if (score == null) return { label: 'NO DATA', cls: 'neutral' };
    if (score >= 2.5) return { label: 'BULLISH', cls: 'bull' };
    if (score >= 0.8) return { label: 'LEAN BULLISH', cls: 'bull' };
    if (score <= -2.5) return { label: 'BEARISH', cls: 'bear' };
    if (score <= -0.8) return { label: 'LEAN BEARISH', cls: 'bear' };
    return { label: 'NEUTRAL', cls: 'neutral' };
  }

  function sentimentRead(asset, daily, long, x) {
    const name = asset === 'btc' ? 'Bitcoin' : 'Nasdaq';
    const base = label => label.replace('LEAN ', '');
    const key = `${base(daily)}/${base(long)}`;
    const map = {
      'BULLISH/BULLISH': 'macro is a tailwind across horizons — conditions, credit and trend are aligned.',
      'BULLISH/NEUTRAL': 'near-term support, but the longer-term backdrop is mixed.',
      'BULLISH/BEARISH': 'near-term strength inside a restrictive longer-term regime; treat it as tactical.',
      'NEUTRAL/BULLISH': 'choppy near term but constructive longer term; patience beats chasing.',
      'NEUTRAL/NEUTRAL': 'no clear macro edge — let volatility and credit resolve the range.',
      'NEUTRAL/BEARISH': 'range-bound near term with a longer-term headwind.',
      'BEARISH/BULLISH': 'near-term pressure inside a still-supportive long-term regime.',
      'BEARISH/NEUTRAL': 'near-term stress without a full long-term breakdown.',
      'BEARISH/BEARISH': 'macro headwinds dominate; capital preservation comes first.'
    };
    let text = `${name}: ${map[key] || 'mixed signals; let the data resolve direction.'}`;
    if (asset === 'btc' && x.s.liq < -0.1) text += ' Liquidity is the swing factor.';
    else if (asset === 'btc' && x.s.liq > 0.1) text += ' Liquidity is the swing support.';
    else if (asset !== 'btc' && x.real10 != null && x.real10 >= 1.9) text += ' Real yields cap the upside.';
    return text;
  }

  function buildMacroBrief(x, net) {
    const parts = [];

    if (x.real10 != null) {
      parts.push(
        x.real10 >= 1.9
          ? `10Y real yields at ${fmt(x.real10, 2)}% remain the brake on duration`
          : x.real10 >= 1.25
            ? `10Y real yields at ${fmt(x.real10, 2)}% are only mildly restrictive`
            : `10Y real yields at ${fmt(x.real10, 2)}% are a tailwind`
      );
    }

    const cond = [];
    if (x.nfci != null) cond.push(`${x.nfci < 0 ? 'loose' : 'tight'} conditions (NFCI ${fmtSigned(x.nfci, 2)})`);
    if (x.hy != null) cond.push(`${x.hy < 4 ? 'tight' : 'wide'} credit (HY OAS ${Math.round(x.hy * 100)}bp)`);
    if (cond.length) {
      const supportive = x.nfci != null && x.nfci < 0 && x.hy != null && x.hy < 4;
      parts.push(`${cond.join(' and ')} ${supportive ? 'keep risk appetite intact' : 'are adding friction'}`);
    }

    if (x.vix != null) {
      parts.push(`VIX ${fmt(x.vix, 1)} is ${x.vix < 20 ? 'calm' : x.vix < 28 ? 'elevated' : 'stressed'}`);
    }

    const lead = parts.slice(0, 3);
    const sentence = lead.length
      ? (lead.length > 1 ? `${lead[0]} — ${lead.slice(1).join(', ')}` : lead[0])
      : 'Macro data is still loading';

    const verdict = net == null
      ? 'Net: waiting on enough data to score.'
      : net >= 1.5
        ? 'Net: risk-on, with dips more likely to be bought.'
        : net >= 0.5
          ? 'Net: mildly constructive, but not a clean risk-on.'
          : net <= -1.5
            ? 'Net: risk-off; capital preservation first.'
            : net <= -0.5
              ? 'Net: mildly defensive; rallies need confirmation.'
              : 'Net: mixed, with no clear macro edge.';

    return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}. ${verdict}`;
  }

  function sentimentDrivers(asset, x) {
    const out = [];
    const add = (text, w) => { if (text) out.push({ text, w }); };
    const s = x.s;
    const btc = asset === 'btc';

    if (x.vix != null) {
      const mood = x.vix < 17 ? 'calm' : x.vix < 22 ? 'contained' : x.vix < 28 ? 'elevated' : 'stressed';
      add(`VIX ${fmt(x.vix, 1)} — ${mood} volatility ${x.vix < 20 ? 'supports' : 'weighs on'} risk appetite`, s.vixLevel * 1.0);
    }
    if (x.vixCh != null && Math.abs(x.vixCh) >= 0.3) {
      add(`VIX ${x.vixCh < 0 ? 'down' : 'up'} ${Math.abs(x.vixCh).toFixed(1)} pts over 1M — volatility ${x.vixCh < 0 ? 'cooling' : 'building'}`, s.vixTrend * 0.7);
    }
    if (x.hy != null) {
      const bp = Math.round(x.hy * 100);
      add(`HY OAS ${bp}bp — ${x.hy < 3.5 ? 'tight' : x.hy < 4.5 ? 'normal' : 'wide'} credit spreads ${x.hy < 4 ? 'support' : 'pressure'} risk assets`, s.hyLevel * 0.9);
    }
    if (x.hyCh != null && Math.abs(x.hyCh) >= 3) {
      add(`Credit spreads ${x.hyCh < 0 ? 'tightened' : 'widened'} ${Math.round(Math.abs(x.hyCh))}bp over 1M — ${x.hyCh < 0 ? 'tailwind' : 'headwind'}`, s.hyTrend * 0.7);
    }
    if (x.nfci != null) {
      add(`NFCI ${fmtSigned(x.nfci, 2)} — ${x.nfci < 0 ? 'loose' : 'tight'} financial conditions ${x.nfci < 0 ? 'support' : 'restrict'} risk-taking`, s.nfciLevel * 0.7);
    }
    if (x.nfciCh != null && Math.abs(x.nfciCh) >= 0.02) {
      add(`Conditions ${x.nfciCh < 0 ? 'loosened' : 'tightened'} ${Math.abs(x.nfciCh).toFixed(2)} over 1M`, s.nfciTrend * 0.35);
    }
    if (x.real10 != null) {
      add(`10Y real yield ${fmt(x.real10, 2)}% — ${x.real10 < 1.5 ? 'supportive' : 'restrictive'} for ${btc ? 'liquidity-driven assets' : 'duration-sensitive equities'}`, s.realLevel * (btc ? 1.0 : 1.1));
    }
    if (x.realCh != null && Math.abs(x.realCh) >= 3) {
      add(`Real yields ${x.realCh < 0 ? 'fell' : 'rose'} ${Math.round(Math.abs(x.realCh))}bp over 1M — ${x.realCh < 0 ? 'a tailwind' : 'a headwind'} for ${btc ? 'BTC' : 'growth multiples'}`, s.realTrend * 0.5);
    }
    if (x.curve != null) {
      add(`2s10s ${fmtBp(x.curve * 100, 0)} — ${x.curve > 0 ? 'positively sloped' : 'inverted'} curve ${x.curve > 0.25 ? 'supports' : 'signals'} ${x.curve > 0.25 ? 'the cycle' : 'restrictive policy'}`, s.curveLevel * 0.6);
    }
    if (x.spx200 != null) {
      add(`S&P 500 ${x.spx > x.spx200 ? 'above' : 'below'} its 200-day average — ${x.spx > x.spx200 ? 'uptrend intact' : 'trend broken'}`, s.trend * 0.9);
    }
    if (x.walclCh != null) {
      add(`Fed balance sheet ${x.walclCh > 0 ? '+' : '−'}$${Math.abs(x.walclCh).toFixed(2)}T over 13w — liquidity ${x.walclCh > 0 ? 'expanding' : 'contracting'}`, s.liq * 0.7);
    }
    if (x.rrpCh != null) {
      add(`RRP ${x.rrpCh > 0 ? '+' : '−'}$${Math.abs(x.rrpCh).toFixed(0)}B over 4w — ${x.rrpCh < 0 ? 'less draining' : 'more draining'} of reserves`, s.liq * 0.5);
    }
    if (x.effrCh != null && Math.abs(x.effrCh) >= 10) {
      add(`Fed funds ${x.effrCh < 0 ? 'down' : 'up'} ${Math.round(Math.abs(x.effrCh))}bp YoY — policy ${x.effrCh < 0 ? 'easing' : 'tightening'}`, s.policyDir * 0.6);
    }

    out.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
    const top = out.slice(0, 4).map(d => ({
      ...d,
      cls: d.w > 0.12 ? 'pos' : d.w < -0.12 ? 'neg' : 'neu'
    }));

    top.push({
      text: btc
        ? 'Liquidity lens: BTC usually needs loose conditions and falling real yields to trend, and de-rates fastest when those reverse.'
        : 'Duration lens: growth multiples are most sensitive to real yields and the shape of the curve.',
      w: 0,
      cls: 'neu'
    });
    return top;
  }

  function renderSentiment() {
    if (!state.data) return;
    const x = sentimentInputs();
    const s = x.s;

    const ids = {
      ndq: { intraday: '#sentNdqIntraday', daily: '#sentNdqDaily', long: '#sentNdqLong', read: '#sentNdqRead', explain: '#sentNdqExplain', score: '#sentNdqScore' },
      btc: { intraday: '#sentBtcIntraday', daily: '#sentBtcDaily', long: '#sentBtcLong', read: '#sentBtcRead', explain: '#sentBtcExplain', score: '#sentBtcScore' }
    };

    const scores = {};
    ['ndq', 'btc'].forEach(asset => {
      const profile = SENTIMENT_PROFILES[asset];
      const intra = horizonScore(profile.intraday, s);
      const daily = horizonScore(profile.daily, s);
      const long = horizonScore(profile.long, s);
      scores[asset] = { intra, daily, long };
      const bi = sentimentBias(intra);
      const bd = sentimentBias(daily);
      const bl = sentimentBias(long);
      const net = intra != null && daily != null && long != null ? (intra + daily + long) / 3 : null;
      const el = ids[asset];

      const setPill = (sel, bias, score) => {
        const node = $(sel);
        if (!node) return;
        node.textContent = bias.label;
        node.className = `sentiment-pill ${bias.cls}`;
        node.dataset.score = score == null ? '' : score.toFixed(2);
        node.title = score == null ? 'Model score unavailable' : `Model score ${fmtSigned(score, 2)} on a −5 to +5 scale`;
      };
      setPill(el.intraday, bi, intra);
      setPill(el.daily, bd, daily);
      setPill(el.long, bl, long);

      const scoreEl = $(el.score);
      if (scoreEl) {
        scoreEl.textContent = net == null ? 'NET —' : `NET ${fmtSigned(net, 1)}`;
        const color = net == null ? COLORS.muted : net >= 1.5 ? COLORS.green : net <= -1.5 ? COLORS.coral : COLORS.amber;
        scoreEl.style.color = color;
        scoreEl.style.borderColor = net == null ? '' : `${color}55`;
      }

      $(el.read).textContent = sentimentRead(asset, bd.label, bl.label, x);

      $(el.explain).innerHTML = sentimentDrivers(asset, x).map(d =>
        `<li class="${d.cls}">${esc(d.text)}</li>`
      ).join('');
    });

    const all = ['ndq', 'btc'].flatMap(a => ['intra', 'daily', 'long'].map(k => scores[a][k])).filter(v => v != null);
    const composite = all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;

    const brief = $('#briefText');
    if (brief) brief.textContent = buildMacroBrief(x, composite);

    const meta = $('#briefMeta');
    if (meta) {
      const asOf = lastPoint('DGS10');
      const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
      meta.textContent = `GENERATED ${time} UTC${asOf ? ' · DATA ' + fmtDate(asOf[0], { month: 'short', day: '2-digit' }).toUpperCase() : ''}`;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* render: calendar                                                       */
  /* ---------------------------------------------------------------------- */

  function calendarEvents() {
    let evs = (state.calendar || []).slice();
    if (state.calRegion === 'US') evs = evs.filter(e => e.country === 'USD');
    evs = evs.filter(e => e.impact !== 'Holiday');
    const weight = { High: 0, Medium: 1, Low: 2 };
    evs.sort((a, b) => {
      const d = new Date(a.date) - new Date(b.date);
      if (d !== 0) return d;
      return (weight[a.impact] ?? 3) - (weight[b.impact] ?? 3);
    });
    return evs;
  }

  function renderCalendar() {
    const host = $('#calList');
    const evs = calendarEvents();

    if (!state.calendarOk || !evs.length) {
      host.innerHTML = `<div class="cal-empty">
        <strong>Calendar feed unavailable.</strong>
        <span>The weekly release feed could not be reached. Macro panels above are unaffected.</span>
      </div>`;
      $('#nextEventTitle').textContent = '—';
      $('#nextEventWhen').textContent = '—';
      $('#nextEventCountdown').textContent = '—';
      const src = $('#calSource');
      if (src) src.textContent = 'THIS WEEK';
      return;
    }

    // group by local day
    const groups = new Map();
    evs.forEach(e => {
      const d = new Date(e.date);
      const key = d.toLocaleDateString('en-CA');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });

    const cap = state.calRegion === 'ALL' ? 40 : 18;
    let html = '';
    let count = 0;
    for (const [day, list] of groups) {
      if (count >= cap) break;
      html += `<div class="cal-day">${esc(fmtDay(day))}</div>`;
      for (const e of list) {
        if (count >= cap) break;
        count++;
        const t = new Date(e.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const actual = e.actual ? `<b>Actual</b>${esc(e.actual)}` : `<b>Previous</b>${esc(e.previous || '—')}`;
        html += `<div class="cal-event ${e.country === 'USD' ? 'US' : ''}">
          <span class="cal-time">${esc(t)}</span>
          <span class="cal-country">${esc(e.country || '—')}</span>
          <i class="dot ${e.impact.toLowerCase()}"></i>
          <span class="cal-title" title="${esc(e.title)}">${esc(e.title)}</span>
          <span class="cal-fig"><b>Forecast</b>${esc(e.forecast || '—')}</span>
          <span class="cal-fig">${actual}</span>
        </div>`;
      }
    }
    host.innerHTML = html || `<div class="cal-empty"><strong>No events match this filter.</strong></div>`;

    const src = $('#calSource');
    if (src) src.textContent = count < evs.length ? `THIS WEEK · ${count}/${evs.length}` : `THIS WEEK · ${evs.length}`;

    const now = Date.now();
    const next = evs.find(e => e.country === 'USD' && e.impact === 'High' && new Date(e.date).getTime() > now)
      || evs.find(e => new Date(e.date).getTime() > now);

    if (next) {
      $('#nextEventTitle').textContent = next.title;
      const d = new Date(next.date);
      $('#nextEventWhen').textContent = `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: '2-digit' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${next.country}`;
      updateCountdown(next.date);
      state._nextEvent = next.date;
    } else {
      $('#nextEventTitle').textContent = 'No upcoming event';
      $('#nextEventWhen').textContent = '—';
      $('#nextEventCountdown').textContent = '—';
      state._nextEvent = null;
    }
  }

  function updateCountdown(iso) {
    const el = $('#nextEventCountdown');
    if (!iso) { el.textContent = '—'; return; }
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) { el.textContent = 'RELEASED'; return; }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.textContent = d > 0
      ? `T−${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`
      : `T−${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /* ---------------------------------------------------------------------- */
  /* clock                                                                  */
  /* ---------------------------------------------------------------------- */

  function tickClock() {
    const now = new Date();
    const day = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', timeZone: 'America/New_York' }).toUpperCase();
    const time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' });
    $('#clockDay').textContent = day;
    $('#clockTime').textContent = time;
    if (state._nextEvent) updateCountdown(state._nextEvent);
  }

  /* ---------------------------------------------------------------------- */
  /* agent: gemini macro agent                                              */
  /* ---------------------------------------------------------------------- */

  let agentHistory = [];
  let agentGreetingBound = false;

  function setAgentOpen(open) {
    const panel = $('#agentPanel');
    const bubble = $('#agentBubble');
    if (!panel) return;
    if (open) {
      panel.hidden = false;
      const inp = $('#agentInput');
      if (inp) {
        setTimeout(() => { inp.focus(); }, 60);
      }
      if (bubble) bubble.setAttribute('aria-expanded', 'true');
    } else {
      panel.hidden = true;
      if (bubble) bubble.setAttribute('aria-expanded', 'false');
    }
  }

  function setAgentState(mode) {
    const el = $('#agentState');
    const t = $('#agentStateText');
    const online = mode === 'gemini';
    if (el) el.className = `agent-state ${online ? 'online' : 'local'}`;
    if (t) t.textContent = online ? 'GEMINI · ONLINE' : 'LOCAL MODE';
  }

  function agentContext() {
    const ctx = { brief: '', sentiment: { ndq: {}, btc: {} }, metrics: {} };
    const briefEl = $('#briefText');
    if (briefEl) ctx.brief = briefEl.textContent || '';
    const readPill = sel => { const el = $(sel); return el ? String(el.textContent || '') : ''; };
    ctx.sentiment.ndq = { intraday: readPill('#sentNdqIntraday'), daily: readPill('#sentNdqDaily'), long: readPill('#sentNdqLong'), net: readPill('#sentNdqScore') };
    ctx.sentiment.btc = { intraday: readPill('#sentBtcIntraday'), daily: readPill('#sentBtcDaily'), long: readPill('#sentBtcLong'), net: readPill('#sentBtcScore') };
    ctx.metrics = {
      dgs10: lastVal('DGS10'),
      dgs2: lastVal('DGS2'),
      curve2s10s: lastVal('T10Y2Y'),
      real10: lastVal('DFII10'),
      breakeven10: lastVal('T10YIE'),
      nfci: lastVal('NFCI'),
      vix: lastVal('VIXCLS'),
      hyOasBp: lastVal('BAMLH0A0HYM2') == null ? null : Math.round(lastVal('BAMLH0A0HYM2') * 100),
      spx: lastVal('SP500')
    };
    const regimeRead = document.querySelector('#regimeRead');
    ctx.regime = regimeRead ? regimeRead.textContent : null;
    return ctx;
  }

  function agentAppend(role, text) {
    const log = $('#agentLog');
    if (!log) return null;
    const el = document.createElement('div');
    el.className = `agent-msg ${role}`;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  async function askAgent(message) {
    const text = String(message || '').trim();
    if (!text) return;
    const send = $('#agentSend');
    if (send) send.disabled = true;
    agentAppend('user', text);
    const botEl = agentAppend('bot', '');
    botEl.classList.add('thinking');
    agentHistory.push({ role: 'user', content: text });
    if (agentHistory.length > 10) agentHistory.shift();

    const ctx = agentContext();
    let data = null;
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, context: ctx })
      });
      data = await res.json();
    } catch (err) {
      data = null;
    }

    botEl.classList.remove('thinking');
    let reply = (data && data.reply) || 'The macro agent could not answer right now. Try again in a moment.';
    let ok = !!(data && data.ok);

    if (ok) {
      botEl.textContent = reply;
      const foot = $('#agentFoot');
      if (foot) foot.textContent = data.mode === 'gemini'
        ? `GEMINI · ${data.model || 'FLASH'} · LIVE DASHBOARD CONTEXT · NOT INVESTMENT ADVICE`
        : `LOCAL FALLBACK · SET GEMINI_API_KEY FOR LIVE GEMINI · NOT INVESTMENT ADVICE`;
      setAgentState(data.mode);
    } else {
      botEl.textContent = reply;
      botEl.classList.add('error');
    }

    agentHistory.push({ role: 'model', content: reply });
    if (agentHistory.length > 10) agentHistory.shift();

    if (send) send.disabled = false;
    const input = $('#agentInput');
    if (input) { input.value = ''; setTimeout(() => input.focus(), 30); }
    return ok;
  }

  function initAgent() {
    const panel = $('#agentPanel');
    const bubble = $('#agentBubble');
    const form = $('#agentForm');
    const input = $('#agentInput');
    const close = $('#agentClose');

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        askAgent(input ? input.value : '');
      });
    }
    if (bubble) bubble.addEventListener('click', () => setAgentOpen(true));
    if (close) close.addEventListener('click', () => setAgentOpen(false));
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setAgentOpen(false);
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setAgentOpen(false);
    });

    const chipsWrap = document.querySelector('.agent-chips');
    if (chipsWrap) {
      chipsWrap.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-q]');
        if (btn) askAgent(btn.dataset.q);
      });
    }

    const log = $('#agentLog');
    const first = log ? log.querySelector('.agent-msg') : null;
    if (first) {
      first.textContent = "I'm Gemini, your macro copilot inside Volume Society Macro Space. I read the live dashboard — yields, curve, real rates, conditions, credit, volatility and the Nasdaq/BTC bias. What do you want to unpack?";
    }

    fetchJSON('/api/agent').then((d) => setAgentState(d && d.mode)).catch(() => setAgentState('local'));
  }

  /* ---------------------------------------------------------------------- */
  /* load                                                                   */
  /* ---------------------------------------------------------------------- */

  async function fetchJSON(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  }

  function setFeed(status, text) {
    const el = $('#feedStatus');
    el.className = `feed-status ${status}`;
    $('#feedStatusText').textContent = text;
  }

  function toast(msg, kind = '') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast show ${kind}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function applyProviders(payload) {
    const summary = $('#providerSummary');
    if (!payload || !payload.ok) {
      if (summary) summary.textContent = 'STATUS UNAVAILABLE';
      return;
    }

    Object.entries(payload.providers || {}).forEach(([key, p]) => {
      const card = document.querySelector(`.provider-card[data-provider="${key}"]`);
      if (!card) return;
      const badge = card.querySelector('.provider-status');
      if (badge) {
        badge.textContent = p.status;
        badge.className = `provider-status ${p.tone || ''}`;
        badge.title = p.note || '';
      }
      card.dataset.state = p.connected ? 'connected' : 'dormant';
    });

    if (summary) {
      summary.textContent = payload.summary || 'STATUS UNKNOWN';
      summary.title = payload.detail || '';
    }
    const detail = $('#providerDetail');
    if (detail && payload.detail) detail.textContent = payload.detail;
  }

  async function loadProviders() {
    try {
      applyProviders(await fetchJSON('/api/providers'));
    } catch (err) {
      console.warn('provider status unavailable', err);
      const summary = $('#providerSummary');
      if (summary) summary.textContent = 'STATUS UNAVAILABLE';
    }
  }

  async function loadAll({ manual = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    const btn = $('#refreshBtn');
    btn.classList.add('spinning');
    setFeed('', manual ? 'SYNCING' : 'CONNECTING');

    try {
      const [macro, cal, providers] = await Promise.all([
        fetchJSON(`/api/macro?series=${SERIES.join(',')}&years=6`),
        fetchJSON('/api/calendar').catch(() => ({ ok: false, events: [] })),
        fetchJSON('/api/providers').catch(() => null)
      ]);

      if (!macro || !macro.ok) throw new Error(macro && macro.error ? macro.error : 'macro feed failed');

      state.data = macro;
      state.calendar = cal && cal.events ? cal.events : [];
      state.calendarOk = !!(cal && cal.ok);
      state.lastLoaded = new Date();
      state.demo = false;

      applyProviders(providers);
      renderAll();
      setFeed('ok', 'FRED · CONNECTED');
      if (manual) toast('Macro data refreshed');
    } catch (err) {
      console.error(err);
      setFeed('bad', 'FEED ERROR');
      if (!state.data) {
        renderFailure();
      }
      toast(manual ? 'Refresh failed — check the local server' : 'Could not reach FRED — retrying', 'error');
    } finally {
      state.loading = false;
      btn.classList.remove('spinning');
    }
  }

  function renderAll() {
    renderRegime();
    renderMetrics();
    renderCurve();
    renderRates();
    renderReal();
    renderNfci();
    renderVol();
    renderPolicy();
    try { renderSentiment(); } catch (e) { console.warn(e); }
    renderCalendar();
    setFeed('ok', 'FRED · CONNECTED');
  }

  function renderFailure() {
    $('#regimeLabel').textContent = 'NO FEED';
    $('#regimeRead').textContent = 'The local server could not reach FRED. Start server.py and refresh.';
    $('#signalChips').innerHTML = '';
    $('#metricGrid').innerHTML = METRICS.map(m => `<article class="metric">
      <div class="metric-top"><span class="metric-label">${esc(m.label)}</span><span class="metric-tag">${esc(m.tag)}</span></div>
      <div class="metric-value">—</div>
      <div class="metric-delta delta-flat"><span>feed unavailable</span></div>
      <div class="metric-spark"></div>
    </article>`).join('');
  }

  /* ---------------------------------------------------------------------- */
  /* interactions                                                           */
  /* ---------------------------------------------------------------------- */

  function bind() {
    $('#refreshBtn').addEventListener('click', () => loadAll({ manual: true }));

    $('#curveRange').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg');
      if (!btn) return;
      $$('.seg', $('#curveRange')).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.curveAgo = Number(btn.dataset.ago || 0);
      renderCurve();
    });

    $('#realRange').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg');
      if (!btn) return;
      $$('.seg', $('#realRange')).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.realYears = Number(btn.dataset.years || 3);
      renderReal();
    });

    $('#calRegion').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg');
      if (!btn) return;
      $$('.seg', $('#calRegion')).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.calRegion = btn.dataset.region || 'US';
      renderCalendar();
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!state.data) return;
        renderCurve();
        renderReal();
        renderNfci();
        renderVol();
      }, 140);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.lastLoaded && (Date.now() - state.lastLoaded.getTime() > 5 * 60000)) {
        loadAll();
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* boot                                                                   */
  /* ---------------------------------------------------------------------- */

  function boot() {
    tickClock();
    setInterval(tickClock, 1000);
    bind();
    initAgent();
    loadProviders();
    loadAll();
    setInterval(() => loadAll(), 10 * 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
