/**
 * Shared camera + location helpers for face attendance pages
 * (attendance/checkin.html, attendance/enroll.html).
 *
 * Frames are captured UNMIRRORED (what the camera really sees); the server's
 * head-turn check depends on that. Only the on-screen preview is mirrored.
 */
(function () {
  const FaceCam = {};

  FaceCam.start = async function (video) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('This browser cannot use the camera. Use a recent Chrome, Edge or Safari over HTTPS.');
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
    } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw new Error('Camera permission was denied. Allow camera access in the browser and try again.');
      if (e && e.name === 'NotFoundError') throw new Error('No camera was found on this device.');
      throw new Error('Could not start the camera: ' + (e && e.message ? e.message : e));
    }
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();
    // wait until frames are flowing
    for (let i = 0; i < 40 && !video.videoWidth; i++) await FaceCam.sleep(50);
    return stream;
  };

  FaceCam.stop = function (video) {
    const s = video && video.srcObject;
    if (s) s.getTracks().forEach((t) => t.stop());
    if (video) video.srcObject = null;
  };

  // JPEG data URL, scaled to `width` px wide, not mirrored.
  FaceCam.capture = function (video, width = 480, quality = 0.85) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) throw new Error('Camera is not ready yet');
    const w = Math.min(width, vw), h = Math.round(vh * (w / vw));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(video, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
  };

  // Resolves with {latitude, longitude, accuracy} or rejects with a readable message.
  FaceCam.location = function (timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('This device cannot share its location.'));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
        (e) => reject(new Error(e && e.code === 1 ? 'Location permission was denied. Allow location access and try again.' : 'Could not get your location. Move to an open area and try again.')),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
      );
    });
  };

  // Stable random id for this browser (used to notice check-ins from new devices).
  FaceCam.deviceId = function () {
    try {
      let id = localStorage.getItem('attendanceDeviceId');
      if (!id) {
        id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
        localStorage.setItem('attendanceDeviceId', id);
      }
      return id;
    } catch (e) { return null; }
  };

  FaceCam.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  FaceCam.api = async function (url, opts) {
    const r = await fetch(url, Object.assign({ credentials: 'include', headers: { 'Content-Type': 'application/json' } }, opts || {}));
    if (r.status === 401) {
      location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
      throw new Error('Please sign in');
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.success === false) throw Object.assign(new Error(data.error || ('Request failed (' + r.status + ')')), { status: r.status, reasons: data.reasons });
    return data;
  };

  window.FaceCam = FaceCam;
})();
