// Clean, minimal `palettePOC.js`
// - Provides basic Three.js scene and a deterministic layer-based packing algorithm.
// - Input units from UI: centimeters (cm). Internal units for Three.js: meters.

'use strict';
const PALETTE_WIDTH = 80; // cm
const PALETTE_DEPTH = 120; // cm
const PALETTE_HEIGHT = 180; // cm
const toMeters = v => v / 100;

if (typeof THREE === 'undefined') throw new Error('THREE is required');

// Scene + renderer
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
const objects = []; // placed meshes
const layers = [];
const paletteHalfW = toMeters(PALETTE_WIDTH) / 2;
const paletteHalfD = toMeters(PALETTE_DEPTH) / 2;
const paletteTop = toMeters(5);
const paletteMaxTop = toMeters(PALETTE_HEIGHT);
// minimal fraction of footprint that must be supported by underlying top
let SUPPORT_THRESHOLD = 0.75; // 75% (mutable from UI)

function createNewLayer(baseY, initialHeight) {
  return { baseY, height: initialHeight, freeRects: [{ minX: -paletteHalfW, minZ: -paletteHalfD, w: paletteHalfW * 2, d: paletteHalfD * 2 }] };
}
if (layers.length === 0) layers.push(createNewLayer(paletteTop, 0));

function findPlacementInLayers(layersParam, w, d, h) {
  // Try existing layers: for each freeRect, attempt multiple candidate
  // placements (grid) inside the rect to maximize support fraction and
  // ensure the center of gravity is supported.
  for (let li = 0; li < layersParam.length; li++) {
    const layer = layersParam[li];
    for (let ri = 0; ri < layer.freeRects.length; ri++) {
      const r = layer.freeRects[ri];
      if (r.w + 1e-9 < w || r.d + 1e-9 < d) continue;

      const rXmin = r.minX;
      const rZmin = r.minZ;
      const rXmax = r.minX + r.w;
      const rZmax = r.minZ + r.d;

      const stepX = Math.max(w / 4, 0.02);
      const stepZ = Math.max(d / 4, 0.02);

      for (let px = rXmin; px <= rXmax - w + 1e-9; px += stepX) {
        for (let pz = rZmin; pz <= rZmax - d + 1e-9; pz += stepZ) {
          const cx = px + w / 2;
          const cz = pz + d / 2;
          const supportInfo = findSupportYUnder(cx, cz, w, d);
          // must be supported exactly at this layer base
          if (Math.abs(supportInfo.supportY - layer.baseY) > 1e-9) continue;
          if ((supportInfo.supportFraction || 0) + 1e-9 < SUPPORT_THRESHOLD) continue;
          if (!centerInsideSupport(supportInfo.supportRects, cx, cz)) continue;

          // Accept placement at (cx,cz). Remove r and add residual rects.
          const pMinX = cx - w / 2;
          const pMinZ = cz - d / 2;
          const pMaxX = pMinX + w;
          const pMaxZ = pMinZ + d;

          const newRects = [];
          // left strip
          if (pMinX - rXmin > 1e-9) newRects.push({ minX: rXmin, minZ: rZmin, w: pMinX - rXmin, d: r.d });
          // right strip
          if (rXmax - pMaxX > 1e-9) newRects.push({ minX: pMaxX, minZ: rZmin, w: rXmax - pMaxX, d: r.d });
          // top strip (between left/right within placement span)
          const spanMinX = Math.max(rXmin, pMinX);
          const spanMaxX = Math.min(rXmax, pMaxX);
          if (pMinZ - rZmin > 1e-9 && spanMaxX - spanMinX > 1e-9) newRects.push({ minX: spanMinX, minZ: rZmin, w: spanMaxX - spanMinX, d: pMinZ - rZmin });
          // bottom strip
          if (rZmax - pMaxZ > 1e-9 && spanMaxX - spanMinX > 1e-9) newRects.push({ minX: spanMinX, minZ: pMaxZ, w: spanMaxX - spanMinX, d: rZmax - pMaxZ });

          layer.freeRects.splice(ri, 1);
          if (newRects.length) layer.freeRects.splice(ri, 0, ...newRects);
          layer.height = Math.max(layer.height, h);
          return { x: cx, y: layer.baseY, z: cz, layerIndex: li };
        }
      }
    }
  }

  // No supported positions found in existing layers -> create new layer at top
  const currentTop = layersParam.reduce((acc, L) => Math.max(acc, L.baseY + L.height), paletteTop);
  if (currentTop + h > paletteMaxTop + 1e-9) return null;
  const newLayer = createNewLayer(currentTop, h);
  const r = newLayer.freeRects[0];
  const x = r.minX + w / 2;
  const z = r.minZ + d / 2;
  const y = newLayer.baseY;
  const rightW = r.w - w;
  const bottomD = r.d - d;
  const rightRect = rightW > 1e-9 ? { minX: r.minX + w, minZ: r.minZ, w: rightW, d: d } : null;
  const bottomRect = bottomD > 1e-9 ? { minX: r.minX, minZ: r.minZ + d, w: r.w, d: bottomD } : null;
  newLayer.freeRects = [];
  if (bottomRect) newLayer.freeRects.push(bottomRect);
  if (rightRect) newLayer.freeRects.push(rightRect);
  layersParam.push(newLayer);
  return { x, y, z, layerIndex: layersParam.length - 1 };
}

