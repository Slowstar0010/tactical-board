const SVG_NS = "http://www.w3.org/2000/svg";
const board = document.getElementById("board");
const objectsLayer = document.getElementById("objects");
const selectionLayer = document.getElementById("selectionLayer");
const previewLayer = document.getElementById("previewLayer");

let tool = "select", activeColor = "#2563eb", nextId = 1, interaction = null;
let selectedIds = [];
let history = [], historyIndex = -1;
const state = { name: "작전 브리핑", objects: [] };

// 캔버스 카메라 (Pan & Zoom) 상태
let camera = { x: 0, y: 0, w: 1600, h: 1000 };
let isPanning = false;
let panStart = { x: 0, y: 0 };
let spacePressed = false;
let gridBgRect = null;

// 웹 브라우저 전체 우클릭 메뉴(콘텍스트 메뉴) 차단
document.addEventListener("contextmenu", e => e.preventDefault());

// 무한 격자 패턴 초기화
function initGridPattern() {
  let defs = board.querySelector("defs");
  if (!defs) {
    defs = svgEl("defs");
    board.insertBefore(defs, board.firstChild);
  }

  board.querySelectorAll("rect").forEach(r => {
    const id = r.getAttribute("id");
    if (id !== "infiniteGridBg") {
      const w = Number(r.getAttribute("width")) || 0;
      const h = Number(r.getAttribute("height")) || 0;
      if (w >= 1000 || h >= 800 || r.getAttribute("stroke") || r.getAttribute("fill") === "none") {
        r.remove();
      }
    }
  });

  const oldPattern = document.getElementById("infiniteGridPattern");
  if (oldPattern) oldPattern.remove();
  const oldBg = document.getElementById("infiniteGridBg");
  if (oldBg) oldBg.remove();

  const pattern = svgEl("pattern", {
    id: "infiniteGridPattern",
    width: "40",
    height: "40",
    patternUnits: "userSpaceOnUse"
  });

  const path = svgEl("path", {
    d: "M 40 0 L 0 0 0 40",
    fill: "none",
    stroke: "#e5e7eb",
    "stroke-width": "1"
  });
  pattern.appendChild(path);
  defs.appendChild(pattern);

  gridBgRect = svgEl("rect", {
    id: "infiniteGridBg",
    fill: "url(#infiniteGridPattern)"
  });
  board.insertBefore(gridBgRect, defs.nextSibling);
}

function updateViewBox() {
  board.setAttribute("viewBox", `${camera.x} ${camera.y} ${camera.w} ${camera.h}`);
  
  if (gridBgRect) {
    gridBgRect.setAttribute("x", camera.x);
    gridBgRect.setAttribute("y", camera.y);
    gridBgRect.setAttribute("width", camera.w);
    gridBgRect.setAttribute("height", camera.h);
  }

  const zoomPercent = Math.round((1600 / camera.w) * 100);
  const zoomEl = document.getElementById("zoomValue");
  if (zoomEl) zoomEl.textContent = zoomPercent + "%";
}

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "textContent") e.textContent = v;
    else e.setAttribute(k, v);
  }
  return e;
}

function snapshot() { return JSON.stringify(state); }

// 💾 변경사항 발생 시 히스토리 기록 + 로컬스토리지 자동 저장
function commit() {
  history = history.slice(0, historyIndex + 1);
  history.push(snapshot());
  historyIndex++;
  if (history.length > 80) { history.shift(); historyIndex--; }

  // 로컬스토리지 자동 저장 (Auto-Save)
  try {
    localStorage.setItem("airsoft-tactical-board-v2", snapshot());
  } catch (e) {
    console.error("로컬스토리지 자동 저장 실패:", e);
  }
}

