/* global d3 */

const mediumStyles = {
  "Ocean water": { color: "#78c4c8", symbol: "circle", label: "Ocean water" },
  "Nurdle Patrol": { color: "#efad69", symbol: "cross", label: "Nurdle Patrol" },
  Beach: { color: "#c9a9d6", symbol: "ring", label: "Beach" },
  "Ocean sediment": { color: "#d77967", symbol: "square", label: "Ocean sediment" },
};

const state = {
  data: [],
  medium: "All",
  fullDomain: null,
  dateRange: null,
  playing: false,
  animationFrame: null,
};

const chartWrap = d3.select("#chartWrap");
const canvas = document.querySelector("#particleCanvas");
const context = canvas.getContext("2d");
const chartSvg = d3.select("#chartSvg");
const navigatorSvg = d3.select("#navigatorSvg");
const tooltip = d3.select("#tooltip");
const countFormatter = d3.format(",");
const dateFormatter = d3.utcFormat("%B %-d, %Y");
const yearFormatter = d3.utcFormat("%Y");
const parseDate = d3.utcParse("%Y-%m-%d");

let layout;
let visiblePoints = [];
let delaunay = null;
let brush;
let brushGroup;
let navigatorScale;
let hoverMark;
let keyboardIndex = -1;

const ambientCanvas = document.querySelector("#ambientSea");
const ambientContext = ambientCanvas.getContext("2d");
const shellCursor = document.querySelector("#shellCursor");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, tx: window.innerWidth / 2, ty: window.innerHeight / 2, angle: 0 };
const ripples = [];
let ambientParticles = [];
let ambientSize = { width: 0, height: 0, dpr: 1 };
let lastRippleTime = 0;

function seedParticles(width, height) {
  const count = Math.min(220, Math.max(90, Math.round((width * height) / 7200)));
  ambientParticles = d3.range(count).map((index) => ({
    x: ((index * 83.17) % 101) / 101 * width,
    y: ((index * 47.31) % 97) / 97 * height,
    radius: 0.35 + ((index * 13) % 9) / 10,
    speed: 0.04 + ((index * 7) % 13) / 120,
    drift: 6 + ((index * 17) % 24),
    phase: index * 0.71,
  }));
}

function sizeAmbientCanvas() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  ambientCanvas.width = Math.round(width * dpr);
  ambientCanvas.height = Math.round(height * dpr);
  ambientCanvas.style.width = `${width}px`;
  ambientCanvas.style.height = `${height}px`;
  ambientContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  ambientSize = { width, height, dpr };
  seedParticles(width, height);
}

function addRipple(x, y, strength = 1) {
  ripples.push({ x, y, radius: 2, alpha: 0.34 * strength, speed: 0.85 + strength * 0.3 });
  if (ripples.length > 22) ripples.shift();
}

function drawAmbientSea(time = 0) {
  const { width, height } = ambientSize;
  const entered = document.body.classList.contains("entered");
  ambientContext.clearRect(0, 0, width, height);

  pointer.x += (pointer.tx - pointer.x) * 0.045;
  pointer.y += (pointer.ty - pointer.y) * 0.045;
  const pullX = (pointer.x / Math.max(1, width) - 0.5) * 18;
  const waveCount = entered ? 8 : 6;

  ambientContext.save();
  ambientContext.globalCompositeOperation = "screen";
  for (let wave = 0; wave < waveCount; wave += 1) {
    const base = entered ? height * (0.12 + wave * 0.12) : height * (0.1 + wave * 0.095);
    const amplitude = 8 + wave * 3.5;
    const frequency = 0.006 + wave * 0.0007;
    const speed = time * (0.00006 + wave * 0.000009);
    ambientContext.beginPath();
    for (let x = -20; x <= width + 20; x += 12) {
      const localPull = Math.exp(-Math.pow((x - pointer.x) / 230, 2)) * (pointer.y / height - 0.5) * 16;
      const y = base + Math.sin(x * frequency + speed + wave * 0.9) * amplitude + Math.sin(x * 0.0023 - speed * 0.7) * 7 + localPull;
      if (x === -20) ambientContext.moveTo(x, y);
      else ambientContext.lineTo(x, y);
    }
    ambientContext.strokeStyle = `rgba(160, 218, 215, ${entered ? 0.035 + wave * 0.006 : 0.055 + wave * 0.008})`;
    ambientContext.lineWidth = wave % 3 === 0 ? 1.2 : 0.7;
    ambientContext.stroke();
  }

  for (const particle of ambientParticles) {
    const y = (particle.y - time * particle.speed + height * 2) % height;
    const x = particle.x + Math.sin(time * 0.00025 + particle.phase) * particle.drift + pullX;
    ambientContext.beginPath();
    ambientContext.arc(x, y, particle.radius, 0, Math.PI * 2);
    ambientContext.fillStyle = `rgba(184, 226, 220, ${0.12 + particle.radius * 0.08})`;
    ambientContext.fill();
  }

  for (let index = ripples.length - 1; index >= 0; index -= 1) {
    const ripple = ripples[index];
    ripple.radius += ripple.speed;
    ripple.alpha *= 0.976;
    ambientContext.beginPath();
    ambientContext.ellipse(ripple.x, ripple.y, ripple.radius * 1.75, ripple.radius, 0, 0, Math.PI * 2);
    ambientContext.strokeStyle = `rgba(185, 229, 224, ${ripple.alpha})`;
    ambientContext.lineWidth = 0.8;
    ambientContext.stroke();
    if (ripple.alpha < 0.012) ripples.splice(index, 1);
  }
  ambientContext.restore();

  if (!reducedMotion) requestAnimationFrame(drawAmbientSea);
}

