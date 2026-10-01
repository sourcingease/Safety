/**
 * Safety Agent API — Supabase (Postgres) implementation.
 * Mirrors safety-agent-api.js route-for-route; registered instead of it when
 * ENABLE_SUPABASE_SAFETY=1.
 */

const path = require('path');
const fs = require('fs');
let multer = null; try { multer = require('multer'); } catch { /* optional */ }

async function extractText(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    try {
      const pdf = require('pdf-parse');
      const data = await pdf(fs.readFileSync(filePath));
      return (data && data.text) ? data.text : '';
    } catch (e) { return ''; }
  }
  if (mimeType?.startsWith('text/') || ext === '.txt') {
    try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
  }
  return '';
}

function classifyAndPropose(extractedText) {
  const t = (extractedText || '').toLowerCase();
  const proposals = [];
  const facts = [];
  function pushProposal(targetTable, payload) { proposals.push({ targetTable, action: 'INSERT', payload }); }

  if (/struct/i.test(t) || /beam|column|slab|foundation/.test(t)) {
    facts.push('Detected structural content');
    pushProposal('StructuralSafety', { InspectionDate: new Date().toISOString().slice(0, 10), Location: 'Auto-detected', InspectedBy: 'SafetyAgent', Status: 'Pending' });
  }
  if (/fire|sprinkler|alarm|evac/.test(t)) {
    facts.push('Detected fire safety content');
    pushProposal('FireSafety', { InspectionDate: new Date().toISOString().slice(0, 10), Location: 'Auto-detected', InspectedBy: 'SafetyAgent', Status: 'Pending' });
  }
  if (/electrical|voltage|wiring|breaker/.test(t)) {
    facts.push('Detected electrical safety content');
    pushProposal('ElectricalSafety', { InspectionDate: new Date().toISOString().slice(0, 10), Location: 'Auto-detected', InspectedBy: 'SafetyAgent', Status: 'Pending' });
  }
  if (/hazard|chemical|dust|noise|ergonomic/.test(t)) {
    facts.push('Detected health hazard content');
    pushProposal('HealthHazards', { AssessmentDate: new Date().toISOString().slice(0, 10), Location: 'Auto-detected', HazardType: 'Detected', RiskLevel: 'TBD' });
  }
  if (proposals.length === 0) facts.push('No specific module detected; created a generic note proposal');
  return { proposals, facts };
}

// Maps the legacy PascalCase target-table names (from classifyAndPropose,
// preserved verbatim since proposal payloads already stored this way) to the
// Postgres table + column whitelist used on approval.
const TARGET_TABLE_MAP = {
  FireSafety: { table: 'fire_safety', cols: { InspectionDate: 'inspection_date', Location: 'location', InspectedBy: 'inspected_by', Status: 'status' } },
  ElectricalSafety: { table: 'electrical_safety', cols: { InspectionDate: 'inspection_date', Location: 'location', InspectedBy: 'inspected_by', Status: 'status' } },
  StructuralSafety: { table: 'structural_safety', cols: { InspectionDate: 'inspection_date', Location: 'location', InspectedBy: 'inspected_by', Status: 'status' } },
  HealthHazards: { table: 'health_hazards', cols: { AssessmentDate: 'assessment_date', Location: 'location', HazardType: 'hazard_type', RiskLevel: 'risk_level' } },
};

async function createProposal(p, { tenantId, title, description, documentId, submittedBy, items }) {
  const r = await p.query(
    `insert into safety_proposals(tenant_id, title, description, document_id, submitted_by) values ($1,$2,$3,$4,$5) returning proposal_id`,
    [tenantId || null, title || null, description || null, documentId || null, submittedBy || null]
  );
  const proposalId = r.rows[0].proposal_id;
  for (const it of items || []) {
    await p.query(
      `insert into safety_proposal_items(proposal_id, target_table, action, payload) values ($1,$2,$3,$4)`,
      [proposalId, it.targetTable, it.action, JSON.stringify(it.payload || {})]
    );
  }
  return proposalId;
}

