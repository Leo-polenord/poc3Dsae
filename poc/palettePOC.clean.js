// Clean, minimal `palettePOC.js` - single coherent implementation
'use strict';
// Palette packing (clean, minimal). Units: UI in cm, internal in meters.
const PALETTE_WIDTH = 80; // cm
const PALETTE_DEPTH = 120; // cm
const PALETTE_HEIGHT = 180; // cm
const toMeters = v => v / 100;

if (typeof THREE === 'undefined') throw new Error('THREE is required');

// Scene + renderer (minimal setup)
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);
const camera = new THREE.PerspectiveCamera(45, 600 / 400, 0.1, 1000);
camera.position.set(1, 2, 2);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(600, 400);
const mount = document.getElementById('palette-3d');
if (mount) mount.appendChild(renderer.domElement);
try { const Controls = THREE.OrbitControls || OrbitControls; const controls = new Controls(camera, renderer.domElement); controls.target.set(0, toMeters(PALETTE_HEIGHT/2), 0); controls.update(); } catch (e) {}
scene.add(new THREE.DirectionalLight(0xffffff, 1));
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

// Palette base
const paletteGeom = new THREE.BoxGeometry(toMeters(PALETTE_WIDTH), toMeters(5), toMeters(PALETTE_DEPTH));
const paletteMat = new THREE.MeshPhongMaterial({ color: 0xdeb887 });
const paletteMesh = new THREE.Mesh(paletteGeom, paletteMat);
paletteMesh.position.set(0, toMeters(2.5), 0);
scene.add(paletteMesh);

// State
const objects = [];
const layers = [];
const paletteHalfW = toMeters(PALETTE_WIDTH) / 2;
const paletteHalfD = toMeters(PALETTE_DEPTH) / 2;
const paletteTop = toMeters(5);
const paletteMaxTop = toMeters(PALETTE_HEIGHT);
// Minimum fraction of base area that must be supported by a single support rect
const MIN_SUPPORT = 1.0; // 1.0 = require full support within a single footprint

function createNewLayer(baseY, initialHeight) {
  return { baseY, height: initialHeight, freeRects: [{ minX: -paletteHalfW, minZ: -paletteHalfD, w: paletteHalfW * 2, d: paletteHalfD * 2 }] };
}
if (layers.length === 0) layers.push(createNewLayer(paletteTop, 0));

// Axis-aligned bounding-box intersection check against existing placed objects
function intersectsAny(x, y, z, w, d, h) {
  const minX = x - w / 2, maxX = x + w / 2;
  const minY = y - h / 2, maxY = y + h / 2;
  const minZ = z - d / 2, maxZ = z + d / 2;
  for (const obj of objects) {
    const ox = obj.position.x, oy = obj.position.y, oz = obj.position.z;
    const ow = obj.userData.width, od = obj.userData.depth, oh = obj.userData.height;
    const ominX = ox - ow / 2, omaxX = ox + ow / 2;
    const ominY = oy - oh / 2, omaxY = oy + oh / 2;
    const ominZ = oz - od / 2, omaxZ = oz + od / 2;
    if (maxX <= ominX || minX >= omaxX) continue;
    if (maxY <= ominY || minY >= omaxY) continue;
    if (maxZ <= ominZ || minZ >= omaxZ) continue;
    return true;
  }
  return false;
}