function getNextPlayerNumber() {
  const nums = state.objects
    .filter(o => o.type === "player" && o.color !== "#dc2626" && !isNaN(parseInt(o.number)))
    .map(o => parseInt(o.number));
  return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

function restore(s) {
  const x = JSON.parse(s);
  state.name = x.name || "작전 브리핑";
  state.objects = x.objects || [];
  nextId = Math.max(0, ...state.objects.map(o => o.id)) + 1;
  const nameEl = document.getElementById("scenarioName");
  if (nameEl) nameEl.value = state.name;
  selectedIds = [];
  render();
}

function undo() { if (historyIndex > 0) { historyIndex--; restore(history[historyIndex]); } }
function redo() { if (historyIndex < history.length - 1) { historyIndex++; restore(history[historyIndex]); } }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function pt(e) {
  const p = board.createSVGPoint();
  p.x = e.clientX;
  p.y = e.clientY;
  return p.matrixTransform(board.getScreenCTM().inverse());
}

function setTool(t) {
  if (interaction?.mode === "place") {
    previewLayer.innerHTML = "";
    interaction = null;
  }
  tool = t;
  document.querySelectorAll(".tool").forEach(b => b.classList.toggle("active", b.dataset.tool === t));
}

document.querySelectorAll(".tool").forEach(b => b.onclick = () => setTool(b.dataset.tool));
document.querySelectorAll(".color").forEach(b => b.onclick = () => {
  activeColor = b.dataset.color;
  document.querySelectorAll(".color").forEach(x => x.classList.remove("selected"));
  b.classList.add("selected");
});

function addObject(type, x, y) {
  const o = { id: nextId++, type, x, y };
  if (type === "player") {
    const isEnemy = activeColor === "#dc2626";
    Object.assign(o, {
      color: activeColor,
      label: isEnemy ? "적군" : "플레이어",
      number: isEnemy ? "" : String(getNextPlayerNumber()),
      r: 25
    });
  }
  if (type === "direction") Object.assign(o, { color: activeColor, angle: 0, length: 120, width: 70 });
  if (type === "arrow") Object.assign(o, { color: activeColor, length: 120, angle: 0, headSize: 40 });
  if (type === "text") Object.assign(o, { text: "설명", size: 24, color: activeColor });
  if (type === "obstacle") Object.assign(o, { w: 160, h: 80 });
  
  state.objects.push(o);
  selectedIds = [o.id];
  render();
  commit();
  if (type === "text") openText(o);
  return o;
}

function deleteObject(id) {
  state.objects = state.objects.filter(o => o.id !== id);
  selectedIds = selectedIds.filter(i => i !== id);
  render();
  commit();
}

function arrowEnd(o) {
  const r = o.angle * Math.PI / 180;
  return { x: o.x + o.length * Math.cos(r), y: o.y + o.length * Math.sin(r) };
}

function drawArrowShape(container, startPt, endPt, angle, color) {
  const headLen = 40;
  const headWidth = 32;

  const rad = angle * Math.PI / 180;
  const lineEndX = endPt.x - (headLen * 0.5) * Math.cos(rad);
  const lineEndY = endPt.y - (headLen * 0.5) * Math.sin(rad);

  const line = svgEl("line", { 
    x1: startPt.x, y1: startPt.y, x2: lineEndX, y2: lineEndY, 
    class: "arrow-line", 
    stroke: color,
    "stroke-width": "5",
    "stroke-dasharray": "8 6",
    "stroke-linecap": "round",
    style: `marker-end: none !important;`
  });
  container.appendChild(line);

  const headGroup = svgEl("g", { transform: `translate(${endPt.x} ${endPt.y}) rotate(${angle})` });
  headGroup.appendChild(svgEl("polygon", {
    points: `0,0 ${-headLen},${-headWidth / 2} ${-headLen * 0.75},0 ${-headLen},${headWidth / 2}`,
    fill: color
  }));
  container.appendChild(headGroup);
}

function render() {
  objectsLayer.innerHTML = ""; previewLayer.innerHTML = ""; selectionLayer.innerHTML = "";
  for (const o of state.objects) {
    const g = svgEl("g", { class: "tactical-object", "data-id": o.id });
    if (o.type === "player") {
      g.appendChild(svgEl("circle", { cx: o.x, cy: o.y, r: o.r, fill: o.color, stroke: "#fff", "stroke-width": 3 }));
      if (o.number) {
        g.appendChild(svgEl("text", { x: o.x, y: o.y, "class": "player-number", textContent: o.number }));
      }
      g.appendChild(svgEl("text", { x: o.x, y: o.y + o.r + 16, "class": "player-label", textContent: o.label }));
    } else if (o.type === "direction") {
      const q = svgEl("g", { transform: `translate(${o.x} ${o.y}) rotate(${o.angle})` });
      const w = o.width || 70;
      const l = o.length || 120;
      q.appendChild(svgEl("path", { 
        d: `M 0 0 L ${l} ${-w / 2} Q ${l + (w * 0.35)} 0 ${l} ${w / 2} Z`, 
        fill: o.color, opacity: .22, stroke: o.color, "stroke-width": 3 
      }));
      q.appendChild(svgEl("line", { x1: 0, y1: 0, x2: l, y2: 0, class: "direction-line", stroke: o.color, "style": `color:${o.color}` }));
      g.appendChild(q);
    } else if (o.type === "arrow") {
      const e = arrowEnd(o);
      drawArrowShape(g, { x: o.x, y: o.y }, e, o.angle, o.color);
    } else if (o.type === "text") {
      g.appendChild(svgEl("text", { 
        x: o.x, 
        y: o.y, 
        class: "text-label", 
        "font-size": o.size, 
        "text-anchor": "middle",
        "dominant-baseline": "central",
        fill: o.color || "#1e293b",
        textContent: o.text 
      }));
    } else if (o.type === "obstacle") {
      g.appendChild(svgEl("rect", { x: o.x - o.w / 2, y: o.y - o.h / 2, width: o.w, height: o.h, rx: 8, fill: "#d1d5db", stroke: "#4b5563", "stroke-width": 3 }));
    }
    
    g.onpointerdown = objectDown;
    g.ondblclick = () => openText(o);
    objectsLayer.appendChild(g);
  }

  drawSelections();
}

function bounds(o) {
  if (o.type === "player") return { x: o.x - o.r, y: o.y - o.r, w: o.r * 2, h: o.r * 2 };
  if (o.type === "obstacle") return { x: o.x - o.w / 2, y: o.y - o.h / 2, w: o.w, h: o.h };
  
  if (o.type === "text") { 
    const str = o.text || "설명";
    const approxWidth = Math.max(30, str.length * (o.size * 0.7));
    const approxHeight = o.size * 1.2;
    return { 
      x: o.x - approxWidth / 2, 
      y: o.y - approxHeight / 2, 
      w: approxWidth, 
      h: approxHeight 
    }; 
  }

  if (o.type === "arrow") { 
    const e = arrowEnd(o); 
    return { x: Math.min(o.x, e.x) - 20, y: Math.min(o.y, e.y) - 20, w: Math.abs(e.x - o.x) + 40, h: Math.abs(e.y - o.y) + 40 }; 
  }
  if (o.type === "direction") {
    const r = o.angle * Math.PI / 180;
    const x2 = o.x + o.length * Math.cos(r), y2 = o.y + o.length * Math.sin(r);
    const minX = Math.min(o.x, x2) - (o.width || 70) / 2, minY = Math.min(o.y, y2) - (o.width || 70) / 2;
    return { x: minX, y: minY, w: Math.abs(x2 - o.x) + (o.width || 70), h: Math.abs(y2 - o.y) + (o.width || 70) };
  }
  return { x: o.x - 20, y: o.y - 20, w: 40, h: 40 };
}

function createDeleteButton(cx, cy, id) {
  const btnGroup = svgEl("g", { 
    class: "delete-btn-group", 
    style: "cursor: pointer; pointer-events: all;" 
  });
  
  const targetX = cx + 18;
  const targetY = cy - 22;

  const bg = svgEl("circle", { cx: targetX, cy: targetY, r: 12, fill: "#ef4444", stroke: "#ffffff", "stroke-width": 2 });
  const xText = svgEl("text", {
    x: targetX, y: targetY + 4,
    fill: "#ffffff",
    "font-size": "13",
    "font-weight": "900",
    "text-anchor": "middle",
    "pointer-events": "none",
    textContent: "✕"
  });

  btnGroup.appendChild(bg);
  btnGroup.appendChild(xText);

  const handleDelete = e => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    deleteObject(id);
  };

  btnGroup.addEventListener("pointerdown", handleDelete, true);
  btnGroup.addEventListener("click", handleDelete, true);

  return btnGroup;
}