function findPlacement(w, d, h) { return findPlacementInLayers(layers, w, d, h); }

function disposeMesh(mesh) {
  try {
    if (mesh.geometry && mesh.geometry.dispose) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose && m.dispose());
      else if (mesh.material.dispose) mesh.material.dispose();
    }
  } catch (e) {}
}

// Find highest support (top Y) under a footprint (x,z center with width w and depth d)
function findSupportYUnder(x, z, w, d) {
  const eps = 1e-9;
  const halfW = w / 2;
  const halfD = d / 2;
  const fMinX = x - halfW;
  const fMaxX = x + halfW;
  const fMinZ = z - halfD;
  const fMaxZ = z + halfD;
  const footprintArea = Math.max(1e-12, w * d);

  // Find highest top under footprint (including palette)
  let highestTop = paletteTop;
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (!o || !o.userData) continue;
    const ow = o.userData.width || 0;
    const od = o.userData.depth || 0;
    const ox = o.position.x;
    const oz = o.position.z;
    const oMinX = ox - ow / 2;
    const oMaxX = ox + ow / 2;
    const oMinZ = oz - od / 2;
    const oMaxZ = oz + od / 2;
    // check any overlap
    const overlapW = Math.max(0, Math.min(fMaxX, oMaxX) - Math.max(fMinX, oMinX));
    const overlapD = Math.max(0, Math.min(fMaxZ, oMaxZ) - Math.max(fMinZ, oMinZ));
    if (overlapW > eps && overlapD > eps) {
      const top = o.position.y + (o.userData.height || 0) / 2;
      if (top > highestTop) highestTop = top;
    }
  }

  // If highestTop is paletteTop (no objects overlapping), full support
  if (Math.abs(highestTop - paletteTop) < 1e-9) {
    return { supportY: highestTop, supportFraction: 1, supportRects: [{ minX: fMinX, minZ: fMinZ, w: w, d: d }] };
  }

  // Sum overlap area of objects whose top equals highestTop (within eps)
  let overlapArea = 0;
  const supportRects = [];
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (!o || !o.userData) continue;
    const ow = o.userData.width || 0;
    const od = o.userData.depth || 0;
    const ox = o.position.x;
    const oz = o.position.z;
    const top = o.position.y + (o.userData.height || 0) / 2;
    if (Math.abs(top - highestTop) > 1e-9) continue;
    const oMinX = ox - ow / 2;
    const oMaxX = ox + ow / 2;
    const oMinZ = oz - od / 2;
    const oMaxZ = oz + od / 2;
    const overlapW = Math.max(0, Math.min(fMaxX, oMaxX) - Math.max(fMinX, oMinX));
    const overlapD = Math.max(0, Math.min(fMaxZ, oMaxZ) - Math.max(fMinZ, oMinZ));
    if (overlapW > eps && overlapD > eps) {
      overlapArea += overlapW * overlapD;
      supportRects.push({ minX: Math.max(fMinX, oMinX), minZ: Math.max(fMinZ, oMinZ), w: overlapW, d: overlapD });
    }
  }

  const supportFraction = Math.min(1, overlapArea / footprintArea);
  return { supportY: highestTop, supportFraction, supportRects };
}

function centerInsideSupport(supportRects, x, z) {
  if (!Array.isArray(supportRects) || supportRects.length === 0) return false;
  for (const r of supportRects) {
    if (x >= r.minX - 1e-9 && x <= r.minX + r.w + 1e-9 && z >= r.minZ - 1e-9 && z <= r.minZ + r.d + 1e-9) return true;
  }
  return false;
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
  // snap to highest support under the footprint so objects don't levitate
  const { supportY } = findSupportYUnder(pos.x, pos.z, w, d);
  mesh.position.set(pos.x, supportY + h / 2, pos.z);
  mesh.userData = { width: w, depth: d, height: h };
  scene.add(mesh); objects.push(mesh); updateObjectList(); return mesh;
}