async function approveProposal(p, proposalId, approverId) {
  const items = await p.query('select item_id, target_table, action, payload from safety_proposal_items where proposal_id = $1', [proposalId]);
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    for (const row of items.rows) {
      if (row.action !== 'INSERT') continue;
      const mapping = TARGET_TABLE_MAP[row.target_table];
      if (!mapping) continue;
      const payload = JSON.parse(row.payload || '{}');
      const entries = Object.entries(mapping.cols).filter(([legacyKey]) => payload[legacyKey] !== undefined);
      if (entries.length === 0) continue;
      const cols = entries.map(([, col]) => col);
      const vals = entries.map(([legacyKey]) => payload[legacyKey]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      await client.query(`insert into ${mapping.table}(${cols.join(', ')}) values (${placeholders})`, vals);
    }
    await client.query(
      `update safety_proposals set status = 'approved', approved_by = $2, approved_at = now() where proposal_id = $1`,
      [proposalId, approverId]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

function setupSafetyAgentRoutes(app, pgPool, requireAuth) {
  const p = pgPool;

  let upload = null;
  if (multer) {
    const storage = multer.diskStorage({
      destination: function (_req, _file, cb) {
        const dir = path.join(__dirname, '../public/uploads/docs');
        try { fs.mkdirSync(dir, { recursive: true }); } catch {}
        cb(null, dir);
      },
      filename: function (_req, file, cb) {
        const ts = Date.now();
        const safe = (file.originalname || 'doc').replace(/[^a-zA-Z0-9_.-]/g, '_');
        cb(null, `${ts}-${safe}`);
      }
    });
    upload = multer({ storage });
  }

  app.post('/api/safety/agent/upload', requireAuth, (upload ? upload.single('file') : (req, res, next) => next()), async (req, res) => {
    try {
      const userId = req.auth?.uid || null;
      const tenantId = req.auth?.tid || null;
      if (!upload) return res.status(400).json({ success: false, error: 'File upload not available (multer not installed). Please install dependency and restart.' });
      if (!req.file) return res.status(400).json({ success: false, error: 'file is required (multipart/form-data)' });

      const fullPath = req.file.path;
      const publicPath = '/uploads/docs/' + path.basename(fullPath);
      const mime = req.file.mimetype;

      const text = await extractText(fullPath, mime);
      const { proposals, facts } = classifyAndPropose(text);
      const userNotes = (req.body?.notes || '').toString();
      const title = 'Safety Agent Import';
      const description = `Proposed ${proposals.length} change(s) from uploaded document.` + (userNotes ? ` Notes: ${userNotes}` : '');

      const docRes = await p.query(
        `insert into safety_documents(tenant_id, file_name, file_path, mime_type, size_bytes, extracted_text, uploaded_by)
         values ($1,$2,$3,$4,$5,$6,$7) returning document_id`,
        [tenantId, req.file.originalname, publicPath, mime, req.file.size, text || null, userId]
      );
      const documentId = docRes.rows[0].document_id;

      const proposalId = await createProposal(p, { tenantId, title, description, documentId, submittedBy: userId, items: proposals });
      res.json({ success: true, data: { proposalId, documentId, fileUrl: publicPath, facts, proposedItems: proposals } });
    } catch (e) {
      console.error('SafetyAgent upload failed:', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/safety/agent/propose', requireAuth, async (req, res) => {
    try {
      const text = (req.body?.text || '').toString();
      if (!text.trim()) return res.status(400).json({ success: false, error: 'text is required' });
      const { proposals, facts } = classifyAndPropose(text);
      const tenantId = req.auth?.tid || null;
      const userId = req.auth?.uid || null;
      const title = 'Safety Agent Text';
      const description = `Proposed ${proposals.length} change(s) from user text.`;
      const proposalId = await createProposal(p, { tenantId, title, description, documentId: null, submittedBy: userId, items: proposals });
      res.json({ success: true, data: { proposalId, facts, proposedItems: proposals } });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.get('/api/safety/agent/proposals', requireAuth, async (req, res) => {
    try {
      const status = (req.query.status || '').toString();
      const r = status
        ? await p.query(`select proposal_id as "ProposalId", tenant_id as "TenantId", title as "Title", description as "Description",
            status as "Status", document_id as "DocumentId", submitted_by as "SubmittedBy", submitted_at as "SubmittedAt",
            approved_by as "ApprovedBy", approved_at as "ApprovedAt", rejected_by as "RejectedBy", rejected_at as "RejectedAt",
            rejection_reason as "RejectionReason" from safety_proposals where status = $1 order by submitted_at desc`, [status])
        : await p.query(`select proposal_id as "ProposalId", tenant_id as "TenantId", title as "Title", description as "Description",
            status as "Status", document_id as "DocumentId", submitted_by as "SubmittedBy", submitted_at as "SubmittedAt",
            approved_by as "ApprovedBy", approved_at as "ApprovedAt", rejected_by as "RejectedBy", rejected_at as "RejectedAt",
            rejection_reason as "RejectionReason" from safety_proposals order by submitted_at desc`);
      res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.get('/api/safety/agent/proposals/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const pr = await p.query(`select proposal_id as "ProposalId", tenant_id as "TenantId", title as "Title", description as "Description",
        status as "Status", document_id as "DocumentId", submitted_by as "SubmittedBy", submitted_at as "SubmittedAt",
        approved_by as "ApprovedBy", approved_at as "ApprovedAt", rejected_by as "RejectedBy", rejected_at as "RejectedAt",
        rejection_reason as "RejectionReason" from safety_proposals where proposal_id = $1`, [id]);
      const items = await p.query('select item_id as "ItemId", target_table as "TargetTable", action as "Action", payload as "Payload" from safety_proposal_items where proposal_id = $1', [id]);
      res.json({ success: true, data: { proposal: pr.rows[0] || null, items: items.rows } });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.post('/api/safety/agent/proposals/:id/approve', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await approveProposal(p, id, req.auth?.uid || null);
      await p.query(`insert into safety_audit_log(proposal_id, action, actor_id, message) values ($1,'approved',$2,'Approved')`, [id, req.auth?.uid || null]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.post('/api/safety/agent/proposals/:id/reject', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const reason = (req.body?.reason || '').toString();
      await p.query(
        `update safety_proposals set status = 'rejected', rejected_by = $2, rejected_at = now(), rejection_reason = $3 where proposal_id = $1`,
        [id, req.auth?.uid || null, reason]
      );
      await p.query(`insert into safety_audit_log(proposal_id, action, actor_id, message) values ($1,'rejected',$2,$3)`, [id, req.auth?.uid || null, reason]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });
}

module.exports = { setupSafetyAgentRoutes };