function drawSelections() {
  const selectedObjs = state.objects.filter(o => selectedIds.includes(o.id));
  if (selectedObjs.length === 0) return;

  if (selectedObjs.length === 1) {
    const o = selectedObjs[0];
    const b = bounds(o), pad = 12;
    selectionLayer.appendChild(svgEl("rect", { x: b.x - pad, y: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, class: "selection-box" }));
    
    const corners = [
      [b.x - pad, b.y - pad, "nw"], [b.x + b.w + pad, b.y - pad, "ne"],
      [b.x - pad, b.y + b.h + pad, "sw"], [b.x + b.w + pad, b.y + b.h + pad, "se"]
    ];
    corners.forEach(([x, y, pos]) => {
      const h = svgEl("rect", { x: x - 6, y: y - 6, width: 12, height: 12, class: "resize-handle", "data-handle": pos });
      h.onpointerdown = e => startResize(e, o, pos);
      selectionLayer.appendChild(h);
    });

    const cx = b.x + b.w / 2, cy = b.y - pad - 35;
    selectionLayer.appendChild(svgEl("line", { x1: cx, y1: b.y - pad, x2: cx, y2: cy, class: "rotate-line" }));
    const rh = svgEl("circle", { cx, cy, r: 8, class: "rotate-handle" });
    rh.onpointerdown = e => startRotate(e, o);
    selectionLayer.appendChild(rh);

    const delBtn = createDeleteButton(b.x + b.w + pad, b.y - pad, o.id);
    selectionLayer.appendChild(delBtn);
  } else {
    selectedObjs.forEach(o => {
      const b = bounds(o), pad = 8;
      selectionLayer.appendChild(svgEl("rect", {
        x: b.x - pad, y: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2,
        class: "selection-box",
        style: "stroke-dasharray: 4 4;"
      }));

      const delBtn = createDeleteButton(b.x + b.w + pad, b.y - pad, o.id);
      selectionLayer.appendChild(delBtn);
    });
  }
}

