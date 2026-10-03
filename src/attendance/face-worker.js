/**
 * Worker thread that runs the face models (see face-engine.js).
 *
 * Face analysis is CPU-heavy and synchronous inside WebAssembly, so it runs
 * here instead of on the web server's main thread, which keeps serving
 * requests while a check-in is analysed.
 *
 * Uses @vladmandic/human on the TensorFlow WebAssembly backend (no native
 * add-ons, so it installs the same on Windows dev boxes and Railway Linux).
 */

const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');

// human's package.json "exports" keys lack the "./" prefix, so Node can't
// resolve any subpath. Resolve the main entry only to find the package folder
// (it is not loaded), then use absolute paths for the WASM build and models.
const HUMAN_DIR = path.join(path.dirname(require.resolve('@vladmandic/human')), '..');
const HUMAN_WASM_BUILD = path.join(HUMAN_DIR, 'dist', 'human.node-wasm.js');
const MODELS_DIR = path.join(HUMAN_DIR, 'models');
const WASM_DIR = path.join(path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')), 'dist');

// TensorFlow.js loads models and the WASM binary with fetch(), and Node's
// fetch() has no file:// support, so serve those two folders from disk.
// (This patch only affects this worker thread.)
const nativeFetch = globalThis.fetch;
globalThis.fetch = async function fetchWithFiles(input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (url.startsWith('file://')) {
    const resolved = path.resolve(decodeURIComponent(url.replace(/^file:\/\/\/?/, process.platform === 'win32' ? '' : '/')));
    if (!resolved.startsWith(path.resolve(MODELS_DIR)) && !resolved.startsWith(path.resolve(WASM_DIR))) {
      throw new Error('face-worker: refusing to read ' + resolved);
    }
    const data = await fs.promises.readFile(resolved);
    const type = resolved.endsWith('.json') ? 'application/json' : resolved.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
    return new Response(data, { status: 200, headers: { 'Content-Type': type } });
  }
  return nativeFetch(input, init);
};

const toFileUrl = (dir) => 'file://' + dir.replace(/\\/g, '/') + '/';

let human = null;
let ready = null;

function init() {
  if (ready) return ready;
  ready = (async () => {
    const { Human } = require(HUMAN_WASM_BUILD);
    human = new Human({
      backend: 'wasm',
      wasmPath: toFileUrl(WASM_DIR),
      modelBasePath: toFileUrl(MODELS_DIR),
      debug: false,
      async: true,
      cacheSensitivity: 0, // every frame is a separate check-in; never reuse results
      filter: { enabled: false },
      face: {
        enabled: true,
        detector: { enabled: true, rotation: true, maxDetected: 3, minConfidence: 0.5, return: false },
        mesh: { enabled: true },
        iris: { enabled: true },
        description: { enabled: true }, // faceres: embedding used for matching
        antispoof: { enabled: true },
        liveness: { enabled: true },
        emotion: { enabled: false },
        attention: { enabled: false },
      },
      body: { enabled: false },
      hand: { enabled: false },
      object: { enabled: false },
      gesture: { enabled: false },
      segmentation: { enabled: false },
    });
    await human.load();
    await human.warmup();
    return human;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

function decodeDataUrl(dataUrl) {
  const m = /^data:image\/(jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '').trim());
  if (!m) throw Object.assign(new Error('Each frame must be a JPEG image'), { status: 400 });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) throw Object.assign(new Error('Frame too large (max 3 MB)'), { status: 400 });
  return buf;
}

// Eye openness from the face mesh: vertical lid distance / horizontal eye width.
// Mesh indices are MediaPipe FaceMesh landmarks.
function eyeOpenness(mesh) {
  if (!mesh || mesh.length < 400) return null;
  const d = (a, b) => Math.hypot(mesh[a][0] - mesh[b][0], mesh[a][1] - mesh[b][1]);
  return (d(159, 145) / Math.max(1, d(33, 133)) + d(386, 374) / Math.max(1, d(362, 263))) / 2;
}

// Horizontal head turn from the face mesh: how far the nose tip sits from the
// midpoint between the outer eye corners, in eye-widths. Positive = nose
// toward the right edge of the (unmirrored) camera image, which is the
// person's LEFT, i.e. they turned their head to their left.
function noseOffset(mesh) {
  if (!mesh || mesh.length < 400) return null;
  const midX = (mesh[33][0] + mesh[263][0]) / 2;
  const eyeW = Math.abs(mesh[263][0] - mesh[33][0]);
  if (eyeW < 1) return null;
  return (mesh[1][0] - midX) / eyeW;
}

async function analyze(dataUrl) {
  const h = await init();
  const raw = jpeg.decode(decodeDataUrl(dataUrl), { useTArray: true, maxMemoryUsageInMB: 256 });
  const rgb = new Uint8Array(raw.width * raw.height * 3); // RGBA -> RGB
  for (let i = 0, j = 0; i < raw.data.length; i += 4) { rgb[j++] = raw.data[i]; rgb[j++] = raw.data[i + 1]; rgb[j++] = raw.data[i + 2]; }
  const tensor = h.tf.tensor(rgb, [1, raw.height, raw.width, 3], 'int32');
  try {
    const res = await h.detect(tensor);
    return {
      width: raw.width,
      height: raw.height,
      faces: (res.face || []).map((f) => ({
        score: f.score,
        box: f.box, // [x, y, w, h] in pixels
        boxRatio: f.box ? (f.box[2] * f.box[3]) / (raw.width * raw.height) : 0,
        embedding: Array.from(f.embedding || []),
        real: typeof f.real === 'number' ? f.real : null, // anti-spoof (printed photo / screen)
        live: typeof f.live === 'number' ? f.live : null, // liveness model
        yaw: f.rotation && f.rotation.angle ? f.rotation.angle.yaw : null,
        eyeOpen: eyeOpenness(f.mesh),
        turn: noseOffset(f.mesh),
      })),
    };
  } finally {
    h.tf.dispose(tensor);
  }
}

// Similarity (0..1, Human's faceres metric) of one probe to many candidates.
async function similarities(probe, candidates) {
  const h = await init();
  return candidates.map((c) => (probe && c && probe.length && probe.length === c.length ? h.match.similarity(probe, c) : 0));
}

const ops = { init: () => init().then(() => true), analyze, similarities };

// Jobs run one at a time, in arrival order.
let chain = Promise.resolve();
parentPort.on('message', ({ id, op, args }) => {
  chain = chain.then(async () => {
    try {
      const result = await ops[op](...(args || []));
      parentPort.postMessage({ id, result });
    } catch (e) {
      parentPort.postMessage({ id, error: { message: e.message, status: e.status } });
    }
  });
});