function initAmbientScene() {
  sizeAmbientCanvas();
  drawAmbientSea(0);
  window.addEventListener("resize", sizeAmbientCanvas);
  window.addEventListener("pointermove", (event) => {
    const dx = event.clientX - pointer.tx;
    const dy = event.clientY - pointer.ty;
    pointer.tx = event.clientX;
    pointer.ty = event.clientY;
    pointer.angle = Math.max(-24, Math.min(24, Math.atan2(dy, dx) * (180 / Math.PI) * 0.35));
    // Keep the native pointer visible for usability; the shell trails beside it as a luminous companion.
    shellCursor.style.transform = `translate3d(${event.clientX + 12}px, ${event.clientY + 12}px, 0) rotate(${pointer.angle}deg)`;
    shellCursor.classList.add("visible");
    if (event.timeStamp - lastRippleTime > 46) {
      addRipple(event.clientX, event.clientY, 0.7);
      lastRippleTime = event.timeStamp;
    }
    if (reducedMotion) drawAmbientSea(event.timeStamp);
  }, { passive: true });
  document.documentElement.addEventListener("mouseleave", () => shellCursor.classList.remove("visible"));
}

function enterArchive() {
  window.scrollTo(0, 0);
  addRipple(window.innerWidth / 2, window.innerHeight * 0.62, 2.5);
  document.body.classList.add("entered");
  window.setTimeout(() => {
    document.body.classList.remove("scene-locked");
    document.querySelector(".masthead").setAttribute("tabindex", "-1");
    document.querySelector(".masthead").focus({ preventScroll: true });
  }, reducedMotion ? 0 : 1150);
}

function bindPortal() {
  window.scrollTo(0, 0);
  d3.select("#enterButton").on("click", enterArchive);
  document.querySelector("#portal").addEventListener("wheel", (event) => {
    if (event.deltaY > 18) enterArchive();
  }, { passive: true, once: true });
}

function parseRow(row) {
  return {
    ...row,
    dateValue: parseDate(row.date),
    yearValue: +row.year,
    latitudeValue: +row.latitude,
    longitudeValue: +row.longitude,
    measurementValue: +row.measurement,
  };
}

function symbolMarkup(symbol) {
  return `<span class="filter-symbol ${symbol}" aria-hidden="true"></span>`;
}

function buildFilters() {
  const counts = d3.rollup(state.data, (values) => values.length, (d) => d.medium);
  const options = [
    { key: "All", label: "All observations", color: "#e7eee9", symbol: "ring", count: state.data.length },
    ...Object.entries(mediumStyles).map(([key, style]) => ({ key, ...style, count: counts.get(key) || 0 })),
  ];

  d3.select("#filterList")
    .selectAll("button")
    .data(options)
    .join("button")
    .attr("type", "button")
    .attr("class", (d) => `filter-button${d.key === state.medium ? " active" : ""}`)
    .attr("aria-pressed", (d) => d.key === state.medium)
    .style("color", (d) => (d.key === state.medium ? d.color : null))
    .html(
      (d) =>
        `${symbolMarkup(d.symbol)}<span class="filter-name">${d.label}</span>` +
        `<span class="filter-count">${countFormatter(d.count)}</span>`,
    )
    .on("click", (_, d) => {
      state.medium = d.key;
      stopPlayback();
      buildFilters();
      renderMainChart();
    });
}

