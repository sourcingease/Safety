/**
 * Face-verified attendance API (phase 1) + HR attendance register (phase 2).
 *
 * All routes live under /api/attendance, so the tenant middleware in
 * web-server.js has already required a login and set req.auth {uid, tid}.
 *
 * A check-in is accepted only when the server itself confirms, from the
 * camera frames: exactly one live face, the requested head-turn (a one-time
 * challenge, so recordings can't be replayed), a face match to the enrolled
 * employee, a location inside a work-site geofence, and no recent duplicate.
 * Borderline results are accepted but flagged for HR review; failures are
 * refused and kept as "rejected attempts" so HR can see false-attendance
 * attempts.
 */

const crypto = require('crypto');
const { createSupabasePgPool } = require('../db/supabase');
const engine = require('./face-engine');

let pool = null;
function getPool() {
  if (!pool) pool = createSupabasePgPool();
  return pool;
}

const CHALLENGE_TTL_SECONDS = 120;
const MAX_CHALLENGES_PER_10_MIN = 15;
const MIN_FACE_AREA = 0.03;          // face must fill at least 3% of the frame
const MIN_TURN = 0.10;               // required head turn, in eye-widths of nose offset
const FRAME_CONSISTENCY = 0.55;      // all frames must show the same person
// Enrollment photos must be near-frontal. Uses the model's head yaw: the nose
// offset (used for the turn challenge) is not zero for a frontal face, only
// its change between frames is meaningful.
const ENROLL_MAX_YAW = (15 * Math.PI) / 180;
const ENROLL_CONSISTENCY = 0.60;
const KIOSK_MIN_MARGIN = 0.06;       // best match must beat the runner-up by this much
const IMPOSSIBLE_SPEED_KMH = 200;

const REASON_TEXT = {
  challenge_invalid: 'The check-in session expired or was already used. Please start again.',
  no_face: 'No face was found. Look straight at the camera in good light.',
  multiple_faces: 'More than one face is in the picture. Only the employee checking in may be visible.',
  face_too_far: 'Your face is too far from the camera. Move closer.',
  face_changed_between_frames: 'The face changed between photos. The same person must stay in front of the camera.',
  liveness_challenge_failed: 'The head-turn was not detected. Turn your head clearly when asked.',
  turned_wrong_way: 'You turned the wrong way. Follow the on-screen direction.',
  spoof_suspected: 'This looks like a photo or screen, not a live person.',
  not_enrolled: 'Your face is not enrolled yet. Ask HR to enroll you.',
  face_mismatch: 'The face does not match the enrolled employee.',
  face_matches_another_employee: 'This face matches a different employee.',
  unknown_face: 'Face not recognised. Make sure you are enrolled, or ask HR.',
  location_required: 'Location is required. Allow location access and try again.',
  outside_site: 'You are not at a registered work site.',
  duplicate_checkin: 'You already checked in/out a moment ago.',
};
const FLAG_TEXT = {
  weak_match: 'Face match was weak',
  low_liveness: 'Low liveness / anti-spoof score',
  ambiguous_match: 'Face was close to more than one employee',
  no_site_configured: 'No work site is configured, so location was not checked',
  outside_site: 'Outside the work site (geofence not enforced)',
  poor_gps_accuracy: 'Poor GPS accuracy',
  impossible_travel: 'Impossible travel since the previous check-in',
  new_device: 'Checked in from a new device',
};

function httpError(status, message, extra) { return Object.assign(new Error(message), { status, ...extra }); }

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim();
  return fwd || req.ip || null;
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

function cleanLocation(loc) {
  if (!loc || typeof loc !== 'object') return null;
  const lat = num(loc.latitude), lng = num(loc.longitude), acc = num(loc.accuracy);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng, accuracy: acc };
}