// Core placement: layer-based skyline + guillotine split (right/bottom)
function findPlacementInLayers(layersParam, w, d, h) {
  // Try existing layers first using MaxRects-like splitting per layer.
  for (let li = 0; li < layersParam.length; li++) {
    const layer = layersParam[li];
    const res = tryPlaceInLayer(layer, w, d, h);
    if (res) return Object.assign(res, { layerIndex: li });
  }
  // no space in existing layers -> try create new layer
  const currentTop = layersParam.reduce((acc, L) => Math.max(acc, L.baseY + L.height), paletteTop);
  if (currentTop + h > paletteMaxTop + 1e-9) return null;

  // Compute supported footprint at `currentTop`: positions where the underlying stacks
  // reach up to `currentTop` (otherwise a new layer there would float).
  // Extracted to helper so diagnostics can call it.
  function computeSupportedAtHeight(height) {
    const full = { minX: -paletteHalfW, minZ: -paletteHalfD, w: paletteHalfW * 2, d: paletteHalfD * 2 };
    let supported = [full];

    function rectsSubtract(rects, hole) {
      const out = [];
      for (const r of rects) {
        const rx1 = r.minX, rz1 = r.minZ, rx2 = rx1 + r.w, rz2 = rz1 + r.d;
        const hx1 = hole.minX, hz1 = hole.minZ, hx2 = hx1 + hole.w, hz2 = hz1 + hole.d;
        const ix1 = Math.max(rx1, hx1), iz1 = Math.max(rz1, hz1), ix2 = Math.min(rx2, hx2), iz2 = Math.min(rz2, hz2);
        if (ix2 <= ix1 || iz2 <= iz1) { out.push(r); continue; }
        if (ix1 > rx1) out.push({ minX: rx1, minZ: rz1, w: ix1 - rx1, d: r.d });
        if (ix2 < rx2) out.push({ minX: ix2, minZ: rz1, w: rx2 - ix2, d: r.d });
        if (iz1 > rz1) out.push({ minX: ix1, minZ: rz1, w: ix2 - ix1, d: iz1 - rz1 });
        if (iz2 < rz2) out.push({ minX: ix1, minZ: iz2, w: ix2 - ix1, d: rz2 - iz2 });
      }
      return out;
    }

    for (const L of layersParam) {
      const layerTop = L.baseY + L.height;
      if (layerTop + 1e-9 <= height) {
        for (const hole of L.freeRects) {
          supported = rectsSubtract(supported, hole);
          if (supported.length === 0) break;
        }
        if (supported.length === 0) break;
      }
    }
    return supported;
  }

  // Recompute supported area using the existing `layersParam.freeRects` (precise).
  const EPS = 1e-9;

  // Build supported rects from individual object footprints (no merging).
  // This is conservative: an item can only be placed entirely on top of a single
  // supporting footprint (object or the base). This avoids spanning support
  // across multiple objects with different heights which would cause floating
  // or interpenetration.
  function computeSupportedFromObjects(height) {
    const out = [];
    // Palette base counts as support only at paletteTop
    if (Math.abs(height - paletteTop) < 1e-9) {
      out.push({ minX: -paletteHalfW, minZ: -paletteHalfD, w: paletteHalfW * 2, d: paletteHalfD * 2 });
    }
    for (const obj of objects) {
      const top = obj.position.y + obj.userData.height / 2;
      if (top + EPS >= height) {
        out.push({ minX: obj.position.x - obj.userData.width / 2, minZ: obj.position.z - obj.userData.depth / 2, w: obj.userData.width, d: obj.userData.depth });
      }
    }
    return out;
  }

  // candidate heights: try object tops first (to stack), then the palette base
  const tops = new Set();
  for (const obj of objects) tops.add(obj.position.y + obj.userData.height / 2);
  const candHeights = Array.from(tops).sort((a, b) => a - b);
  if (!candHeights.includes(paletteTop)) candHeights.push(paletteTop);

  for (const baseH of candHeights) {
    if (baseH + h > paletteMaxTop + EPS) continue;
    const supportedRects = computeSupportedFromObjects(baseH);
    if (supportedRects.length === 0) continue;
    for (const r of supportedRects) {
      if (r.w + EPS >= w && r.d + EPS >= d) {
        const x = r.minX + w / 2;
        const z = r.minZ + d / 2;
        const y = baseH;
        // support-threshold: ensure single-support area covers enough base area
        const supportArea = r.w * r.d;
        const needArea = w * d * MIN_SUPPORT;
        if (supportArea + EPS < needArea) continue;
        const centerY = y + h / 2;
        if (intersectsAny(x, centerY, z, w, d, h)) continue;
        const rightW = r.w - w;
        const bottomD = r.d - d;
        const rightRect = rightW > EPS ? { minX: r.minX + w, minZ: r.minZ, w: rightW, d: d } : null;
        const bottomRect = bottomD > EPS ? { minX: r.minX, minZ: r.minZ + d, w: r.w, d: bottomD } : null;
        const newLayer = { baseY: baseH, height: h, freeRects: [] };
        if (bottomRect) newLayer.freeRects.push(bottomRect);
        if (rightRect) newLayer.freeRects.push(rightRect);
        layersParam.push(newLayer);
        return { x, y, z, layerIndex: layersParam.length - 1 };
      }
    }
  }

  return null;
}