function objectAt(p) {
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const o = state.objects[i], b = bounds(o);
    if (p.x >= b.x - 10 && p.x <= b.x + b.w + 10 && p.y >= b.y - 10 && p.y <= b.y + b.h + 10) return o;
  }
  return null;
}

function objectDown(e) {
  if (e.button === 2 || spacePressed) return;
  e.stopPropagation();
  if (tool !== "select") return;
  
  const o = state.objects.find(x => x.id === Number(e.currentTarget.dataset.id));
  if (!o) return;

  if (!selectedIds.includes(o.id)) {
    selectedIds = [o.id];
    render();
  }

  const p = pt(e);
  const originals = state.objects
    .filter(obj => selectedIds.includes(obj.id))
    .map(obj => ({ id: obj.id, x: obj.x, y: obj.y }));

  interaction = { mode: "move", start: p, originals, changed: false };
  e.currentTarget.setPointerCapture?.(e.pointerId);
}

function startResize(e, o, handle) {
  e.stopPropagation(); e.preventDefault();
  const p = pt(e);
  interaction = { mode: "resize", id: o.id, handle, start: p, original: JSON.parse(JSON.stringify(o)), changed: false };
}

function startRotate(e, o) {
  e.stopPropagation(); e.preventDefault();
  const p = pt(e);
  interaction = { mode: "rotate", id: o.id, start: p, original: JSON.parse(JSON.stringify(o)), changed: false };
}

