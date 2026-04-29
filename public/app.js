const state = {
  pages: 0,
  page: 1,
  zoom: 1,
  mode: "select",
  marker: "x1",
  pageSvg: null,
  hovered: null,
  selected: [],
  pan: { x: 24, y: 24 },
  panning: null,
  viewBox: { x: 0, y: 0, width: 612, height: 792 },
  calibration: {
    x1: null,
    x2: null,
    y1: null,
    y2: null
  }
};

const els = {
  pdfInput: document.querySelector("#pdfInput"),
  pdfStatus: document.querySelector("#pdfStatus"),
  pageInput: document.querySelector("#pageInput"),
  pageCount: document.querySelector("#pageCount"),
  prevPage: document.querySelector("#prevPage"),
  nextPage: document.querySelector("#nextPage"),
  zoomOut: document.querySelector("#zoomOut"),
  zoomIn: document.querySelector("#zoomIn"),
  zoomLabel: document.querySelector("#zoomLabel"),
  selectMode: document.querySelector("#selectMode"),
  calibrateMode: document.querySelector("#calibrateMode"),
  panMode: document.querySelector("#panMode"),
  viewport: document.querySelector("#viewport"),
  svgHost: document.querySelector("#svgHost"),
  overlay: document.querySelector("#overlay"),
  pageWrap: document.querySelector("#pageWrap"),
  selectedCount: document.querySelector("#selectedCount"),
  pointCount: document.querySelector("#pointCount"),
  selectedList: document.querySelector("#selectedList"),
  csvPreview: document.querySelector("#csvPreview"),
  exportButton: document.querySelector("#exportButton"),
  sampleStep: document.querySelector("#sampleStep"),
  outputPoints: document.querySelector("#outputPoints"),
  xMin: document.querySelector("#xMin"),
  xMax: document.querySelector("#xMax"),
  pointOrder: document.querySelector("#pointOrder"),
  outputFormat: document.querySelector("#outputFormat"),
  xScale: document.querySelector("#xScale"),
  yScale: document.querySelector("#yScale"),
  x1Value: document.querySelector("#x1Value"),
  x2Value: document.querySelector("#x2Value"),
  y1Value: document.querySelector("#y1Value"),
  y2Value: document.querySelector("#y2Value")
};

els.pdfInput.addEventListener("change", loadUploadedPdf);
els.prevPage.addEventListener("click", () => setPage(state.page - 1));
els.nextPage.addEventListener("click", () => setPage(state.page + 1));
els.pageInput.addEventListener("change", () => setPage(Number(els.pageInput.value)));
els.zoomOut.addEventListener("click", () => setZoom(state.zoom / 1.2));
els.zoomIn.addEventListener("click", () => setZoom(state.zoom * 1.2));
els.panMode.addEventListener("click", () => setMode("pan"));
els.selectMode.addEventListener("click", () => setMode("select"));
els.calibrateMode.addEventListener("click", () => setMode("calibrate"));
els.exportButton.addEventListener("click", exportCsv);
els.selectedList.addEventListener("click", onSelectedListClick);
els.viewport.addEventListener("wheel", onViewportWheel, { passive: false });
els.viewport.addEventListener("pointerdown", onViewportPointerDown);
els.viewport.addEventListener("pointermove", onViewportPointerMove);
els.viewport.addEventListener("pointerup", endPan);
els.viewport.addEventListener("pointercancel", endPan);
els.sampleStep.addEventListener("input", updateOutput);
els.outputPoints.addEventListener("input", updateOutput);
els.xMin.addEventListener("input", updateOutput);
els.xMax.addEventListener("input", updateOutput);
els.pointOrder.addEventListener("change", updateOutput);
els.outputFormat.addEventListener("change", updateOutput);
els.xScale.addEventListener("change", updateOutput);
els.yScale.addEventListener("change", updateOutput);
els.x1Value.addEventListener("input", updateOutput);
els.x2Value.addEventListener("input", updateOutput);
els.y1Value.addEventListener("input", updateOutput);
els.y2Value.addEventListener("input", updateOutput);

