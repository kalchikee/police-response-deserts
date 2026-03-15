/* =====================================================
   Detroit Police Response Desert - App
   ===================================================== */

/* ── State ────────────────────────────────────────── */
const STATE = {
  metric:    "median_response_all",   // current choropleth metric
  tracts:    null,                    // GeoJSON FeatureCollection
  summary:   null,                    // summary_stats.json
  regression:null,                    // regression_results.json
  scatter:   null,                    // scatter_data.json
  selected:  null,                    // selected tract GEOID
  map:       null,                    // Leaflet map instance
  geoLayer:  null,                    // choropleth layer
};

/* ── Colour scales ──────────────────────────────────── */
const PALETTE = {
  slow:   "#ff4d4d",
  mid:    "#ffd166",
  fast:   "#06d6a0",
};

// 5-class sequential (fast → slow)
const COLORS = ["#06d6a0","#9cde8a","#ffd166","#ff8c42","#ff4d4d"];

function getColor(value, min, max) {
  if (value == null) return "#333";
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const i = Math.min(4, Math.floor(t * 5));
  return COLORS[i];
}

/* Metric config */
const METRICS = {
  median_response_all:   { label: "Median Response (All Calls)",     unit: "min", min: 10, max: 40 },
  median_response_p1:    { label: "Median Response (Priority 1)",    unit: "min", min: 6,  max: 18 },
  median_response_day:   { label: "Daytime Response (6am–6pm)",      unit: "min", min: 8,  max: 50 },
  median_response_night: { label: "Nighttime Response (6pm–6am)",    unit: "min", min: 7,  max: 50 },
  pct_nonwhite:          { label: "% Non-White Population",          unit: "%",   min: 0,  max: 100 },
  median_income:         { label: "Median Household Income",         unit: "$",   min: 10000, max: 130000 },
  equity_residual:       { label: "Equity Residual (+ = Slower)",    unit: "min", min: -8, max: 14 },
};

/* ── Initialisation ─────────────────────────────────── */
async function init() {
  try {
    const [tracts, summary, regression, scatter] = await Promise.all([
      fetch("data/processed/detroit_response_tracts.geojson").then(r => r.json()),
      fetch("data/processed/summary_stats.json").then(r => r.json()),
      fetch("data/processed/regression_results.json").then(r => r.json()),
      fetch("data/processed/scatter_data.json").then(r => r.json()),
    ]);
    STATE.tracts     = tracts;
    STATE.summary    = summary;
    STATE.regression = regression;
    STATE.scatter    = scatter;

    renderStats();
    initMap();
    renderLegend();
    renderScatter();
    renderMethodology();
    buildAddressSearch();

    document.getElementById("loading").classList.add("hidden");
  } catch (err) {
    console.error("Init error:", err);
    document.querySelector(".loading-text").textContent = "Error loading data. Check console.";
  }
}

/* ── Stats bar ──────────────────────────────────────── */
function renderStats() {
  const s = STATE.summary;
  document.getElementById("stat-median-all").textContent   = s.citywide_median_response_all + " min";
  document.getElementById("stat-median-p1").textContent    = s.citywide_median_response_p1  + " min";
  document.getElementById("stat-median-day").textContent   = s.citywide_median_response_day + " min";
  document.getElementById("stat-median-night").textContent = s.citywide_median_response_night + " min";
  document.getElementById("stat-calls").textContent        = (s.total_calls_2022 / 1000).toFixed(0) + "K";
  document.getElementById("stat-tracts").textContent       = s.total_tracts_analyzed;
}

/* ── Map ────────────────────────────────────────────── */
function initMap() {
  const map = L.map("map", {
    center: [42.35, -83.05],
    zoom: 11,
    zoomControl: true,
    preferCanvas: true,
  });
  STATE.map = map;

  // Dark base tiles
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> | &copy; OpenStreetMap',
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map);

  renderChoropleth();
}

function renderChoropleth() {
  if (STATE.geoLayer) {
    STATE.map.removeLayer(STATE.geoLayer);
  }

  const mc = METRICS[STATE.metric];
  const features = STATE.tracts.features;

  STATE.geoLayer = L.geoJSON(STATE.tracts, {
    style: feature => {
      const p = feature.properties;
      const val = p[STATE.metric];
      return {
        fillColor:   getColor(val, mc.min, mc.max),
        fillOpacity: val == null ? 0.15 : 0.72,
        color:       "#000",
        weight:      0.4,
        opacity:     0.5,
      };
    },
    onEachFeature: (feature, layer) => {
      layer.on({
        mouseover: e => {
          e.target.setStyle({ weight: 2, color: "#fff", fillOpacity: 0.9 });
          e.target.bringToFront();
          showPopup(feature, e.latlng);
        },
        mouseout: e => {
          STATE.geoLayer.resetStyle(e.target);
          closePopup();
        },
        click: e => {
          selectTract(feature);
          STATE.map.fitBounds(e.target.getBounds(), { maxZoom: 13 });
        },
      });
    },
  }).addTo(STATE.map);
}