function setupAttendanceRoutes(app, { hasPermission }) {
  const p = getPool();

  // Warm the face models in the background so the first check-in isn't slow.
  engine.init().then(() => console.log('✅ Face engine ready')).catch((e) => console.warn('Face engine failed to load:', e.message));

  async function requireHr(req) {
    if (!(await hasPermission(req.auth.tid, req.auth.uid, 'MODULE_MANAGE_HR'))) throw httpError(403, 'Only HR managers can do this');
  }
  async function canRunKiosk(req) {
    return (await hasPermission(req.auth.tid, req.auth.uid, 'ATTENDANCE_KIOSK'))
      || (await hasPermission(req.auth.tid, req.auth.uid, 'MODULE_MANAGE_HR'));
  }
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); }
    catch (e) { res.status(e.status || 500).json({ success: false, error: e.message, ...(e.reasons ? { reasons: e.reasons } : {}) }); }
  };

  async function getSettings(tid) {
    await p.query('insert into attendance_settings(tenant_id) values ($1) on conflict (tenant_id) do nothing', [tid]);
    const r = await p.query('select * from attendance_settings where tenant_id = $1', [tid]);
    const s = r.rows[0];
    for (const k of ['match_threshold', 'review_threshold', 'liveness_threshold']) s[k] = Number(s[k]);
    return s;
  }

  async function activeEnrollments(tid) {
    const r = await p.query(
      `select e.user_id, e.embedding, u.full_name from attendance_face_enrollment e
         join users u on u.user_id = e.user_id
        where e.tenant_id = $1 and e.active`, [tid]);
    return r.rows;
  }

  async function userInTenant(userId, tid) {
    const r = await p.query('select 1 from company_users where user_id = $1 and tenant_id = $2', [parseInt(userId), tid]);
    return r.rows.length > 0;
  }

  // ---------------- settings & sites (HR) ----------------

  app.get('/api/attendance/settings', wrap(async (req, res) => {
    await requireHr(req);
    const settings = await getSettings(req.auth.tid);
    const sites = await p.query('select id, name, latitude, longitude, radius_m, active from attendance_site where tenant_id = $1 order by name', [req.auth.tid]);
    res.json({ success: true, data: { settings, sites: sites.rows } });
  }));

  app.put('/api/attendance/settings', wrap(async (req, res) => {
    await requireHr(req);
    const b = req.body || {};
    const between = (v, lo, hi, name) => { const n = num(v); if (n === null || n < lo || n > hi) throw httpError(400, `${name} must be between ${lo} and ${hi}`); return n; };
    const match = between(b.matchThreshold, 0.4, 0.95, 'Match threshold');
    const review = between(b.reviewThreshold, match, 0.99, 'Review threshold');
    const live = between(b.livenessThreshold, 0, 0.99, 'Liveness threshold');
    const acc = between(b.maxGpsAccuracyM, 10, 1000, 'Max GPS accuracy');
    const gap = between(b.minMinutesBetween, 0, 120, 'Minutes between check-ins');
    const keep = between(b.photoRetentionDays, 7, 3650, 'Photo retention days');
    await getSettings(req.auth.tid);
    await p.query(
      `update attendance_settings set match_threshold=$2, review_threshold=$3, liveness_threshold=$4, require_geofence=$5,
         max_gps_accuracy_m=$6, min_minutes_between=$7, photo_retention_days=$8, updated_at=now() where tenant_id=$1`,
      [req.auth.tid, match, review, live, b.requireGeofence !== false, Math.round(acc), Math.round(gap), Math.round(keep)]);
    res.json({ success: true });
  }));

  app.post('/api/attendance/sites', wrap(async (req, res) => {
    await requireHr(req);
    const { name } = req.body || {};
    const lat = num(req.body.latitude), lng = num(req.body.longitude), radius = num(req.body.radiusM);
    if (!(name || '').trim()) throw httpError(400, 'Site name is required');
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw httpError(400, 'Valid latitude and longitude are required');
    if (radius === null || radius < 20 || radius > 5000) throw httpError(400, 'Radius must be between 20 and 5000 metres');
    const r = await p.query('insert into attendance_site(tenant_id, name, latitude, longitude, radius_m) values ($1,$2,$3,$4,$5) returning id',
      [req.auth.tid, name.trim(), lat, lng, Math.round(radius)]);
    res.json({ success: true, id: r.rows[0].id });
  }));

  app.delete('/api/attendance/sites/:id', wrap(async (req, res) => {
    await requireHr(req);
    const r = await p.query('delete from attendance_site where id = $1 and tenant_id = $2', [parseInt(req.params.id), req.auth.tid]);
    if (!r.rowCount) throw httpError(404, 'Site not found');
    res.json({ success: true });
  }));

  // ---------------- enrollment (HR, in person, with consent) ----------------

  app.get('/api/attendance/enrollments', wrap(async (req, res) => {
    await requireHr(req);
    const r = await p.query(
      `select u.user_id as "UserId", u.full_name as "FullName", u.email as "Email",
              e.id is not null as "Enrolled", e.created_at as "EnrolledAt", e.photo as "Photo", e.quality as "Quality"
         from company_users cu
         join users u on u.user_id = cu.user_id
         left join attendance_face_enrollment e on e.tenant_id = cu.tenant_id and e.user_id = cu.user_id and e.active
        where cu.tenant_id = $1 and cu.is_active
        order by u.full_name`, [req.auth.tid]);
    res.json({ success: true, data: r.rows });
  }));

  app.post('/api/attendance/enrollments', wrap(async (req, res) => {
    await requireHr(req);
    const tid = req.auth.tid;
    const { userId, consent, frames } = req.body || {};
    if (!userId || !(await userInTenant(userId, tid))) throw httpError(404, 'Employee not found in your company');
    if (consent !== true) throw httpError(400, "The employee's consent to face recognition must be recorded before enrolling");
    if (!Array.isArray(frames) || frames.length < 3 || frames.length > 5) throw httpError(400, 'Capture 3 to 5 photos');
    const settings = await getSettings(tid);
    const results = [];
    for (const f of frames) results.push(await engine.analyze(f));
    const problems = [];
    results.forEach((r, i) => {
      if (r.faces.length === 0) problems.push(`Photo ${i + 1}: no face found`);
      else if (r.faces.length > 1) problems.push(`Photo ${i + 1}: more than one face`);
      else {
        const f = r.faces[0];
        if (f.boxRatio < MIN_FACE_AREA * 2) problems.push(`Photo ${i + 1}: face too small, move closer`);
        if (f.yaw !== null && Math.abs(f.yaw) > ENROLL_MAX_YAW) problems.push(`Photo ${i + 1}: look straight at the camera`);
        if (f.real !== null && f.real < settings.liveness_threshold * 0.5) problems.push(`Photo ${i + 1}: looks like a photo or screen, not a live person`);
      }
    });
    if (problems.length) throw httpError(422, problems.join('; '));
    const embs = results.map((r) => r.faces[0].embedding);
    for (let i = 1; i < embs.length; i++) {
      if ((await engine.similarity(embs[0], embs[i])) < ENROLL_CONSISTENCY) throw httpError(422, 'The photos do not all show the same person');
    }
    const avg = engine.averageEmbedding(embs);
    // One face may only be enrolled once per company (stops one person enrolling as two employees)
    const others = (await activeEnrollments(tid)).filter((o) => o.user_id !== parseInt(userId));
    const otherScores = await engine.similarities(avg, others.map((o) => o.embedding));
    const clash = others.find((o, i) => otherScores[i] >= settings.match_threshold);
    if (clash) throw httpError(409, `This face is already enrolled for ${clash.full_name}. One person cannot be enrolled as two employees.`);
    const quality = Math.min(...results.map((r) => r.faces[0].score));
    const client = await p.connect();
    try {
      await client.query('begin');
      await client.query('update attendance_face_enrollment set active = false where tenant_id = $1 and user_id = $2 and active', [tid, parseInt(userId)]);
      await client.query(
        `insert into attendance_face_enrollment(tenant_id, user_id, embedding, photo, quality, consent_at, consent_by, enrolled_by)
         values ($1,$2,$3,$4,$5,now(),$6,$6)`,
        [tid, parseInt(userId), avg, engine.thumbnail(frames[0], 160), quality, req.auth.uid]);
      await client.query('commit');
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
    await p.query(`insert into audit_logs(tenant_id, user_id, action, entity, details) values ($1,$2,'EnrollFace','Attendance',$3)`,
      [tid, req.auth.uid, `user ${userId}`]);
    res.json({ success: true });
  }));

  app.delete('/api/attendance/enrollments/:userId', wrap(async (req, res) => {
    await requireHr(req);
    const r = await p.query('update attendance_face_enrollment set active = false where tenant_id = $1 and user_id = $2 and active',
      [req.auth.tid, parseInt(req.params.userId)]);
    if (!r.rowCount) throw httpError(404, 'No active enrollment for this employee');
    await p.query(`insert into audit_logs(tenant_id, user_id, action, entity, details) values ($1,$2,'RemoveFaceEnrollment','Attendance',$3)`,
      [req.auth.tid, req.auth.uid, `user ${req.params.userId}`]);
    res.json({ success: true });
  }));

  // ---------------- check-in ----------------

  app.get('/api/attendance/me', wrap(async (req, res) => {
    const { tid, uid } = req.auth;
    const e = await p.query('select 1 from attendance_face_enrollment where tenant_id = $1 and user_id = $2 and active', [tid, uid]);
    const last = await p.query(
      `select direction, "timestamp", review_status from safety_attendance_log
        where tenant_id = $1 and user_id = $2 and coalesce(review_status,'ok') <> 'rejected'
        order by "timestamp" desc limit 1`, [tid, uid]);
    res.json({ success: true, data: { enrolled: e.rows.length > 0, last: last.rows[0] || null, kiosk: await canRunKiosk(req) } });
  }));

  app.post('/api/attendance/challenge', wrap(async (req, res) => {
    const { tid, uid } = req.auth;
    const mode = (req.body && req.body.mode) === 'kiosk' ? 'kiosk' : 'self';
    if (mode === 'kiosk' && !(await canRunKiosk(req))) throw httpError(403, 'This account is not allowed to run the attendance kiosk');
    if (mode === 'self') {
      const e = await p.query('select 1 from attendance_face_enrollment where tenant_id = $1 and user_id = $2 and active', [tid, uid]);
      if (!e.rows.length) throw httpError(400, REASON_TEXT.not_enrolled);
    }
    const recent = await p.query(`select count(*)::int n from attendance_challenge where issued_to = $1 and created_at > now() - interval '10 minutes'`, [uid]);
    if (recent.rows[0].n >= MAX_CHALLENGES_PER_10_MIN) throw httpError(429, 'Too many attempts. Wait a few minutes and try again.');
    const id = crypto.randomUUID();
    const action = crypto.randomInt(2) === 0 ? 'turn_left' : 'turn_right';
    await p.query(
      `insert into attendance_challenge(id, tenant_id, issued_to, mode, action, expires_at)
       values ($1,$2,$3,$4,$5, now() + make_interval(secs => $6))`,
      [id, tid, uid, mode, action, CHALLENGE_TTL_SECONDS]);
    res.json({ success: true, data: { challengeId: id, action, mode, expiresInSeconds: CHALLENGE_TTL_SECONDS } });
  }));

  app.post('/api/attendance/face-checkin', wrap(async (req, res) => {
    const { tid, uid } = req.auth;
    const b = req.body || {};
    const frames = Array.isArray(b.frames) ? b.frames : [];
    if (frames.length < 2 || frames.length > 4) throw httpError(400, 'Send 2 to 4 camera frames');

    // 1. one-time challenge, claimed atomically so it can't be replayed
    const ch = await p.query(
      `update attendance_challenge set used_at = now()
        where id = $1 and tenant_id = $2 and issued_to = $3 and used_at is null and expires_at > now()
        returning mode, action`, [String(b.challengeId || ''), tid, uid]);
    const reasons = [], flags = [];
    if (!ch.rows.length) throw httpError(422, REASON_TEXT.challenge_invalid, { reasons: ['challenge_invalid'] });
    const { mode, action } = ch.rows[0];
    const settings = await getSettings(tid);
    const location = cleanLocation(b.location);
    const deviceId = (b.deviceId || '').toString().slice(0, 100) || null;

    // 2. analyse every frame on the server
    const results = [];
    for (const f of frames) results.push(await engine.analyze(f));
    const faces = results.map((r) => r.faces);
    if (faces.some((fs) => fs.length === 0)) reasons.push('no_face');
    if (faces.some((fs) => fs.length > 1)) reasons.push('multiple_faces');
    const single = faces.every((fs) => fs.length === 1) ? faces.map((fs) => fs[0]) : null;

    let matchScore = null, livenessScore = null, matchedUserId = null;
    if (single) {
      if (single[0].boxRatio < MIN_FACE_AREA) reasons.push('face_too_far');
      for (let i = 1; i < single.length; i++) {
        if ((await engine.similarity(single[0].embedding, single[i].embedding)) < FRAME_CONSISTENCY) { reasons.push('face_changed_between_frames'); break; }
      }
      // liveness challenge: frame 0 is neutral, a later frame shows the turn
      const t0 = single[0].turn;
      const deltas = single.slice(1).map((f) => (f.turn === null || t0 === null ? 0 : f.turn - t0));
      const wanted = action === 'turn_left' ? 1 : -1;
      const best = Math.max(...deltas.map((d) => d * wanted));
      const worst = Math.min(...deltas.map((d) => d * wanted));
      if (best < MIN_TURN) reasons.push(worst <= -MIN_TURN ? 'turned_wrong_way' : 'liveness_challenge_failed');
      // anti-spoof on the frontal frames
      const realScores = single.map((f) => f.real).filter((v) => v !== null);
      livenessScore = realScores.length ? realScores.reduce((a, v) => a + v, 0) / realScores.length : null;
      if (livenessScore !== null) {
        if (livenessScore < settings.liveness_threshold * 0.5) reasons.push('spoof_suspected');
        else if (livenessScore < settings.liveness_threshold) flags.push('low_liveness');
      }
      // identity: average similarity of the neutral frame(s) to each enrollment
      const probe = [single[0], single[single.length - 1]];
      const enrolled = await activeEnrollments(tid);
      const perProbe = await Promise.all(probe.map((f) => engine.similarities(f.embedding, enrolled.map((e) => e.embedding))));
      const scored = enrolled.map((e, i) => ({ userId: e.user_id, score: perProbe.reduce((a, s) => a + s[i], 0) / probe.length }));
      scored.sort((a, b2) => b2.score - a.score);
      if (mode === 'self') {
        const mine = scored.find((x) => x.userId === uid);
        if (!mine) reasons.push('not_enrolled');
        else {
          matchScore = mine.score; matchedUserId = uid;
          const other = scored.find((x) => x.userId !== uid);
          if (mine.score < settings.match_threshold) {
            reasons.push(other && other.score >= settings.match_threshold ? 'face_matches_another_employee' : 'face_mismatch');
          } else if (mine.score < settings.review_threshold) flags.push('weak_match');
        }
      } else {
        const [top, second] = scored;
        if (!top || top.score < settings.match_threshold) { reasons.push('unknown_face'); if (top) matchScore = top.score; }
        else {
          matchScore = top.score; matchedUserId = top.userId;
          if (top.score < settings.review_threshold) flags.push('weak_match');
          if (second && top.score - second.score < KIOSK_MIN_MARGIN) flags.push('ambiguous_match');
        }
      }
    }

    // 3. location / geofence
    const sites = (await p.query('select id, name, latitude, longitude, radius_m from attendance_site where tenant_id = $1 and active', [tid])).rows;
    let site = null, distance = null;
    if (!location) {
      if (settings.require_geofence) reasons.push('location_required');
    } else {
      if (location.accuracy !== null && location.accuracy > settings.max_gps_accuracy_m) flags.push('poor_gps_accuracy');
      if (!sites.length) flags.push('no_site_configured');
      else {
        for (const s of sites) {
          const d = haversineMeters(location.latitude, location.longitude, s.latitude, s.longitude);
          if (distance === null || d < distance) { distance = d; site = s; }
        }
        const slack = Math.min(location.accuracy || 0, 50);
        if (distance > site.radius_m + slack) {
          if (settings.require_geofence) reasons.push('outside_site'); else flags.push('outside_site');
        }
      }
    }

    // 4. history-based checks for the identified employee
    let direction = null;
    if (matchedUserId) {
      const last = (await p.query(
        `select direction, "timestamp", latitude, longitude, device_id from safety_attendance_log
          where tenant_id = $1 and user_id = $2 and coalesce(review_status,'ok') <> 'rejected'
          order by "timestamp" desc limit 1`, [tid, matchedUserId])).rows[0];
      if (last) {
        const minutes = (Date.now() - new Date(last.timestamp).getTime()) / 60000;
        if (minutes < settings.min_minutes_between) reasons.push('duplicate_checkin');
        if (location && last.latitude != null && last.longitude != null) {
          const km = haversineMeters(location.latitude, location.longitude, last.latitude, last.longitude) / 1000;
          const hours = Math.max(minutes / 60, 1 / 60);
          if (km > 2 && km / hours > IMPOSSIBLE_SPEED_KMH) flags.push('impossible_travel');
        }
      }
      if (mode === 'self' && deviceId) {
        const prev = await p.query(
          `select 1 from safety_attendance_log where tenant_id = $1 and user_id = $2 and method = 'face' and device_id is not null limit 1`, [tid, matchedUserId]);
        const same = await p.query(
          `select 1 from safety_attendance_log where tenant_id = $1 and user_id = $2 and method = 'face' and device_id = $3 limit 1`, [tid, matchedUserId, deviceId]);
        if (prev.rows.length && !same.rows.length) flags.push('new_device');
      }
      direction = last && last.direction === 'In' ? 'Out' : 'In';
    }

    const photo = (() => { try { return engine.thumbnail(frames[0]); } catch { return null; } })();
    const ip = clientIp(req);
    const ua = (req.headers['user-agent'] || '').toString().slice(0, 300);
    const uniqueReasons = [...new Set(reasons)];

    if (uniqueReasons.length) {
      await p.query(
        `insert into attendance_rejected_attempt(tenant_id, claimed_user_id, matched_user_id, recorded_by, mode, reasons, match_score,
           liveness_score, latitude, longitude, gps_accuracy_m, ip, user_agent, photo)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [tid, mode === 'self' ? uid : null, matchedUserId, uid, mode, uniqueReasons, matchScore, livenessScore,
          location && location.latitude, location && location.longitude, location && location.accuracy, ip, ua, photo]);
      return res.status(422).json({ success: false, error: uniqueReasons.map((r) => REASON_TEXT[r] || r).join(' '), reasons: uniqueReasons });
    }

    const uniqueFlags = [...new Set(flags)];
    const ins = await p.query(
      `insert into safety_attendance_log(tenant_id, user_id, direction, "timestamp", source, device_id, method, match_score, liveness_score,
         latitude, longitude, gps_accuracy_m, site_id, distance_m, ip, user_agent, photo, flags, review_status, recorded_by)
       values ($1,$2,$3,now(),$4,$5,'face',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id, "timestamp"`,
      [tid, matchedUserId, direction, mode === 'kiosk' ? 'Face (kiosk)' : 'Face (self)', deviceId, matchScore, livenessScore,
        location && location.latitude, location && location.longitude, location && location.accuracy,
        site && site.id, distance, ip, ua, photo, uniqueFlags.length ? uniqueFlags : null,
        uniqueFlags.length ? 'flagged' : 'ok', uid]);
    const who = (await p.query('select full_name from users where user_id = $1', [matchedUserId])).rows[0];
    res.json({ success: true, data: {
      id: ins.rows[0].id, time: ins.rows[0].timestamp, direction, employeeName: who && who.full_name,
      flagged: uniqueFlags.length > 0, flags: uniqueFlags.map((f) => FLAG_TEXT[f] || f), site: site && site.name,
    } });
  }));

  // ---------------- HR: register, review, rejected attempts ----------------

  // Day boundaries follow the HR user's browser time zone (tzOffset = JS getTimezoneOffset()).
  function dayRange(dateStr, tzOffset) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) throw httpError(400, 'date must be YYYY-MM-DD');
    const off = Number.isFinite(Number(tzOffset)) ? Number(tzOffset) : 0;
    const start = new Date(Date.parse(dateStr + 'T00:00:00Z') + off * 60000);
    return [start, new Date(start.getTime() + 86400000)];
  }

  app.get('/api/attendance/register', wrap(async (req, res) => {
    await requireHr(req);
    const [from, to] = dayRange(req.query.date, req.query.tzOffset);
    const r = await p.query(
      `select u.user_id as "UserId", u.full_name as "FullName",
              exists(select 1 from attendance_face_enrollment e where e.tenant_id = cu.tenant_id and e.user_id = cu.user_id and e.active) as "Enrolled",
              min(l."timestamp") filter (where l.direction = 'In') as "FirstIn",
              max(l."timestamp") filter (where l.direction = 'Out') as "LastOut",
              count(l.id)::int as "Entries",
              count(l.id) filter (where l.review_status = 'flagged')::int as "Flagged"
         from company_users cu
         join users u on u.user_id = cu.user_id
         left join safety_attendance_log l on l.tenant_id = cu.tenant_id and l.user_id = cu.user_id
              and l."timestamp" >= $2 and l."timestamp" < $3 and coalesce(l.review_status,'ok') <> 'rejected'
        where cu.tenant_id = $1 and cu.is_active
        group by u.user_id, u.full_name, cu.tenant_id, cu.user_id
        order by u.full_name`, [req.auth.tid, from, to]);
    const rejected = await p.query(
      'select count(*)::int n from attendance_rejected_attempt where tenant_id = $1 and created_at >= $2 and created_at < $3',
      [req.auth.tid, from, to]);
    const sites = await p.query('select count(*)::int n from attendance_site where tenant_id = $1 and active', [req.auth.tid]);
    res.json({ success: true, data: r.rows, summary: { rejectedAttempts: rejected.rows[0].n, sites: sites.rows[0].n } });
  }));

  app.get('/api/attendance/review', wrap(async (req, res) => {
    await requireHr(req);
    const status = ['flagged', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'flagged';
    const r = await p.query(
      `select l.id as "Id", l.user_id as "UserId", u.full_name as "FullName", l.direction as "Direction", l."timestamp" as "Timestamp",
              l.source as "Source", l.match_score as "MatchScore", l.liveness_score as "LivenessScore", l.flags as "Flags",
              l.latitude as "Latitude", l.longitude as "Longitude", l.gps_accuracy_m as "GpsAccuracy", l.distance_m as "DistanceM",
              s.name as "SiteName", l.photo as "Photo", e.photo as "EnrolledPhoto", l.review_status as "ReviewStatus",
              l.review_note as "ReviewNote", ru.full_name as "ReviewedBy", l.reviewed_at as "ReviewedAt"
         from safety_attendance_log l
         join users u on u.user_id = l.user_id
         left join attendance_site s on s.id = l.site_id
         left join attendance_face_enrollment e on e.tenant_id = l.tenant_id and e.user_id = l.user_id and e.active
         left join users ru on ru.user_id = l.reviewed_by
        where l.tenant_id = $1 and l.review_status = $2
        order by l."timestamp" desc limit 200`, [req.auth.tid, status]);
    res.json({ success: true, data: r.rows.map((x) => ({ ...x, FlagText: (x.Flags || []).map((f) => FLAG_TEXT[f] || f) })) });
  }));

  app.post('/api/attendance/logs/:id/review', wrap(async (req, res) => {
    await requireHr(req);
    const decision = (req.body || {}).decision;
    if (!['approved', 'rejected'].includes(decision)) throw httpError(400, 'decision must be approved or rejected');
    const note = ((req.body || {}).note || '').toString().slice(0, 500) || null;
    if (decision === 'rejected' && !note) throw httpError(400, 'Give a reason when rejecting a check-in');
    const r = await p.query(
      `update safety_attendance_log set review_status = $3, review_note = $4, reviewed_by = $5, reviewed_at = now()
        where id = $1 and tenant_id = $2 and review_status in ('flagged','approved','rejected')`,
      [parseInt(req.params.id), req.auth.tid, decision, note, req.auth.uid]);
    if (!r.rowCount) throw httpError(404, 'Check-in not found');
    res.json({ success: true });
  }));

  app.get('/api/attendance/rejected', wrap(async (req, res) => {
    await requireHr(req);
    const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 7));
    const r = await p.query(
      `select a.id as "Id", a.created_at as "CreatedAt", a.mode as "Mode", a.reasons as "Reasons",
              cu.full_name as "ClaimedName", mu.full_name as "MatchedName", ru.full_name as "RecordedBy",
              a.match_score as "MatchScore", a.liveness_score as "LivenessScore", a.latitude as "Latitude", a.longitude as "Longitude",
              a.ip as "Ip", a.photo as "Photo"
         from attendance_rejected_attempt a
         left join users cu on cu.user_id = a.claimed_user_id
         left join users mu on mu.user_id = a.matched_user_id
         left join users ru on ru.user_id = a.recorded_by
        where a.tenant_id = $1 and a.created_at > now() - make_interval(days => $2)
        order by a.created_at desc limit 300`, [req.auth.tid, days]);
    res.json({ success: true, data: r.rows.map((x) => ({ ...x, ReasonText: (x.Reasons || []).map((k) => REASON_TEXT[k] || k) })) });
  }));

  // ---------------- housekeeping ----------------

  async function purge() {
    try {
      await p.query(`delete from attendance_challenge where expires_at < now() - interval '1 day'`);
      await p.query(
        `update safety_attendance_log l set photo = null
          where l.photo is not null and coalesce(l.review_status,'ok') <> 'flagged'
            and l."timestamp" < now() - make_interval(days => coalesce((select s.photo_retention_days from attendance_settings s where s.tenant_id = l.tenant_id), 90))`);
      await p.query(
        `update attendance_rejected_attempt a set photo = null
          where a.photo is not null
            and a.created_at < now() - make_interval(days => coalesce((select s.photo_retention_days from attendance_settings s where s.tenant_id = a.tenant_id), 90))`);
    } catch (e) { console.warn('Attendance purge failed:', e.message); }
  }
  setTimeout(purge, 60 * 1000).unref();
  setInterval(purge, 24 * 3600 * 1000).unref();

  console.log('✅ Face attendance routes configured');
}

module.exports = { setupAttendanceRoutes, REASON_TEXT, FLAG_TEXT };