// --- MaxRects-like helpers (lightweight) ---------------------------------
function scoreFreeRect(fr, w, d) {
  const areaFit = fr.w * fr.d - w * d;
  const shortSide = Math.min(Math.abs(fr.w - w), Math.abs(fr.d - d));
  return { areaFit, shortSide };
}

function splitFreeRectByPlaced(fr, placed) {
  const out = [];
  const rx1 = fr.minX, rz1 = fr.minZ, rx2 = rx1 + fr.w, rz2 = rz1 + fr.d;
  const px1 = placed.minX, pz1 = placed.minZ, px2 = px1 + placed.w, pz2 = pz1 + placed.d;
  if (px2 <= rx1 || px1 >= rx2 || pz2 <= rz1 || pz1 >= rz2) {
    // no overlap
    out.push(fr);
    return out;
  }
  // left
  if (px1 > rx1) out.push({ minX: rx1, minZ: rz1, w: px1 - rx1, d: fr.d });
  // right
  if (px2 < rx2) out.push({ minX: px2, minZ: rz1, w: rx2 - px2, d: fr.d });
  // top (front)
  if (pz1 > rz1) out.push({ minX: Math.max(rx1, px1), minZ: rz1, w: Math.min(rx2, px2) - Math.max(rx1, px1), d: pz1 - rz1 });
  // bottom (back)
  if (pz2 < rz2) out.push({ minX: Math.max(rx1, px1), minZ: pz2, w: Math.min(rx2, px2) - Math.max(rx1, px1), d: rz2 - pz2 });
  return out.filter(r => r.w > 1e-9 && r.d > 1e-9);
}

function pruneFreeRects(list) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const A = list[i], B = list[j];
      if (A.minX + A.w <= B.minX + 1e-12 && A.minZ + A.d <= B.minZ + 1e-12 && A.minX >= B.minX - 1e-12 && A.minZ >= B.minZ - 1e-12) {
        // A inside B
        list.splice(i, 1); i--; break;
      }
      if (B.minX + B.w <= A.minX + 1e-12 && B.minZ + B.d <= A.minZ + 1e-12 && B.minX >= A.minX - 1e-12 && B.minZ >= A.minZ - 1e-12) {
        // B inside A
        list.splice(j, 1); j--; continue;
      }
    }
  }
}