function calculateLayout() {
  const bounds = document.querySelector("#chartWrap").getBoundingClientRect();
  const width = Math.max(320, bounds.width);
  const height = Math.max(430, bounds.height);
  const compact = width < 560;
  const margin = { top: 28, right: 28, bottom: 42, left: compact ? 42 : 55 };
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  chartSvg.attr("viewBox", `0 0 ${width} ${height}`);

  layout = {
    width,
    height,
    margin,
    innerWidth: width - margin.left - margin.right,
    innerHeight: height - margin.top - margin.bottom,
  };
}

function pointColor(medium) {
  return mediumStyles[medium]?.color || "#e7eee9";
}

function drawPoint(ctx, point, emphasized = false) {
  const style = mediumStyles[point.medium] || mediumStyles["Ocean water"];
  const x = point._sx;
  const y = point._sy;
  const size = emphasized ? 4.5 : 1.65;

  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
  ctx.lineWidth = emphasized ? 1.5 : 0.75;

  if (style.symbol === "circle") {
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  } else if (style.symbol === "ring") {
    ctx.beginPath();
    ctx.arc(x, y, size + 0.4, 0, Math.PI * 2);
    ctx.stroke();
  } else if (style.symbol === "square") {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 12);
    ctx.fillRect(-size, -size, size * 2, size * 2);
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.moveTo(x - size, y - size);
    ctx.lineTo(x + size, y + size);
    ctx.moveTo(x + size, y - size);
    ctx.lineTo(x - size, y + size);
    ctx.stroke();
  }
}

function selectedData() {
  const [start, end] = state.dateRange;
  return state.data.filter(
    (d) =>
      (state.medium === "All" || d.medium === state.medium) &&
      d.dateValue >= start &&
      d.dateValue <= end,
  );
}