/* ── Popup ─────────────────────────────────────────── */
let popup = null;

function showPopup(feature, latlng) {
  const p = feature.properties;
  const cityMedian = STATE.summary.citywide_median_response_all;

  function speedClass(val, cityMed) {
    if (val == null) return "";
    if (val < cityMed * 0.85) return "popup-fast";
    if (val > cityMed * 1.15) return "popup-slow";
    return "popup-med";
  }

  const resp = p.median_response_all;
  const cls  = speedClass(resp, cityMedian);

  const html = `
    <div class="popup-title">${p.NAME || "Census Tract " + (p.GEOID || "")}</div>
    <div class="popup-row"><span>Median response</span><span class="${cls}">${fmt(resp,"min")}</span></div>
    <div class="popup-row"><span>Priority 1 response</span><span>${fmt(p.median_response_p1,"min")}</span></div>
    <div class="popup-row"><span>Day / Night</span><span>${fmt(p.median_response_day,"min")} / ${fmt(p.median_response_night,"min")}</span></div>
    <div class="popup-row"><span>Call volume (2022)</span><span>${fmt(p.call_volume,"")}</span></div>
    <div class="popup-row"><span>% Non-white</span><span>${fmt(p.pct_nonwhite,"%")}</span></div>
    <div class="popup-row"><span>Median income</span><span>${fmtIncome(p.median_income)}</span></div>
    <div style="font-size:10px;color:#8b92b8;margin-top:6px">Click tract for full details</div>
  `;

  if (popup) popup.remove();
  popup = L.popup({ closeButton: false, offset: [0, -4] })
    .setLatLng(latlng)
    .setContent(html)
    .openOn(STATE.map);
}

function closePopup() {
  if (popup) { popup.remove(); popup = null; }
}

/* ── Tract detail panel ─────────────────────────────── */
function selectTract(feature) {
  STATE.selected = feature.properties.GEOID;
  const p = feature.properties;
  const cityMedian = STATE.summary.citywide_median_response_all;

  const el = document.getElementById("tract-info");
  if (!p.median_response_all) {
    el.innerHTML = `<div class="empty">No 911 data for this tract</div>`;
    return;
  }

  const ratio = p.median_response_all / cityMedian;
  const barPct = Math.min(100, (ratio * 50));  // 2× median = 100%
  const barColor = ratio < 0.85 ? "var(--good)" : ratio > 1.15 ? "var(--danger)" : "var(--warn)";

  const speedLabel = ratio < 0.85
    ? `<span class="metric-val fast">${((1-ratio)*100).toFixed(0)}% faster than city median</span>`
    : ratio > 1.15
    ? `<span class="metric-val slow">${((ratio-1)*100).toFixed(0)}% slower than city median</span>`
    : `<span class="metric-val med">Near city median</span>`;

  el.innerHTML = `
    <div class="tract-name">Census Tract ${p.GEOID || ""}</div>
    <div class="compare-bar"><div class="compare-bar-fill" style="width:${barPct}%;background:${barColor}"></div></div>
    <div class="compare-label">vs. citywide median (${cityMedian} min): ${speedLabel}</div>

    <div style="margin-top:10px">
    <div class="metric-row"><span class="metric-key">Median response (all)</span>
      <span class="metric-val ${speedClass(p.median_response_all, cityMedian)}">${fmt(p.median_response_all,"min")}</span></div>
    <div class="metric-row"><span class="metric-key">90th pct response</span>
      <span class="metric-val">${fmt(p.p90_response_all,"min")}</span></div>
    <div class="metric-row"><span class="metric-key">Priority 1 median</span>
      <span class="metric-val">${fmt(p.median_response_p1,"min")}</span></div>
    <div class="metric-row"><span class="metric-key">Daytime median</span>
      <span class="metric-val">${fmt(p.median_response_day,"min")}</span></div>
    <div class="metric-row"><span class="metric-key">Nighttime median</span>
      <span class="metric-val">${fmt(p.median_response_night,"min")}</span></div>
    <div class="metric-row"><span class="metric-key">Total calls 2022</span>
      <span class="metric-val">${fmt(p.call_volume,"")}</span></div>
    </div>

    <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
    <div class="metric-row"><span class="metric-key">% Non-white</span>
      <span class="metric-val">${fmt(p.pct_nonwhite,"%")}</span></div>
    <div class="metric-row"><span class="metric-key">Median income</span>
      <span class="metric-val">${fmtIncome(p.median_income)}</span></div>
    <div class="metric-row"><span class="metric-key">Dist. to precinct</span>
      <span class="metric-val">${fmt(p.dist_to_station_km," km")}</span></div>
    <div class="metric-row"><span class="metric-key">Equity residual</span>
      <span class="metric-val ${(p.equity_residual||0) > 1 ? 'slow' : (p.equity_residual||0) < -1 ? 'fast' : ''}"
        title="Positive = slower than model predicts given demographics/distance">
        ${p.equity_residual != null ? (p.equity_residual > 0 ? "+" : "") + p.equity_residual.toFixed(1) + " min" : "N/A"}
      </span></div>
    </div>
  `;
}

