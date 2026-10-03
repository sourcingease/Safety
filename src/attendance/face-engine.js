/**
 * Server-side face analysis for attendance (self-hosted, no cloud calls).
 *
 * The models run in a worker thread (face-worker.js) so the web server keeps
 * answering other requests while a check-in is analysed. Images arrive as
 * JPEG data URLs from the browser camera; every decision is made on the
 * server, never trusted from the client.
 */

const path = require('path');
const { Worker } = require('worker_threads');
const jpeg = require('jpeg-js');

let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(path.join(__dirname, 'face-worker.js'));
  worker.on('message', ({ id, result, error }) => {
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    if (!pending.size && worker) worker.unref(); // idle: don't keep the process alive
    if (error) job.reject(Object.assign(new Error(error.message), { status: error.status }));
    else job.resolve(result);
  });
  const fail = (err) => {
    // Fail in-flight jobs and start a fresh worker on the next call
    for (const job of pending.values()) job.reject(err);
    pending.clear();
    worker = null;
  };
  worker.on('error', fail);
  worker.on('exit', (code) => { if (code !== 0) fail(new Error('Face engine stopped unexpectedly')); else worker = null; });
  return worker;
}

function run(op, ...args) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    const w = getWorker();
    w.ref(); // busy: keep the process alive until the job answers
    w.postMessage({ id, op, args });
  });
}

/** Load and warm up the models (safe to call repeatedly). */
const init = () => run('init');

/** Faces found in one JPEG data URL, with the measurements attendance rules need. */
const analyze = (dataUrl) => run('analyze', dataUrl);

/** Similarity (0..1) of one embedding to each of many. */
const similarities = (probe, candidates) => run('similarities', probe, candidates);

async function similarity(a, b) {
  const [s] = await similarities(a, [b]);
  return s;
}

function averageEmbedding(list) {
  const n = list.length;
  const out = new Array(list[0].length).fill(0);
  for (const e of list) for (let i = 0; i < e.length; i++) out[i] += e[i] / n;
  return out;
}

function decodeDataUrl(dataUrl) {
  const m = /^data:image\/(jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '').trim());
  if (!m) throw Object.assign(new Error('Each frame must be a JPEG image'), { status: 400 });
  return Buffer.from(m[2], 'base64');
}

// Small JPEG for evidence storage (box-filter downscale, pure JS).
function thumbnail(dataUrl, maxWidth = 240, quality = 60) {
  const src = jpeg.decode(decodeDataUrl(dataUrl), { useTArray: true, maxMemoryUsageInMB: 256 });
  const scale = Math.min(1, maxWidth / src.width);
  const w = Math.max(1, Math.round(src.width * scale));
  const hgt = Math.max(1, Math.round(src.height * scale));
  const out = Buffer.alloc(w * hgt * 4);
  const step = 1 / scale;
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      // source block covered by this output pixel (at least one source pixel)
      const sy0 = Math.min(src.height - 1, Math.floor(y * step));
      const sy1 = Math.min(src.height, Math.max(sy0 + 1, Math.floor((y + 1) * step)));
      const sx0 = Math.min(src.width - 1, Math.floor(x * step));
      const sx1 = Math.min(src.width, Math.max(sx0 + 1, Math.floor((x + 1) * step)));
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * src.width + sx) * 4;
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  const enc = jpeg.encode({ data: out, width: w, height: hgt }, quality);
  return 'data:image/jpeg;base64,' + Buffer.from(enc.data).toString('base64');
}

module.exports = { init, analyze, similarity, similarities, averageEmbedding, thumbnail };