function renderMainChart() {
  calculateLayout();
  tooltip.classed("visible", false);
  keyboardIndex = -1;

  const { width, height, margin, innerWidth, innerHeight } = layout;
  const x = d3.scaleUtc().domain(state.dateRange).range([margin.left, margin.left + innerWidth]);
  const y = d3.scaleLinear().domain([90, -90]).range([margin.top, margin.top + innerHeight]);

  const latitudeTicks = [90, 60, 30, 0, -30, -60, -90];
  const grid = chartSvg
    .selectAll("g.grid")
    .data([null])
    .join("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3
        .axisLeft(y)
        .tickValues(latitudeTicks)
        .tickSize(-innerWidth)
        .tickFormat((value) => {
          if (value === 0) return "0°";
          return `${Math.abs(value)}°${value > 0 ? "N" : "S"}`;
        }),
    );
  grid.selectAll(".tick").classed("equator", (d) => d === 0);

  const yearSpan = state.dateRange[1].getUTCFullYear() - state.dateRange[0].getUTCFullYear();
  const tickCount = yearSpan < 12 ? Math.max(2, yearSpan) : width < 700 ? 5 : 8;
  chartSvg
    .selectAll("g.x-axis")
    .data([null])
    .join("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(tickCount).tickFormat(yearFormatter).tickSizeOuter(0));

  chartSvg
    .selectAll("text.axis-title")
    .data([null])
    .join("text")
    .attr("class", "axis-title")
    .attr("x", margin.left)
    .attr("y", 12)
    .text("recorded latitude");

  visiblePoints = selectedData();
  for (const point of visiblePoints) {
    point._sx = x(point.dateValue);
    point._sy = y(point.latitudeValue);
  }

  context.clearRect(0, 0, width, height);
  context.save();
  context.beginPath();
  context.rect(margin.left, margin.top, innerWidth, innerHeight);
  context.clip();
  context.globalAlpha = visiblePoints.length > 18000 ? 0.32 : visiblePoints.length > 6000 ? 0.45 : 0.62;
  for (const point of visiblePoints) drawPoint(context, point);
  context.restore();

  delaunay = visiblePoints.length
    ? d3.Delaunay.from(visiblePoints, (d) => d._sx, (d) => d._sy)
    : null;

  hoverMark = chartSvg
    .selectAll("circle.hover-mark")
    .data([null])
    .join("circle")
    .attr("class", "hover-mark")
    .attr("r", 7)
    .attr("fill", "none")
    .attr("stroke", "#e7eee9")
    .attr("stroke-width", 1.2)
    .attr("display", "none");

  d3.select("#visibleCount").text(countFormatter(visiblePoints.length));
  d3.select("#visibleYears").text(
    `${state.dateRange[0].getUTCFullYear()}–${state.dateRange[1].getUTCFullYear()}`,
  );
}

function tooltipMeasurement(point) {
  const value = point.measurementValue;
  let formatted;
  if (value === 0) formatted = "0";
  else if (Math.abs(value) < 0.01) formatted = d3.format(".3~g")(value);
  else if (Math.abs(value) < 100) formatted = d3.format(",.3~f")(value);
  else formatted = d3.format(",.0f")(value);
  return `${formatted} ${point.unit}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showTooltip(point, pointerX, pointerY) {
  hoverMark
    .attr("display", null)
    .attr("cx", point._sx)
    .attr("cy", point._sy)
    .attr("stroke", pointColor(point.medium));

  const place = point.region || point.country || point.ocean || "Unspecified marine region";
  tooltip
    .html(
      `<p class="tooltip-kicker">${escapeHtml(point.medium)} · ${escapeHtml(point.concentration_class)}</p>` +
        `<h3>${escapeHtml(place)}</h3>` +
        `<dl>` +
        `<dt>Sampled</dt><dd>${escapeHtml(dateFormatter(point.dateValue))}</dd>` +
        `<dt>Position</dt><dd>${Math.abs(point.latitudeValue).toFixed(2)}°${point.latitudeValue >= 0 ? "N" : "S"}, ${Math.abs(point.longitudeValue).toFixed(2)}°${point.longitudeValue >= 0 ? "E" : "W"}</dd>` +
        `<dt>Measured</dt><dd>${escapeHtml(tooltipMeasurement(point))}</dd>` +
        `<dt>Method</dt><dd>${escapeHtml(point.sampling_method)}</dd>` +
        `<dt>Source</dt><dd>${escapeHtml(point.reference)}</dd>` +
        `</dl>`,
    )
    .classed("visible", true);

  const tip = tooltip.node();
  const maxX = layout.width - tip.offsetWidth - 14;
  const maxY = layout.height - tip.offsetHeight - 14;
  const left = Math.max(8, Math.min(maxX, pointerX + 13));
  const top = Math.max(8, Math.min(maxY, pointerY + 13));
  tooltip.style("left", `${left}px`).style("top", `${top}px`);
}

function hideTooltip() {
  tooltip.classed("visible", false);
  if (hoverMark) hoverMark.attr("display", "none");
}

function bindChartInteraction() {
  chartSvg
    .attr("tabindex", 0)
    .on("pointermove", (event) => {
      if (!delaunay || !visiblePoints.length) return;
      const [x, y] = d3.pointer(event, chartSvg.node());
      const index = delaunay.find(x, y);
      const point = visiblePoints[index];
      const distance = Math.hypot(point._sx - x, point._sy - y);
      if (distance > 28) return hideTooltip();
      showTooltip(point, x, y);
    })
    .on("pointerleave", hideTooltip)
    .on("keydown", (event) => {
      if (!visiblePoints.length || !["ArrowRight", "ArrowLeft"].includes(event.key)) return;
      event.preventDefault();
      keyboardIndex += event.key === "ArrowRight" ? 1 : -1;
      keyboardIndex = (keyboardIndex + visiblePoints.length) % visiblePoints.length;
      const point = visiblePoints[keyboardIndex];
      showTooltip(point, point._sx, point._sy);
    });
}

function buildNavigator() {
  const bounds = document.querySelector("#navigatorSvg").getBoundingClientRect();
  const width = Math.max(320, bounds.width);
  const height = 88;
  const margin = { top: 18, right: 12, bottom: 18, left: 12 };
  navigatorSvg.attr("viewBox", `0 0 ${width} ${height}`);

  navigatorScale = d3.scaleUtc().domain(state.fullDomain).range([margin.left, width - margin.right]);
  const yearCounts = d3
    .rollups(state.data, (values) => values.length, (d) => d.yearValue)
    .sort((a, b) => d3.ascending(a[0], b[0]));
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(yearCounts, (d) => d[1])])
    .nice()
    .range([height - margin.bottom, margin.top]);

  const yearDate = (year) => new Date(Date.UTC(year, 0, 1));
  const area = d3
    .area()
    .x((d) => navigatorScale(yearDate(d[0])))
    .y0(height - margin.bottom)
    .y1((d) => y(d[1]))
    .curve(d3.curveMonotoneX);
  const line = d3
    .line()
    .x((d) => navigatorScale(yearDate(d[0])))
    .y((d) => y(d[1]))
    .curve(d3.curveMonotoneX);

  navigatorSvg.selectAll("path.navigator-area").data([yearCounts]).join("path").attr("class", "navigator-area").attr("d", area);
  navigatorSvg.selectAll("path.navigator-line").data([yearCounts]).join("path").attr("class", "navigator-line").attr("d", line);
  navigatorSvg
    .selectAll("g.navigator-axis")
    .data([null])
    .join("g")
    .attr("class", "navigator-axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(navigatorScale).ticks(width < 600 ? 4 : 7).tickFormat(yearFormatter));

  brush = d3
    .brushX()
    .extent([
      [margin.left, margin.top],
      [width - margin.right, height - margin.bottom],
    ])
    .on("brush end", (event) => {
      if (!event.selection) {
        state.dateRange = [...state.fullDomain];
      } else {
        const dates = event.selection.map(navigatorScale.invert);
        const startYear = dates[0].getUTCFullYear();
        const endYear = dates[1].getUTCFullYear();
        state.dateRange = [
          new Date(Date.UTC(startYear, 0, 1)),
          new Date(Date.UTC(endYear, 11, 31, 23, 59, 59)),
        ];
      }
      renderMainChart();
    });

  brushGroup = navigatorSvg.selectAll("g.brush").data([null]).join("g").attr("class", "brush").call(brush);
  brushGroup.call(brush.move, state.dateRange.map(navigatorScale));
}

function stopPlayback() {
  state.playing = false;
  if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
  state.animationFrame = null;
  d3.select("#playButton .play-icon").text("▶");
  d3.select("#playButton .play-label").text("Play the archive");
}

function startPlayback() {
  stopPlayback();
  state.playing = true;
  d3.select("#playButton .play-icon").text("Ⅱ");
  d3.select("#playButton .play-label").text("Pause the archive");
  const startYear = state.fullDomain[0].getUTCFullYear();
  const finalYear = state.fullDomain[1].getUTCFullYear();
  let year = startYear;
  let last = 0;

  function advance(timestamp) {
    if (!state.playing) return;
    if (!last || timestamp - last > 145) {
      last = timestamp;
      const start = new Date(Date.UTC(startYear, 0, 1));
      const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
      brushGroup.call(brush.move, [navigatorScale(start), navigatorScale(end)]);
      year += 1;
      if (year > finalYear) {
        stopPlayback();
        return;
      }
    }
    state.animationFrame = requestAnimationFrame(advance);
  }
  state.animationFrame = requestAnimationFrame(advance);
}

function bindControls() {
  d3.select("#playButton").on("click", () => {
    if (state.playing) stopPlayback();
    else startPlayback();
  });
  d3.select("#resetButton").on("click", () => {
    stopPlayback();
    state.medium = "All";
    state.dateRange = [...state.fullDomain];
    buildFilters();
    brushGroup.call(brush.move, state.dateRange.map(navigatorScale));
  });
}

function resize() {
  if (!state.data.length) return;
  renderMainChart();
  buildNavigator();
}

async function init() {
  try {
    state.data = await d3.csv("data/microplastics.csv", parseRow);
    state.data.sort((a, b) => d3.ascending(a.dateValue, b.dateValue));
    state.fullDomain = d3.extent(state.data, (d) => d.dateValue);
    state.dateRange = [...state.fullDomain];
    buildFilters();
    buildNavigator();
    renderMainChart();
    bindChartInteraction();
    bindControls();
    window.addEventListener("resize", debounce(resize, 180));
    d3.select("#loadingScreen").classed("hidden", true);
  } catch (error) {
    console.error(error);
    d3.select("#loadingScreen").html(
      "<p>The archive could not be loaded. Please run this project through a local web server.</p>",
    );
  }
}

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

initAmbientScene();
bindPortal();
init();