document.querySelectorAll("[data-marker]").forEach(button => {
  button.addEventListener("click", () => {
    state.marker = button.dataset.marker;
    setMode("calibrate");
    updateMarkerButtons();
  });
});

updateControls();

async function loadUploadedPdf() {
  const file = els.pdfInput.files[0];
  if (!file) return;

  const response = await fetch("/api/pdf", {
    method: "POST",
    headers: { "content-type": "application/pdf" },
    body: await file.arrayBuffer()
  });
  const info = await readJson(response);
  els.pdfStatus.textContent = file.name;
  await setLoadedPdf(info);
}

async function setLoadedPdf(info) {
  state.pages = info.pages;
  state.page = 1;
  setHovered(null);
  state.selected = [];
  state.calibration = { x1: null, x2: null, y1: null, y2: null };
  els.pageInput.max = String(info.pages);
  await loadPage(1);
}

async function setPage(page) {
  if (!state.pages) return;
  const nextPage = Math.min(state.pages, Math.max(1, page || 1));
  await loadPage(nextPage);
}

async function loadPage(page) {
  const response = await fetch(`/api/page/${page}.svg`);
  if (!response.ok) {
    throw new Error(await response.text());
  }

  const svgText = await response.text();
  els.svgHost.innerHTML = svgText;
  state.pageSvg = els.svgHost.querySelector("svg");
  state.page = page;
  setHovered(null);
  state.selected = [];

  if (!state.pageSvg) {
    throw new Error("Page did not render as SVG");
  }

  state.pageSvg.querySelectorAll("script").forEach(node => node.remove());
  state.pageSvg.addEventListener("click", onPageClick);
  state.pageSvg.addEventListener("pointerdown", onPagePointerDown);
  state.pageSvg.addEventListener("pointermove", onPagePointerMove);
  state.pageSvg.addEventListener("pointerleave", () => setHovered(null));
  state.pageSvg.style.userSelect = "none";

  const box = readViewBox(state.pageSvg);
  state.viewBox = box;
  state.pageSvg.setAttribute("width", box.width);
  state.pageSvg.setAttribute("height", box.height);
  els.overlay.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
  els.overlay.setAttribute("width", box.width);
  els.overlay.setAttribute("height", box.height);
  els.pageWrap.style.width = `${box.width}px`;
  els.pageWrap.style.height = `${box.height}px`;
  resetView();

  updateControls();
  drawOverlay();
  updateOutput();
}

function readViewBox(svg) {
  const parts = svg.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  if (parts?.length === 4 && parts.every(Number.isFinite)) {
    return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
  }

  return {
    x: 0,
    y: 0,
    width: readLength(svg.getAttribute("width")) || 612,
    height: readLength(svg.getAttribute("height")) || 792
  };
}

function readLength(value) {
  return Number(String(value || "").replace(/[a-z%]+$/i, ""));
}

function onPagePointerDown(event) {
  if (state.mode === "select" && event.button === 0) {
    const target = traceableElement(event.target);
    if (target) event.preventDefault();
  }
}

function onPagePointerMove(event) {
  if (state.mode === "select" || state.mode === "calibrate") {
    setHovered(traceableElement(event.target));
  } else {
    setHovered(null);
  }
}

function onPageClick(event) {
  if (state.mode === "calibrate") {
    const target = traceableElement(event.target);
    state.calibration[state.marker] = target ? elementCenterToSvg(target) : eventToSvgPoint(event);
    advanceMarker();
    drawOverlay();
    updateOutput();
    return;
  }

  if (state.mode !== "select") return;

  const target = traceableElement(event.target);
  if (!target) return;

  if (state.selected.includes(target)) {
    target.classList.remove("digitizer-selected");
    state.selected = state.selected.filter(item => item !== target);
  } else {
    if (!event.shiftKey) {
      clearSelection();
    }
    target.classList.add("digitizer-selected");
    state.selected.push(target);
  }

  drawOverlay();
  updateOutput();
}