function addObjects(list) {
  if (!Array.isArray(list)) return { placed: 0, failed: list ? list.length : 0 };
  const items = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const W = parseInt(it.width, 10), D = parseInt(it.depth, 10), H = parseInt(it.height, 10);
    if (Number.isNaN(W) || Number.isNaN(D) || Number.isNaN(H)) continue;
    if (W > PALETTE_WIDTH || D > PALETTE_DEPTH || H > PALETTE_HEIGHT) continue;
    items.push({ origIndex: i, W, D, H, area: W * D });
  }
  items.sort((a, b) => b.area - a.area);
  const failures = [];
  for (const it of items) {
    let pos = findPlacement(toMeters(it.W), toMeters(it.D), toMeters(it.H)); let rotated = false;
    if (!pos) { pos = findPlacement(toMeters(it.D), toMeters(it.W), toMeters(it.H)); if (pos) rotated = true; }
    if (!pos) { failures.push(it.origIndex); continue; }
    const w = rotated ? it.D : it.W, d = rotated ? it.W : it.D, h = it.H;
    // create mesh using cm->meters conversion
    addObject(w, d, h);
  }
  return { placed: objects.length, failed: failures };
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

// Simple DOM bindings (if elements exist)
document.getElementById('add-objects')?.addEventListener('click', () => { const txt = document.getElementById('obj-list')?.value || ''; if (!txt) { alert('Collez une liste JSON'); return; } let parsed; try { parsed = JSON.parse(txt); } catch (e) { alert('JSON invalide: ' + e.message); return; } addObjects(parsed); });
document.getElementById('clear-all')?.addEventListener('click', () => clearAll());
document.getElementById('load-test')?.addEventListener('click', async () => { try { const r = await fetch('test.json'); const data = await r.json(); addObjects(data); } catch (e) { alert('Impossible de charger test.json'); } });

// Wire SUPPORT_THRESHOLD slider from UI (if present)
const thrInput = document.getElementById('support-threshold');
const thrValue = document.getElementById('support-value');
if (thrInput) {
  const v = parseInt(thrInput.value, 10) || 75;
  SUPPORT_THRESHOLD = v / 100;
  if (thrValue) thrValue.textContent = `${v}%`;
  thrInput.addEventListener('input', (ev) => {
    const nv = parseInt(ev.target.value, 10) || 75;
    SUPPORT_THRESHOLD = nv / 100;
    if (thrValue) thrValue.textContent = `${nv}%`;
  });
}

function animate() { requestAnimationFrame(animate); renderer.render(scene, camera); }
animate();

document.getElementById('add-object').onclick = () => {
  const width = parseInt(document.getElementById('obj-width').value, 10);
  const depth = parseInt(document.getElementById('obj-depth').value, 10);
  const height = parseInt(document.getElementById('obj-height').value, 10);
  if (width > PALETTE_WIDTH || depth > PALETTE_DEPTH || height > PALETTE_HEIGHT) {
    alert('Dimensions trop grandes pour la palette !');
    return;
  }
  addObject(width, depth, height);
};

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
    // ensure object rests on highest support under its footprint
    const { supportY } = findSupportYUnder(pos.x, pos.z, ww, dd);
    mesh.position.set(pos.x, supportY + hh / 2, pos.z);
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

// Bouton pour ajouter la liste depuis le textarea (JSON)
const addListBtn = document.getElementById('add-objects');
if (addListBtn) {
  addListBtn.onclick = () => {
    const txt = document.getElementById('obj-list').value;
    if (!txt) {
      alert('Collez une liste JSON d\'objets dans le textarea.');
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch (e) {
      alert('JSON invalide : ' + e.message);
      return;
    }
    addObjects(parsed);
  };
}

// --- Step-through placement queue ---
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

document.getElementById('load-queue')?.addEventListener('click', () => {
  const txt = document.getElementById('obj-list').value;
  if (!txt) { alert('Collez une liste JSON d\'objets dans le textarea.'); return; }
  let parsed;
  try { parsed = JSON.parse(txt); } catch (e) { alert('JSON invalide : ' + e.message); return; }
  const items = normalizeListToItems(parsed);
  // keep the provided order in the queue (visualization), but we could sort if desired
  placementQueue.length = 0;
  for (let it of items) placementQueue.push(it);
  updateQueueCount();
  alert(`Liste chargée : ${placementQueue.length} objets`);
});

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
  // ensure object rests on highest support under its footprint
  const { supportY } = findSupportYUnder(pos.x, pos.z, ww, dd);
  mesh.position.set(pos.x, supportY + hh / 2, pos.z);
  mesh.userData = { width: ww, depth: dd, height: hh };
  scene.add(mesh);
  objects.push(mesh);
  updateObjectList();
  updateQueueCount();
}