function speedClass(val, cityMed) {
  if (val == null) return "";
  if (val < cityMed * 0.85) return "fast";
  if (val > cityMed * 1.15) return "slow";
  return "med";
}

/* ── Legend ─────────────────────────────────────────── */
function renderLegend() {
  const mc = METRICS[STATE.metric];
  const el = document.getElementById("legend");
  const labels = [
    mc.min,
    mc.min + (mc.max - mc.min) * 0.25,
    mc.min + (mc.max - mc.min) * 0.5,
    mc.min + (mc.max - mc.min) * 0.75,
    mc.max
  ];
  const descs = ["Fastest", "", "Median", "", "Slowest"];

  el.innerHTML = COLORS.map((c, i) => `
    <div class="legend-row">
      <div class="legend-swatch" style="background:${c}"></div>
      <span>${mc.unit === "$" ? fmtIncome(labels[i]) : labels[i].toFixed(mc.unit === "%" ? 0 : 1) + " " + mc.unit}
        ${descs[i] ? `<span style="color:var(--text-muted)"> — ${descs[i]}</span>` : ""}
      </span>
    </div>
  `).join("") + `<div style="font-size:10px;color:var(--text-muted);margin-top:4px">${mc.label}</div>`;
}

/* ── Scatterplot (D3-free, SVG) ────────────────────── */
function renderScatter() {
  const data = STATE.scatter.filter(d =>
    d.median_response_p1 != null && d.median_income != null && d.pct_nonwhite != null
  );
  if (!data.length) return;

  const svgEl = document.getElementById("scatter-svg");
  const W = svgEl.parentElement.clientWidth - 28;
  const H = 180;
  const PAD = { top: 6, right: 12, bottom: 28, left: 36 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top  - PAD.bottom;

  const minX = Math.min(...data.map(d => d.median_income));
  const maxX = Math.max(...data.map(d => d.median_income));
  const minY = Math.min(...data.map(d => d.median_response_p1));
  const maxY = Math.max(...data.map(d => d.median_response_p1));

  const scX = v => PAD.left + ((v - minX) / (maxX - minX)) * iW;
  const scY = v => PAD.top  + iH - ((v - minY) / (maxY - minY)) * iH;

  // colour by pct_nonwhite
  const minNW = Math.min(...data.map(d => d.pct_nonwhite));
  const maxNW = Math.max(...data.map(d => d.pct_nonwhite));
  function dotColor(pct) {
    const t = (pct - minNW) / (maxNW - minNW);
    // gradient: green (mostly white) → red (mostly non-white)
    const r = Math.round(6  + t * 249);
    const g = Math.round(214 - t * 148);
    const b = Math.round(160 - t * 140);
    return `rgb(${r},${g},${b})`;
  }

  // City median lines
  const cityMedResp   = STATE.summary.citywide_median_response_p1;
  const medIncome     = data.reduce((a,d) => a + d.median_income, 0) / data.length;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("xmlns",  ns);
  svg.style.width  = "100%";
  svg.style.height = H + "px";
  svg.style.overflow = "visible";

  const g = document.createElementNS(ns, "g");

  // Grid lines
  [25, 50, 75].forEach(pct => {
    const yVal = minY + (maxY - minY) * pct / 100;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", PAD.left); line.setAttribute("x2", PAD.left + iW);
    line.setAttribute("y1", scY(yVal)); line.setAttribute("y2", scY(yVal));
    line.setAttribute("stroke", "#2e3250"); line.setAttribute("stroke-width", "0.5");
    g.appendChild(line);
  });

  // City median response line
  const medLine = document.createElementNS(ns, "line");
  medLine.setAttribute("x1", PAD.left); medLine.setAttribute("x2", PAD.left + iW);
  medLine.setAttribute("y1", scY(cityMedResp)); medLine.setAttribute("y2", scY(cityMedResp));
  medLine.setAttribute("stroke", "#ffd166"); medLine.setAttribute("stroke-width", "1");
  medLine.setAttribute("stroke-dasharray", "4,3");
  g.appendChild(medLine);

  // Dots
  const tooltip = document.getElementById("scatter-tooltip");
  data.forEach(d => {
    const cx = scX(d.median_income);
    const cy = scY(d.median_response_p1);
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", cx);
    circle.setAttribute("cy", cy);
    circle.setAttribute("r", "3.5");
    circle.setAttribute("fill", dotColor(d.pct_nonwhite));
    circle.setAttribute("fill-opacity", "0.75");
    circle.setAttribute("stroke", "none");
    circle.style.cursor = "pointer";
    circle.addEventListener("mousemove", e => {
      tooltip.style.display = "block";
      tooltip.style.left = (e.pageX + 12) + "px";
      tooltip.style.top  = (e.pageY - 28) + "px";
      tooltip.innerHTML = `
        <b>Tract ${d.GEOID || ""}</b><br>
        P1 response: ${d.median_response_p1?.toFixed(1)} min<br>
        Income: ${fmtIncome(d.median_income)}<br>
        % Non-white: ${d.pct_nonwhite?.toFixed(1)}%<br>
        Calls: ${d.call_volume}
      `;
    });
    circle.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });
    circle.addEventListener("click", () => {
      const feat = STATE.tracts.features.find(f => f.properties.GEOID === d.GEOID);
      if (feat) selectTract(feat);
    });
    g.appendChild(circle);
  });

  // Axes
  // Y axis
  const yAxis = document.createElementNS(ns, "line");
  yAxis.setAttribute("x1", PAD.left); yAxis.setAttribute("x2", PAD.left);
  yAxis.setAttribute("y1", PAD.top);  yAxis.setAttribute("y2", PAD.top + iH);
  yAxis.setAttribute("stroke", "#2e3250"); yAxis.setAttribute("stroke-width","1");
  g.appendChild(yAxis);
  // Y label
  const yLab = document.createElementNS(ns, "text");
  yLab.setAttribute("x", "8"); yLab.setAttribute("y", H/2);
  yLab.setAttribute("text-anchor", "middle");
  yLab.setAttribute("transform", `rotate(-90, 8, ${H/2})`);
  yLab.setAttribute("fill", "#8b92b8"); yLab.setAttribute("font-size","9");
  yLab.textContent = "P1 Response (min)";
  g.appendChild(yLab);
  // X label
  const xLab = document.createElementNS(ns, "text");
  xLab.setAttribute("x", PAD.left + iW/2); xLab.setAttribute("y", H - 2);
  xLab.setAttribute("text-anchor", "middle");
  xLab.setAttribute("fill", "#8b92b8"); xLab.setAttribute("font-size","9");
  xLab.textContent = "Median Household Income ($) — dot color = % non-white";
  g.appendChild(xLab);
  // Median label
  const medLab = document.createElementNS(ns, "text");
  medLab.setAttribute("x", PAD.left + iW - 2); medLab.setAttribute("y", scY(cityMedResp) - 3);
  medLab.setAttribute("text-anchor", "end");
  medLab.setAttribute("fill", "#ffd166"); medLab.setAttribute("font-size","8");
  medLab.textContent = `City median ${cityMedResp} min`;
  g.appendChild(medLab);

  svg.appendChild(g);
  svgEl.replaceWith(svg);
  svg.id = "scatter-svg";
}