function setHovered(element) {
  if (state.hovered === element) return;
  state.hovered?.classList.remove("digitizer-hover");
  state.hovered = element;
  state.hovered?.classList.add("digitizer-hover");
}

function traceableElement(node) {
  while (node && node !== state.pageSvg) {
    if (
      typeof node.getTotalLength === "function" &&
      !node.closest("defs") &&
      !node.closest("clipPath")
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function eventToSvgPoint(event) {
  const matrix = state.pageSvg.getScreenCTM().inverse();
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
  return { x: point.x, y: point.y };
}

function clearSelection() {
  state.selected.forEach(node => node.classList.remove("digitizer-selected"));
  state.selected = [];
}

function onSelectedListClick(event) {
  const button = event.target.closest("[data-remove-path]");
  if (!button) return;

  const index = Number(button.dataset.removePath);
  const element = state.selected[index];
  if (!element) return;

  element.classList.remove("digitizer-selected");
  state.selected.splice(index, 1);
  drawOverlay();
  updateOutput();
}

function advanceMarker() {
  const order = ["x1", "x2", "y1", "y2"];
  const index = order.indexOf(state.marker);
  state.marker = order[(index + 1) % order.length];
  updateMarkerButtons();
}

function setMode(mode) {
  state.mode = mode;
  els.panMode.classList.toggle("active", mode === "pan");
  els.selectMode.classList.toggle("active", mode === "select");
  els.calibrateMode.classList.toggle("active", mode === "calibrate");
  els.viewport.classList.toggle("pan-ready", mode === "pan");
  setHovered(null);
}

function updateMarkerButtons() {
  document.querySelectorAll("[data-marker]").forEach(button => {
    button.classList.toggle("active", button.dataset.marker === state.marker);
  });
}

function setZoom(zoom) {
  zoomAt(zoom, viewportCenter());
  updateControls();
}

function onViewportWheel(event) {
  if (!state.pageSvg) return;

  event.preventDefault();
  const factor = Math.exp(-event.deltaY * 0.0015);
  zoomAt(state.zoom * factor, { x: event.clientX, y: event.clientY });
  updateControls();
}

function onViewportPointerDown(event) {
  if (state.mode !== "pan" || event.button !== 0) return;

  state.panning = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    panX: state.pan.x,
    panY: state.pan.y
  };
  els.viewport.setPointerCapture(event.pointerId);
  els.viewport.classList.add("panning");
  event.preventDefault();
}

function onViewportPointerMove(event) {
  if (!state.panning || event.pointerId !== state.panning.pointerId) return;

  state.pan.x = state.panning.panX + event.clientX - state.panning.startX;
  state.pan.y = state.panning.panY + event.clientY - state.panning.startY;
  applyViewportTransform();
}

function endPan(event) {
  if (!state.panning || event.pointerId !== state.panning.pointerId) return;

  if (els.viewport.hasPointerCapture(event.pointerId)) {
    els.viewport.releasePointerCapture(event.pointerId);
  }
  state.panning = null;
  els.viewport.classList.remove("panning");
}

function resetView() {
  const rect = els.viewport.getBoundingClientRect();
  const pad = 32;
  const fit = Math.min(
    (rect.width - pad * 2) / state.viewBox.width,
    (rect.height - pad * 2) / state.viewBox.height,
    1
  );
  state.zoom = Math.max(0.25, fit);
  state.pan.x = Math.max(pad, (rect.width - state.viewBox.width * state.zoom) / 2);
  state.pan.y = Math.max(pad, (rect.height - state.viewBox.height * state.zoom) / 2);
  applyViewportTransform();
}

function viewportCenter() {
  const rect = els.viewport.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function zoomAt(zoom, clientPoint) {
  const nextZoom = Math.min(32, Math.max(0.15, zoom));
  const rect = els.viewport.getBoundingClientRect();
  const vx = clientPoint.x - rect.left;
  const vy = clientPoint.y - rect.top;
  const pageX = (vx - state.pan.x) / state.zoom;
  const pageY = (vy - state.pan.y) / state.zoom;

  state.zoom = nextZoom;
  state.pan.x = vx - pageX * state.zoom;
  state.pan.y = vy - pageY * state.zoom;
  applyViewportTransform();
}

function applyViewportTransform() {
  els.pageWrap.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
}

function updateControls() {
  els.pageInput.value = state.page;
  els.pageCount.textContent = `/ ${state.pages || 0}`;
  els.prevPage.disabled = state.page <= 1;
  els.nextPage.disabled = !state.pages || state.page >= state.pages;
  els.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function drawOverlay() {
  const markers = Object.entries(state.calibration)
    .filter(([, point]) => point)
    .map(([key, point]) => markerSvg(key.toUpperCase(), point))
    .join("");
  const traces = state.selected
    .map(element => {
      const points = sampleGeometry(element, Number(els.sampleStep.value) || 0.5, false);
      const text = points.map(point => `${point.x},${point.y}`).join(" ");
      return `<polyline class="trace-line" points="${text}"></polyline>`;
    })
    .join("");

  els.overlay.innerHTML = `${traces}${markers}`;
}

function markerSvg(label, point) {
  const x = escapeAttr(point.x);
  const y = escapeAttr(point.y);
  return `
    <circle class="marker-dot" cx="${x}" cy="${y}" r="4"></circle>
    <text class="marker-label" x="${x}" y="${y}" dx="6" dy="-6">${label}</text>
  `;
}

function sampleGeometry(element, step, convertToData) {
  const length = element.getTotalLength();
  if (!Number.isFinite(length) || length <= 0) return [];

  const count = Math.max(2, Math.ceil(length / Math.max(step, 0.05)) + 1);
  const points = [];

  for (let index = 0; index < count; index += 1) {
    const distance = index === count - 1 ? length : Math.min(length, index * step);
    const local = element.getPointAtLength(distance);
    const root = elementPointToSvg(element, local);
    points.push(convertToData ? svgToData(root) : root);
  }

  return points.filter(Boolean);
}

function elementPointToSvg(element, point) {
  const elementMatrix = element.getScreenCTM();
  const rootMatrix = state.pageSvg.getScreenCTM();
  const rootPoint = new DOMPoint(point.x, point.y)
    .matrixTransform(elementMatrix)
    .matrixTransform(rootMatrix.inverse());

  return { x: rootPoint.x, y: rootPoint.y };
}

function elementCenterToSvg(element) {
  const box = element.getBBox();
  return elementPointToSvg(element, {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  });
}

function svgToData(point) {
  const calibration = readCalibration();
  if (!calibration) return null;

  const tx = projection(point, calibration.x1.point, calibration.x2.point);
  const ty = projection(point, calibration.y1.point, calibration.y2.point);

  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;

  return {
    x: invertScale(lerp(calibration.x1.scaled, calibration.x2.scaled, tx), calibration.xScale),
    y: invertScale(lerp(calibration.y1.scaled, calibration.y2.scaled, ty), calibration.yScale)
  };
}

function readCalibration() {
  const points = state.calibration;
  if (!points.x1 || !points.x2 || !points.y1 || !points.y2) return null;

  const xScale = els.xScale.value;
  const yScale = els.yScale.value;
  const x1 = scaleValue(Number(els.x1Value.value), xScale);
  const x2 = scaleValue(Number(els.x2Value.value), xScale);
  const y1 = scaleValue(Number(els.y1Value.value), yScale);
  const y2 = scaleValue(Number(els.y2Value.value), yScale);

  if (![x1, x2, y1, y2].every(Number.isFinite)) return null;

  return {
    xScale,
    yScale,
    x1: { point: points.x1, scaled: x1 },
    x2: { point: points.x2, scaled: x2 },
    y1: { point: points.y1, scaled: y1 },
    y2: { point: points.y2, scaled: y2 }
  };
}

function scaleValue(value, scale) {
  if (!Number.isFinite(value)) return Number.NaN;
  return scale === "log10" ? Math.log10(value) : value;
}

function invertScale(value, scale) {
  return scale === "log10" ? 10 ** value : value;
}

function projection(point, start, end) {
  const vx = end.x - start.x;
  const vy = end.y - start.y;
  const denom = vx * vx + vy * vy;
  return denom === 0 ? Number.NaN : ((point.x - start.x) * vx + (point.y - start.y) * vy) / denom;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function collectData() {
  const calibration = readCalibration();
  if (!calibration) return [];

  const step = Number(els.sampleStep.value) || 0.5;
  const rawData = state.selected.flatMap(element => sampleGeometry(element, step, true));
  const xMin = optionalNumber(els.xMin.value);
  const xMax = optionalNumber(els.xMax.value);
  const targetPoints = Math.floor(Number(els.outputPoints.value));

  let data = rawData.filter(point => inXRange(point, xMin, xMax));

  if (targetPoints >= 2) {
    data = resampleByX(rawData, targetPoints, xMin, xMax);
  }

  if (els.pointOrder.value === "x") {
    data.sort((a, b) => a.x - b.x);
  }

  return data;
}

function optionalNumber(value) {
  if (String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function inXRange(point, xMin, xMax) {
  if (xMin !== null && point.x < xMin) return false;
  if (xMax !== null && point.x > xMax) return false;
  return true;
}

function resampleByX(data, count, xMin, xMax) {
  const sorted = data
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x);

  if (sorted.length < 2) return [];

  const start = xMin ?? sorted[0].x;
  const end = xMax ?? sorted[sorted.length - 1].x;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return [];

  const points = [];
  for (let index = 0; index < count; index += 1) {
    const x = lerp(start, end, index / (count - 1));
    const y = interpolateY(sorted, x);
    if (y !== null) {
      points.push({ x, y });
    }
  }
  return points;
}

function interpolateY(sorted, x) {
  if (x < sorted[0].x || x > sorted[sorted.length - 1].x) return null;

  for (let index = 1; index < sorted.length; index += 1) {
    const left = sorted[index - 1];
    const right = sorted[index];
    if (x > right.x) continue;

    if (right.x === left.x) {
      return right.y;
    }
    return lerp(left.y, right.y, (x - left.x) / (right.x - left.x));
  }

  return sorted[sorted.length - 1].y;
}

function buildExport() {
  const data = collectData();
  const format = els.outputFormat.value;

  if (format === "csv") {
    const lines = ["x,y"];
    data.forEach(point => lines.push(`${formatNumber(point.x)},${formatNumber(point.y)}`));
    return {
      text: `${lines.join("\n")}\n`,
      count: data.length,
      filename: "digitized.csv",
      mime: "text/csv"
    };
  }

  const lines = data.map(point => `${formatDatNumber(point.x)} ${formatDatNumber(point.y)}`);
  return {
    text: `${lines.join("\n")}\n`,
    count: data.length,
    filename: "digitized.dat",
    mime: "text/plain"
  };
}

function updateOutput() {
  const { text, count } = buildExport();
  els.selectedCount.textContent = `${state.selected.length} ${state.selected.length === 1 ? "path" : "paths"}`;
  els.pointCount.textContent = `${count} ${count === 1 ? "point" : "points"}`;
  els.selectedList.innerHTML = state.selected.map(selectedRow).join("");
  els.exportButton.textContent = `Export ${els.outputFormat.value.toUpperCase()}`;
  els.csvPreview.value = count ? text : "";
  drawOverlay();
}

function selectedRow(element, index) {
  return `
    <div class="selected-row">
      <span>Path ${index + 1} - ${formatNumber(element.getTotalLength())} pt</span>
      <button type="button" data-remove-path="${index}">Remove</button>
    </div>
  `;
}

function exportCsv() {
  const { text, count, filename, mime } = buildExport();
  if (!count) return;

  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatNumber(value) {
  return Number.isFinite(value) ? Number(value).toPrecision(12) : "";
}

function formatDatNumber(value) {
  return Number.isFinite(value) ? Number(value).toExponential(12) : "";
}

function escapeAttr(value) {
  return String(value).replace(/"/g, "&quot;");
}

async function readJson(response) {
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}