document.getElementById('step-next')?.addEventListener('click', () => placeNextFromQueue());

// Clear all placed objects and reset packing state
const clearBtn = document.getElementById('clear-all');
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    // remove all meshes in objects from scene
    while (objects.length > 0) {
      const m = objects.pop();
      try { scene.remove(m); } catch (e) { /* ignore */ }
    }
    // reset layers to initial state
    layers.length = 0;
    layers.push(createNewLayer(paletteTop, 0));
    // clear placement queue
    placementQueue.length = 0;
    updateQueueCount();
    updateObjectList();
    console.log('Palette cleared: objects removed, layers reset, queue cleared.');
  });
}

// Bouton: charger automatiquement `test.json` et l'ajouter
const loadTestBtn = document.getElementById('load-test');
if (loadTestBtn) {
  loadTestBtn.onclick = async () => {
    try {
      const resp = await fetch('test.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      const data = await resp.json();
      if (!Array.isArray(data)) {
        alert('Le fichier test.json doit contenir un tableau d\'objets.');
        return;
      }
      addObjects(data);
    } catch (err) {
      alert('Impossible de charger test.json : ' + err.message);
    }
  };
}

const loadTestVariedBtn = document.getElementById('load-test-varied');
if (loadTestVariedBtn) {
  loadTestVariedBtn.onclick = async () => {
    try {
      const resp = await fetch('test_varied.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      const data = await resp.json();
      if (!Array.isArray(data)) {
        alert('Le fichier test.json doit contenir un tableau d\'objets.');
        return;
      }
      addObjects(data);
    } catch (err) {
      alert('Impossible de charger test-varied.json : ' + err.message);
    }
  };
}

// Load placements produced by the headless solver (solver_result.json)
async function loadSolverPlacements(gridCm = 5, solverPath = 'solver_result.json', inputPath = 'test.json') {
  try {
    const resp = await fetch(solverPath);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    const result = await resp.json();
    if (!result || !Array.isArray(result.placed)) throw new Error('solver_result.json format invalide');

    const resp2 = await fetch(inputPath);
    if (!resp2.ok) throw new Error(`HTTP ${resp2.status} ${resp2.statusText}`);
    const data = await resp2.json();

    // compute per-layer heights (cm) using original item heights
    const layerMaxH = {};
    for (const p of result.placed) {
      const it = data[p.index];
      if (!it) continue;
      const h = Number(it.height) || 0;
      layerMaxH[p.layer] = Math.max(layerMaxH[p.layer] || 0, h);
    }
    const maxLayer = Math.max(...Object.keys(layerMaxH).map(k => parseInt(k, 10)), 0);
    const baseYcm = [];
    baseYcm[0] = 5; // palette top thickness in cm
    for (let L = 1; L <= maxLayer; L++) baseYcm[L] = (baseYcm[L - 1] || 5) + (layerMaxH[L - 1] || 0);

    // clear existing objects and layers
    clearAll();

    // Place each object according to solver cells -> convert to cm then meters
    const palletMinX = -PALETTE_WIDTH / 2;
    const palletMinZ = -PALETTE_DEPTH / 2;
    for (const p of result.placed) {
      const it = data[p.index];
      if (!it) continue;
      const wCm = Number(it.width);
      const dCm = Number(it.depth);
      const hCm = Number(it.height);
      // convert solver cell coords to center cm
      const centerXcm = palletMinX + (p.x + p.w / 2) * gridCm;
      const centerZcm = palletMinZ + (p.z + p.d / 2) * gridCm;
      const layer = p.layer || 0;
      const baseCm = baseYcm[layer] || (5 + (layerMaxH[0] || 0) * layer);
      const yCm = baseCm + hCm / 2;

      const w = toMeters(wCm), d = toMeters(dCm), h = toMeters(hCm);
      const geo = new THREE.BoxGeometry(w, h, d);
      const mat = new THREE.MeshPhongMaterial({ color: new THREE.Color(`hsl(${Math.random() * 360},70%,70%)`) });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(toMeters(centerXcm), toMeters(yCm), toMeters(centerZcm));
      mesh.userData = { width: w, depth: d, height: h };
      scene.add(mesh); objects.push(mesh);
    }
    updateObjectList();
    alert(`Chargé ${result.placed.length} placements depuis ${solverPath}`);
  } catch (err) {
    alert('Erreur lors du chargement du solver: ' + err.message);
    console.error(err);
  }
}

// wire button if present
const loadSolverBtn = document.getElementById('load-solver');
if (loadSolverBtn) loadSolverBtn.addEventListener('click', () => loadSolverPlacements());

// expose to console for debugging
window.loadSolverPlacements = loadSolverPlacements;

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();