function updateInteraction(p) {
  if (interaction.mode === "move") {
    const dx = p.x - interaction.start.x;
    const dy = p.y - interaction.start.y;
    interaction.changed = true;

    interaction.originals.forEach(org => {
      const obj = state.objects.find(o => o.id === org.id);
      if (obj) {
        obj.x = org.x + dx;
        obj.y = org.y + dy;
      }
    });
  } else if (interaction.mode === "rotate") {
    const o = state.objects.find(x => x.id === interaction.id); if (!o) return;
    interaction.changed = true;
    o.angle = Math.atan2(p.y - o.y, p.x - o.x) * 180 / Math.PI;
  } else if (interaction.mode === "resize") {
    const o = state.objects.find(x => x.id === interaction.id); if (!o) return;
    const org = interaction.original; interaction.changed = true;
    const dx = p.x - interaction.start.x, dy = p.y - interaction.start.y, h = interaction.handle;

    if (o.type === "direction" || o.type === "arrow") {
      const rad = -(org.angle || 0) * Math.PI / 180;
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad);

      const lengthChange = h.includes("e") ? lx : -lx;
      const widthChange = h.includes("s") ? ly : -ly;

      o.length = Math.max(30, org.length + lengthChange);
      if (o.type === "direction") {
        o.width = Math.max(20, (org.width || 70) + widthChange * 1.5);
      }
    } else if (o.type === "player") {
      o.r = clamp(org.r + (h.includes("e") ? dx : -dx), 12, 500);
    } else if (o.type === "obstacle") {
      let w = org.w, hv = org.h, nx = org.x, ny = org.y;
      if (h.includes("e")) w = Math.max(30, org.w + dx);
      if (h.includes("w")) { w = Math.max(30, org.w - dx); nx = org.x + (org.w - w) / 2; }
      if (h.includes("s")) hv = Math.max(30, org.h + dy);
      if (h.includes("n")) { hv = Math.max(30, org.h - dy); ny = org.y + (org.h - hv) / 2; }
      Object.assign(o, { w, h: hv, x: nx, y: ny });
    } else if (o.type === "text") {
      const delta = (h.includes("e") ? dx : -dx) + (h.includes("s") ? dy : -dy);
      o.size = clamp(org.size + delta * 0.4, 12, 200);
    }
  }
  render();
}

function makePreview(type, p1, p2) {
  previewLayer.innerHTML = "";
  const dist = Math.max(30, Math.hypot(p2.x - p1.x, p2.y - p1.y));
  const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
  const o = { x: p1.x, y: p1.y, angle, length: dist, width: Math.max(25, dist * 0.58), color: activeColor };
  const g = svgEl("g", { class: "preview" });

  if (type === "direction") {
    const q = svgEl("g", { transform: `translate(${o.x} ${o.y}) rotate(${o.angle})` });
    q.appendChild(svgEl("path", { d: `M 0 0 L ${o.length} ${-o.width / 2} Q ${o.length + (o.width * 0.35)} 0 ${o.length} ${o.width / 2} Z`, fill: o.color, opacity: .22, stroke: o.color, "stroke-width": 3 }));
    q.appendChild(svgEl("line", { x1: 0, y1: 0, x2: o.length, y2: 0, class: "direction-line", stroke: o.color, "style": `color:${o.color}` }));
    g.appendChild(q);
  } else if (type === "arrow") {
    drawArrowShape(g, p1, p2, angle, o.color);
  }
  previewLayer.appendChild(g);
}

function updateDragBox(p1, p2) {
  previewLayer.innerHTML = "";
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const w = Math.abs(p1.x - p2.x);
  const h = Math.abs(p1.y - p2.y);

  const rect = svgEl("rect", {
    x, y, width: w, height: h,
    fill: "rgba(37, 99, 235, 0.15)",
    stroke: "#2563eb",
    "stroke-width": "1.5",
    "stroke-dasharray": "4 4"
  });
  previewLayer.appendChild(rect);
}