function tryPlaceInLayer(layer, w, d, h) {
  if (!layer.freeRects || layer.freeRects.length === 0) return null;
  // evaluate scores
  const candidates = [];
  for (let i = 0; i < layer.freeRects.length; i++) {
    const fr = layer.freeRects[i];
    if (fr.w + 1e-9 >= w && fr.d + 1e-9 >= d) {
      const s = scoreFreeRect(fr, w, d);
      candidates.push({ i, fr, s });
    }
  }
  if (candidates.length === 0) return null;
  // sort by areaFit asc (smaller waste), then shortSide asc
  candidates.sort((a, b) => {
    if (a.s.areaFit !== b.s.areaFit) return a.s.areaFit - b.s.areaFit;
    return a.s.shortSide - b.s.shortSide;
  });

  for (const cand of candidates) {
    const fr = cand.fr;
    const placedRect = { minX: fr.minX, minZ: fr.minZ, w: w, d: d };
    // position chosen at fr.minX, fr.minZ (top-left) — could try more positions later
    const x = placedRect.minX + w / 2;
    const z = placedRect.minZ + d / 2;
    const y = layer.baseY;
    const centerY = y + h / 2;
    if (intersectsAny(x, centerY, z, w, d, h)) {
      // try next candidate
      continue;
    }
    // commit: split the chosen free rect by the placedRect
    const newRects = splitFreeRectByPlaced(fr, placedRect);
    // remove the used free rect
    layer.freeRects.splice(cand.i, 1);
    // add new rects
    for (const nr of newRects) layer.freeRects.push(nr);
    // prune contained rects
    pruneFreeRects(layer.freeRects);
    layer.height = Math.max(layer.height || 0, h);
    return { x, y, z };
  }
  return null;
}

function findPlacement(w, d, h) { return findPlacementInLayers(layers, w, d, h); }