/* ── Methodology ───────────────────────────────────── */
function renderMethodology() {
  const r  = STATE.regression;
  const c  = r.coefficients;
  const el = document.getElementById("methodology-content");

  const sigBadge = (sig) => sig
    ? `<span style="color:var(--danger)">significant</span>`
    : `<span style="color:var(--text-muted)">not significant</span>`;

  el.innerHTML = `
    <p>Analysis of <b>${(STATE.summary.total_calls_2022/1000).toFixed(0)}K</b> Detroit 911 police calls from 2022,
    aggregated to <b>${STATE.summary.total_tracts_analyzed}</b> census tracts and joined with ACS demographic data.</p>

    <div class="finding">
      Citywide median response: <b>${STATE.summary.citywide_median_response_all} min</b> (all calls),
      <b>${STATE.summary.citywide_median_response_p1} min</b> (Priority 1 emergencies).
      Responses range from <b>10.8 to 52.9 minutes</b> across tracts.
    </div>

    <p><b>OLS Regression</b> — dependent variable: tract median Priority 1 response time (R² = ${r.r_squared})</p>

    <div class="finding ${c.dist_station?.significant ? 'red' : ''}">
      <b>Distance to nearest precinct</b> — coef ${c.dist_station?.coef > 0 ? "+" : ""}${c.dist_station?.coef},
      p=${c.dist_station?.p} — ${sigBadge(c.dist_station?.significant)}.
      Each additional km from a precinct adds ~${c.dist_station?.coef?.toFixed(1)} min to response.
    </div>

    <div class="finding ${c.median_income?.significant ? 'red' : ''}">
      <b>Median household income</b> — coef ${c.median_income?.coef > 0 ? "+" : ""}${c.median_income?.coef},
      p=${c.median_income?.p} — ${sigBadge(c.median_income?.significant)}.
      Lower-income tracts receive statistically slower response after controlling for station distance.
    </div>

    <div class="finding">
      <b>% Non-white population</b> — coef ${c.pct_nonwhite?.coef > 0 ? "+" : ""}${c.pct_nonwhite?.coef},
      p=${c.pct_nonwhite?.p} — ${sigBadge(c.pct_nonwhite?.significant)}.
    </div>

    <p style="margin-top:8px;font-size:10px">
      Data: Detroit Open Data 2022 911 Calls · ACS 5-Year 2022 · TIGER/Line tracts<br>
      <a href="notebooks/01_fetch_and_process.py" target="_blank">View data processing code →</a>
    </p>
  `;
}

