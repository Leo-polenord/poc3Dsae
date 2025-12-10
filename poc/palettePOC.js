// Dimensions palette en cm
const PALETTE_WIDTH = 80;
const PALETTE_DEPTH = 120;
const PALETTE_HEIGHT = 180;

// Conversion cm -> m pour Three.js
const toMeters = v => v / 100;


// Vérifie que THREE est bien chargé
if (typeof THREE === 'undefined') {
  alert('Erreur critique : THREE.js n\'est pas chargé ! Vérifiez le chemin et le chargement du script three.js.r122.js dans le HTML.');
  throw new Error('THREE.js n\'est pas chargé');
}
if (typeof OrbitControls === 'undefined') {
  alert('Erreur critique : OrbitControls n\'est pas chargé ! Vérifiez le chemin et le chargement du script orbitControls.js dans le HTML.');
  throw new Error('OrbitControls n\'est pas chargé');
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);

const camera = new THREE.PerspectiveCamera(45, 600 / 400, 0.1, 1000);
camera.position.set(1, 2, 2);
camera.lookAt(0, toMeters(PALETTE_HEIGHT/2), 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(600, 400);
document.getElementById('palette-3d').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, toMeters(PALETTE_HEIGHT/2), 0);
controls.update();

// Lumière
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(2, 4, 2);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

// Palette (boîte)
const paletteGeometry = new THREE.BoxGeometry(toMeters(PALETTE_WIDTH), toMeters(5), toMeters(PALETTE_DEPTH));
const paletteMaterial = new THREE.MeshPhongMaterial({ color: 0xdeb887 });
const paletteMesh = new THREE.Mesh(paletteGeometry, paletteMaterial);
paletteMesh.position.set(0, toMeters(2.5), 0);
scene.add(paletteMesh);

// Contour palette
const edges = new THREE.EdgesGeometry(paletteGeometry);
const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x333333 }));
line.position.copy(paletteMesh.position);
scene.add(line);

// Liste des objets
const objects = [];

function addObject(width, depth, height) {
  // Placement simple : empilement en hauteur
  let y = toMeters(5); // hauteur palette
  for (let obj of objects) {
    y += obj.userData.height;
  }
  if (y + toMeters(height) > toMeters(PALETTE_HEIGHT)) {
    alert('Plus de place en hauteur sur la palette !');
    return;
  }
  const geometry = new THREE.BoxGeometry(toMeters(width), toMeters(height), toMeters(depth));
  const color = new THREE.Color(`hsl(${Math.random()*360},70%,70%)`);
  const material = new THREE.MeshPhongMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, y + toMeters(height/2), 0);
  mesh.userData = { width: toMeters(width), depth: toMeters(depth), height: toMeters(height) };
  scene.add(mesh);
  objects.push(mesh);
  updateObjectList();
}

function removeObject(index) {
  scene.remove(objects[index]);
  objects.splice(index, 1);
  // Repositionner les objets restants
  let y = toMeters(5);
  for (let obj of objects) {
    obj.position.y = y + obj.userData.height/2;
    y += obj.userData.height;
  }
  updateObjectList();
}

function updateObjectList() {
  const ul = document.getElementById('objects');
  ul.innerHTML = '';
  objects.forEach((obj, i) => {
    const li = document.createElement('li');
    li.textContent = `Objet ${i+1} - ${(obj.userData.width*100).toFixed(0)}x${(obj.userData.depth*100).toFixed(0)}x${(obj.userData.height*100).toFixed(0)}cm`;
    const btn = document.createElement('button');
    btn.textContent = 'Retirer';
    btn.onclick = () => removeObject(i);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

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

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();