board.addEventListener("pointerdown", e => {
  if (e.button === 2 || spacePressed) {
    e.preventDefault();
    isPanning = true;
    panStart = { x: e.clientX, y: e.clientY };
    board.style.cursor = "grabbing";
    board.setPointerCapture?.(e.pointerId);
    return;
  }

  if (e.target.closest(".delete-btn-group")) return;
  if (e.target.closest("#selectionLayer") && !e.target.classList.contains("selection-box")) return;
  
  const p = pt(e);

  if (interaction?.mode === "place") {
    const start = interaction.anchor;
    const end = p;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    
    if (Math.hypot(dx, dy) >= 15) {
      const o = addObject(interaction.type, start.x, start.y);
      o.angle = Math.atan2(dy, dx) * 180 / Math.PI;
      o.length = Math.max(30, Math.hypot(dx, dy));
      o.width = Math.max(25, o.length * 0.58);
      commit();
    }
    
    previewLayer.innerHTML = "";
    interaction = null;
    render();
    return;
  }

  if (tool === "select") {
    const o = objectAt(p);
    if (o) {
      if (!selectedIds.includes(o.id)) {
        selectedIds = [o.id];
        render();
      }
      const originals = state.objects
        .filter(obj => selectedIds.includes(obj.id))
        .map(obj => ({ id: obj.id, x: obj.x, y: obj.y }));
      interaction = { mode: "move", start: p, originals, changed: false };
    } else {
      selectedIds = [];
      render();
      interaction = { mode: "boxSelect", start: p, current: p };
    }
    return;
  }

  if (tool === "direction" || tool === "arrow") {
    interaction = { mode: "place", type: tool, anchor: p, current: p };
    makePreview(tool, p, p);
    return;
  }

  if (tool === "player" || tool === "text" || tool === "obstacle") {
    addObject(tool, p.x, p.y);
  }
});

board.addEventListener("pointermove", e => {
  if (isPanning) {
    const rect = board.getBoundingClientRect();
    const dx = (e.clientX - panStart.x) * (camera.w / rect.width);
    const dy = (e.clientY - panStart.y) * (camera.h / rect.height);
    camera.x -= dx;
    camera.y -= dy;
    panStart = { x: e.clientX, y: e.clientY };
    updateViewBox();
    return;
  }

  const p = pt(e);
  if (interaction?.mode === "boxSelect") {
    interaction.current = p;
    updateDragBox(interaction.start, interaction.current);
  } else if (interaction?.mode === "place") {
    interaction.current = p;
    makePreview(interaction.type, interaction.anchor, interaction.current);
  } else if (interaction) {
    updateInteraction(p);
  }
});

board.addEventListener("pointerup", e => {
  if (isPanning) {
    isPanning = false;
    board.style.cursor = "default";
    board.releasePointerCapture?.(e.pointerId);
  }

  if (interaction?.mode === "boxSelect") {
    const p1 = interaction.start;
    const p2 = interaction.current;
    const xMin = Math.min(p1.x, p2.x);
    const xMax = Math.max(p1.x, p2.x);
    const yMin = Math.min(p1.y, p2.y);
    const yMax = Math.max(p1.y, p2.y);

    selectedIds = state.objects
      .filter(o => o.type === "player" && o.x >= xMin && o.x <= xMax && o.y >= yMin && o.y <= yMax)
      .map(o => o.id);

    previewLayer.innerHTML = "";
    interaction = null;
    render();
    return;
  }

  if (interaction && interaction.mode !== "place") {
    if (interaction.changed) commit();
    interaction = null;
    render();
  }
});

board.addEventListener("wheel", e => {
  e.preventDefault();
  const mousePt = pt(e);
  const zoomFactor = e.deltaY < 0 ? 0.9 : 1.1;
  
  const newW = camera.w * zoomFactor;
  const newH = camera.h * zoomFactor;

  camera.x = mousePt.x - (mousePt.x - camera.x) * zoomFactor;
  camera.y = mousePt.y - (mousePt.y - camera.y) * zoomFactor;
  camera.w = newW;
  camera.h = newH;

  updateViewBox();
}, { passive: false });

document.addEventListener("keydown", e => {
  if (e.code === "Space") spacePressed = true;

  if (e.key === "Escape" && interaction?.mode === "place") {
    previewLayer.innerHTML = "";
    interaction = null;
    render();
    return;
  }
  if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length > 0 && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    state.objects = state.objects.filter(o => !selectedIds.includes(o.id));
    selectedIds = [];
    render();
    commit();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
});

document.addEventListener("keyup", e => {
  if (e.code === "Space") spacePressed = false;
});