/* ── Address lookup ─────────────────────────────────── */
function buildAddressSearch() {
  const input = document.getElementById("address-input");
  const btn   = document.getElementById("address-btn");

  async function search() {
    const q = input.value.trim();
    if (!q) return;
    btn.textContent = "Searching...";
    btn.disabled = true;
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ", Detroit MI")}&format=json&limit=1`;
      const res = await fetch(url, { headers: {"Accept-Language": "en"} });
      const data = await res.json();
      if (!data.length) { alert("Address not found. Try a Detroit street address."); return; }
      const { lat, lon, display_name } = data[0];
      const latlng = L.latLng(+lat, +lon);
      STATE.map.setView(latlng, 14);

      // Find which tract this is in
      const pt = turf.point([+lon, +lat]);
      let found = null;
      for (const feat of STATE.tracts.features) {
        try {
          if (turf.booleanPointInPolygon(pt, feat)) { found = feat; break; }
        } catch(e) {}
      }

      if (found) {
        selectTract(found);
        L.popup().setLatLng(latlng)
          .setContent(`<b>${display_name.split(",")[0]}</b><br>Tract: ${found.properties.GEOID}`)
          .openOn(STATE.map);
      } else {
        L.popup().setLatLng(latlng).setContent(`<b>${display_name.split(",")[0]}</b>`).openOn(STATE.map);
      }
    } catch(e) {
      alert("Geocoding error. Please try again.");
    } finally {
      btn.textContent = "Look Up";
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", search);
  input.addEventListener("keydown", e => { if (e.key === "Enter") search(); });
}

/* ── UI event handlers ───────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  // Metric selector
  document.getElementById("metric-select").addEventListener("change", e => {
    STATE.metric = e.target.value;
    renderChoropleth();
    renderLegend();
  });

  // Nav tab: Map view / Methodology
  document.querySelectorAll("header nav button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("header nav button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.target;
      document.querySelectorAll(".view").forEach(v => v.style.display = "none");
      document.getElementById(target).style.display = "";
    });
  });

  init();
});

/* ── Formatting helpers ─────────────────────────────── */
function fmt(val, unit) {
  if (val == null || isNaN(val)) return "N/A";
  if (unit === "%")   return val.toFixed(1) + "%";
  if (unit === "min") return val.toFixed(1) + " min";
  if (unit === " km") return val.toFixed(1) + " km";
  if (unit === "")    return val.toLocaleString();
  return val.toFixed(1) + unit;
}

function fmtIncome(v) {
  if (v == null || isNaN(v)) return "N/A";
  return "$" + Math.round(v).toLocaleString();
}