// Return unique axis-aligned orientations (w,d,h permutations) in meters
function getOrientations(w, d, h) {
  const perms = [];
  const seen = new Set();
  const arr = [w, d, h];
  const indices = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  for (const idx of indices) {
    const ow = arr[idx[0]], od = arr[idx[1]], oh = arr[idx[2]];
    const key = `${ow.toFixed(6)}|${od.toFixed(6)}|${oh.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    perms.push({ w: ow, d: od, h: oh });
  }
  return perms;
}

function disposeMesh(mesh) {
  try {
    if (mesh.geometry && mesh.geometry.dispose) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose && m.dispose());
      else if (mesh.material.dispose) mesh.material.dispose();
    }
  } catch (e) {}
}

function updateObjectList() {
  const ul = document.getElementById('objects');
  if (!ul) return;
  ul.innerHTML = '';
  objects.forEach((obj, i) => {
    const li = document.createElement('li');
    li.textContent = `Objet ${i + 1} - ${(obj.userData.width * 100).toFixed(0)}x${(obj.userData.depth * 100).toFixed(0)}x${(obj.userData.height * 100).toFixed(0)}cm`;
    const btn = document.createElement('button'); btn.textContent = 'Retirer'; btn.onclick = () => removeObject(i);
    li.appendChild(btn); ul.appendChild(li);
  });
}

function addObject(widthCm, depthCm, heightCm) {
  const w = toMeters(widthCm), d = toMeters(depthCm), h = toMeters(heightCm);
  const pos = findPlacement(w, d, h);
  if (!pos) return null;
  const geom = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshPhongMaterial({ color: new THREE.Color(`hsl(${Math.random() * 360},70%,70%)`) });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(pos.x, pos.y + h / 2, pos.z);
  mesh.userData = { width: w, depth: d, height: h };
  scene.add(mesh); objects.push(mesh); updateObjectList(); return mesh;
}

// Ajoute une liste d'objets fournie sous forme d'un tableau d'objets {width, depth, height}
function addObjects(list) {
  if (!Array.isArray(list)) {
    alert('Format invalide : attendez un tableau d\'objets.');
    return;
  }

  // Normalize input to meter units and validate
  const items = [];
  const inputFailures = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const width = parseInt(it.width, 10);
    const depth = parseInt(it.depth, 10);
    const height = parseInt(it.height, 10);
    if (Number.isNaN(width) || Number.isNaN(depth) || Number.isNaN(height)) {
      inputFailures.push({ index: i, reason: 'Dimensions invalides' });
      continue;
    }
    if (width > PALETTE_WIDTH || depth > PALETTE_DEPTH || height > PALETTE_HEIGHT) {
      inputFailures.push({ index: i, reason: 'Dimensions trop grandes pour la palette' });
      continue;
    }
    items.push({
      origIndex: i,
      w: toMeters(width),
      d: toMeters(depth),
      h: toMeters(height),
      area: width * depth,
      vol: width * depth * height
    });
  }

  if (items.length === 0) {
    if (inputFailures.length > 0) {
      const msgs = inputFailures.map(f => `Index ${f.index}: ${f.reason}`);
      alert('Aucun objet valide à ajouter:\n' + msgs.join('\n'));
    }
    return;
  }

  // Fast deterministic strategy: sort by area descending and try rotations per item.
  // Prioritize items that have a side exactly equal to palette width (in cm)
  const areaOrder = items.slice().sort((a, b) => {
    const aFullW = Math.round(Math.max(a.w, a.d) * 100) === PALETTE_WIDTH || Math.round(Math.min(a.w, a.d) * 100) === PALETTE_WIDTH;
    const bFullW = Math.round(Math.max(b.w, b.d) * 100) === PALETTE_WIDTH || Math.round(Math.min(b.w, b.d) * 100) === PALETTE_WIDTH;
    if (aFullW && !bFullW) return -1;
    if (bFullW && !aFullW) return 1;
    // then by area desc
    return b.area - a.area;
  });
  const failures = [];
  for (let it of areaOrder) {
    // try without rotation first
    let pos = findPlacement(it.w, it.d, it.h);
    let rotated = false;
    if (!pos) {
      // try rotated (swap w and d)
      pos = findPlacement(it.d, it.w, it.h);
      if (pos) rotated = true;
    }
    if (!pos) {
      failures.push({ index: it.origIndex, reason: 'Pas de place disponible (tri area-desc, rotation essayée)' });
      continue;
    }
    const ww = rotated ? it.d : it.w;
    const dd = rotated ? it.w : it.d;
    const hh = it.h;
    const geometry = new THREE.BoxGeometry(ww, hh, dd);
    const color = new THREE.Color(`hsl(${Math.random() * 360},70%,70%)`);
    const material = new THREE.MeshPhongMaterial({ color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(pos.x, pos.y + hh / 2, pos.z);
    mesh.userData = { width: ww, depth: dd, height: hh };
    scene.add(mesh);
    objects.push(mesh);
  }

  updateObjectList();

  // Alerts for input validation and placement failures
  const msgs = [];
  if (inputFailures.length > 0) msgs.push(...inputFailures.map(f => `Index ${f.index}: ${f.reason}`));
  if (failures.length > 0) msgs.push(...failures.map(f => `Index ${f.index}: ${f.reason}`));
  if (msgs.length > 0) alert('Problèmes détectés:\n' + msgs.join('\n'));

  // Diagnostics button handler: simulate area-order with rotation and print details
  const diagBtn = document.getElementById('diag');
  if (diagBtn) {
    diagBtn.onclick = () => {
      const sim = (function simulate() {
        const layersCopy = cloneLayers(layers);
        const steps = [];
        for (let it of areaOrder) {
          let pos = findPlacementInLayers(layersCopy, it.w, it.d, it.h);
          let rotated = false;
          if (!pos) {
            pos = findPlacementInLayers(layersCopy, it.d, it.w, it.h);
            if (pos) rotated = true;
          }
          steps.push({ index: it.origIndex, width: it.w*100, depth: it.d*100, height: it.h*100, placed: !!pos, rotated, pos: pos, freeRectsSnapshot: JSON.parse(JSON.stringify(layersCopy.map(L=>L.freeRects))) });
        }
        return steps;
      })();
      console.log('Diagnostics (area-order):', sim);
      const failed = sim.filter(s => !s.placed);
      if (failed.length === 0) alert('Diagnostics: tous les objets peuvent être placés avec area-order (simulation). Voir console pour détails.');
      else alert('Diagnostics: ' + failed.length + ' objets ne peuvent pas être placés en simulation. Voir console pour détails.');
    };
  }
}

// Diagnostic utilities: clone layers and simulate placement without creating meshes
function cloneLayers(src) {
  return src.map(L => ({ baseY: L.baseY, height: L.height, freeRects: L.freeRects.map(r => ({ minX: r.minX, minZ: r.minZ, w: r.w, d: r.d })) }));
}

function simulatePlacement(list) {
  if (!Array.isArray(list)) return [];
  const items = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const W = parseInt(it.width, 10), D = parseInt(it.depth, 10), H = parseInt(it.height, 10);
    if (Number.isNaN(W) || Number.isNaN(D) || Number.isNaN(H)) { items.push({ index: i, placed: false, reason: 'invalid' }); continue; }
    if (W > PALETTE_WIDTH || D > PALETTE_DEPTH || H > PALETTE_HEIGHT) { items.push({ index: i, placed: false, reason: 'too-big' }); continue; }
    items.push({ index: i, W, D, H, area: W * D });
  }
  items.sort((a, b) => b.area - a.area);
  const layersCopy = cloneLayers(layers);
  const steps = [];
  for (const it of items) {
    let pos = findPlacementInLayers(layersCopy, toMeters(it.W), toMeters(it.D), toMeters(it.H)); let rotated = false;
    if (!pos) { pos = findPlacementInLayers(layersCopy, toMeters(it.D), toMeters(it.W), toMeters(it.H)); if (pos) rotated = true; }
    steps.push({ index: it.index, placed: !!pos, rotated, pos });
  }
  return steps;
}

function removeObject(index) {
  if (index < 0 || index >= objects.length) return;
  const remaining = [];
  for (let i = 0; i < objects.length; i++) {
    if (i === index) { disposeMesh(objects[i]); scene.remove(objects[i]); continue; }
    remaining.push({ width: Math.round(objects[i].userData.width * 100), depth: Math.round(objects[i].userData.depth * 100), height: Math.round(objects[i].userData.height * 100) });
    disposeMesh(objects[i]); scene.remove(objects[i]);
  }
  objects.length = 0; layers.length = 0; layers.push(createNewLayer(paletteTop, 0));
  if (remaining.length) addObjects(remaining); else updateObjectList();
}

function clearAll() { while (objects.length) { const m = objects.pop(); disposeMesh(m); scene.remove(m); } layers.length = 0; layers.push(createNewLayer(paletteTop, 0)); updateObjectList(); }

// Minimal DOM bindings
document.getElementById('add-objects')?.addEventListener('click', () => {
  const txt = document.getElementById('obj-list')?.value || '';
  if (!txt) { alert('Collez une liste JSON'); return; }
  let parsed; try { parsed = JSON.parse(txt); } catch (e) { alert('JSON invalide: ' + e.message); return; }
  addObjects(parsed);
});
document.getElementById('clear-all')?.addEventListener('click', () => clearAll());
document.getElementById('load-test')?.addEventListener('click', async () => { try { const r = await fetch('test.json'); const data = await r.json(); addObjects(data); } catch (e) { alert('Impossible de charger test.json'); } });
document.getElementById('load-test-varied')?.addEventListener('click', async () => { try { const r = await fetch('test_varied.json'); const data = await r.json(); addObjects(data); } catch (e) { alert('Impossible de charger test-varied.json'); } });
// Diagnostic button (if present in the UI)
document.getElementById('diag')?.addEventListener('click', () => {
  const txt = document.getElementById('obj-list')?.value || '';
  if (!txt) { alert('Collez une liste JSON'); return; }
  let parsed; try { parsed = JSON.parse(txt); } catch (e) { alert('JSON invalide: ' + e.message); return; }
  const sim = simulatePlacement(parsed);
  console.log('Diagnostic simulation:', sim);
  const failed = sim.filter(s => !s.placed);
  alert(`Diagnostic: ${sim.length - failed.length} placés, ${failed.length} échoués. Voir console pour détails.`);
});

// --- Placement queue: load list then step-through placement ---
const placementQueue = [];
function updateQueueCount() {
  const el = document.getElementById('queue-count');
  if (el) el.textContent = `(${placementQueue.length})`;
}

function normalizeListToItems(list) {
  const items = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const width = parseInt(it.width, 10);
    const depth = parseInt(it.depth, 10);
    const height = parseInt(it.height, 10);
    if (Number.isNaN(width) || Number.isNaN(depth) || Number.isNaN(height)) continue;
    if (width > PALETTE_WIDTH || depth > PALETTE_DEPTH || height > PALETTE_HEIGHT) continue;
    items.push({ origIndex: i, w: toMeters(width), d: toMeters(depth), h: toMeters(height), area: width * depth });
  }
  return items;
}

function loadQueueFromTextarea() {
  const txt = document.getElementById('obj-list')?.value || '';
  if (!txt) { alert('Collez une liste JSON d\'objets dans le textarea.'); return; }
  let parsed; try { parsed = JSON.parse(txt); } catch (e) { alert('JSON invalide: ' + e.message); return; }
  const items = normalizeListToItems(parsed);
  // keep the provided order in the queue (visualization), but we could sort if desired
  placementQueue.length = 0;
  for (let it of items) placementQueue.push(it);
  updateQueueCount();
  alert(`Liste chargée : ${placementQueue.length} objets`);
}

function placeNextFromQueue() {
  if (placementQueue.length === 0) { alert('Queue vide'); return; }
  const it = placementQueue.shift();
  // try place without rotation then with rotation
  let pos = findPlacement(it.w, it.d, it.h);
  let rotated = false;
  if (!pos) {
    pos = findPlacement(it.d, it.w, it.h);
    if (pos) rotated = true;
  }

  // Diagnostic logging
  try {
    console.group(`placeNext: index=${it.origIndex}`);
    console.log('item(cm):', { w: Math.round(it.w*100), d: Math.round(it.d*100), h: Math.round(it.h*100) });
    console.log('rotated tried:', rotated);
    console.log('placement pos:', pos);
    console.log('layers (baseY,height,freeRects):', layers.map(L => ({ baseY: L.baseY, height: L.height, freeRects: L.freeRects })));
    // if computeSupportedAtHeight exists, show supported at current top
    if (typeof computeSupportedAtHeight === 'function') {
      const currentTop = layers.reduce((acc, L) => Math.max(acc, L.baseY + L.height), paletteTop);
      console.log('supported at currentTop (cm):', computeSupportedAtHeight(currentTop).map(r => ({ x: Math.round(r.minX*100), z: Math.round(r.minZ*100), w: Math.round(r.w*100), d: Math.round(r.d*100) })));
    }
    console.groupEnd();
  } catch (e) { /* ignore logging errors */ }

  if (!pos) {
    alert(`Objet index ${it.origIndex} : pas de place disponible pour cet objet (visualisation).`);
    updateQueueCount();
    return;
  }

  const ww = rotated ? it.d : it.w;
  const dd = rotated ? it.w : it.d;
  const hh = it.h;
  const geometry = new THREE.BoxGeometry(ww, hh, dd);
  const color = new THREE.Color(`hsl(${Math.random() * 360},70%,70%)`);
  const material = new THREE.MeshPhongMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(pos.x, pos.y + hh / 2, pos.z);
  mesh.userData = { width: ww, depth: dd, height: hh };
  scene.add(mesh);
  objects.push(mesh);
  updateObjectList();
  updateQueueCount();
}

document.getElementById('load-queue')?.addEventListener('click', loadQueueFromTextarea);
document.getElementById('step-next')?.addEventListener('click', placeNextFromQueue);
updateQueueCount();

function animate() { requestAnimationFrame(animate); renderer.render(scene, camera); }
animate();