function openText(o) {
  const d = document.getElementById("textDialog");
  const numInput = document.getElementById("numberInput");
  const numGroup = document.getElementById("numberInputGroup");
  const i = document.getElementById("textInput");
  const okBtn = document.getElementById("textOk"), cancelBtn = document.getElementById("textCancel");
  
  if (o.type === "player") {
    if (numGroup) numGroup.style.display = "block";
    if (numInput) numInput.value = o.number || "";
    i.value = o.label || "";
  } else {
    if (numGroup) numGroup.style.display = "none";
    i.value = o.type === "text" ? (o.text || "") : (o.label || "");
  }
  
  d.classList.remove("hidden");
  i.focus();
  
  const close = (save) => {
    if (save) {
      if (o.type === "player") {
        o.number = numInput ? numInput.value.trim() : "";
        o.label = i.value;
      } else if (o.type === "text") {
        o.text = i.value || "설명";
      } else {
        o.label = i.value;
      }
      render();
      commit();
    }
    d.classList.add("hidden");
    okBtn.onclick = null;
    cancelBtn.onclick = null;
    i.onkeydown = null;
    if (numInput) numInput.onkeydown = null;
  };

  okBtn.onclick = () => close(true);
  cancelBtn.onclick = () => close(false);
  const handleKeyDown = e => {
    if (e.key === "Enter") close(true);
    if (e.key === "Escape") close(false);
  };
  i.onkeydown = handleKeyDown;
  if (numInput) numInput.onkeydown = handleKeyDown;
}

const undoBtn = document.getElementById("undoBtn");
if (undoBtn) undoBtn.onclick = undo;
const redoBtn = document.getElementById("redoBtn");
if (redoBtn) redoBtn.onclick = redo;

// 🧹 전술판 초기화 시 로컬스토리지 데이터도 깔끔히 제거
const clearBtn = document.getElementById("clearBtn");
if (clearBtn) {
  clearBtn.onclick = () => {
    if (confirm("전술판의 모든 객체를 삭제할까요?")) {
      state.objects = []; 
      selectedIds = []; 
      render(); 
      localStorage.removeItem("airsoft-tactical-board-v2");
      history = [snapshot()];
      historyIndex = 0;
      toast("전술판을 초기화했습니다.");
    }
  };
}

const scenarioNameEl = document.getElementById("scenarioName");
if (scenarioNameEl) {
  scenarioNameEl.oninput = e => state.name = e.target.value;
  scenarioNameEl.onchange = commit;
}

const saveBtn = document.getElementById("saveBtn");
if (saveBtn) {
  saveBtn.onclick = () => {
    try {
      localStorage.setItem("airsoft-tactical-board-v2", snapshot());
      toast("현재 전술판을 저장했습니다.");
    } catch (e) {
      toast("저장에 실패했습니다.");
    }
  };
}

// 📂 저장된 진행사항 자동으로 로드
function loadSaved() {
  const s = localStorage.getItem("airsoft-tactical-board-v2");
  if (s) {
    try { 
      restore(s); 
    } catch (e) {
      console.error("저장된 데이터 복원 실패:", e);
    }
  }
  history = [snapshot()];
  historyIndex = 0;
}

const zoomInBtn = document.getElementById("zoomIn");
if (zoomInBtn) {
  zoomInBtn.onclick = () => {
    camera.w *= 0.8; camera.h *= 0.8;
    updateViewBox();
  };
}
const zoomOutBtn = document.getElementById("zoomOut");
if (zoomOutBtn) {
  zoomOutBtn.onclick = () => {
    camera.w *= 1.25; camera.h *= 1.25;
    updateViewBox();
  };
}
const fitBtn = document.getElementById("fitBtn");
if (fitBtn) {
  fitBtn.onclick = () => {
    camera = { x: 0, y: 0, w: 1600, h: 1000 };
    updateViewBox();
  };
}

function toast(m) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = m;
  t.classList.add("show");
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => t.classList.remove("show"), 1600);
}

// 초기화 실행
initGridPattern();
updateViewBox();
loadSaved();