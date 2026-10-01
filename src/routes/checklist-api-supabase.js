/**
 * Safety Checklist API — Supabase (Postgres) implementation.
 * Mirrors routes/checklist-api.js route-for-route. Tables already exist
 * (created via supabase/04_safety_schema.sql), so /init is a no-op.
 */

const { createSupabasePgPool } = require('../db/supabase');

let pool = null;
function getPool() {
  if (!pool) pool = createSupabasePgPool();
  return pool;
}

function setupChecklistRoutes(app) {
  const p = getPool();

  app.post('/api/safety/checklist/init', async (_req, res) => {
    res.json({ success: true, message: 'Database tables initialized successfully' });
  });

  app.get('/api/safety/checklist/headings/:tabId', async (req, res) => {
    try {
      const { tabId } = req.params;
      const r = await p.query(
        `select id, tab_id, heading_text, heading_slug, display_order, created_at
         from safety_checklist_headings where tab_id = $1 order by display_order, id`,
        [tabId]
      );
      res.json(r.rows);
    } catch (err) {
      console.error('Error fetching checklist headings:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/safety/checklist/headings', async (req, res) => {
    try {
      const { tabId, headingText, headingSlug, displayOrder } = req.body;
      if (!tabId || !headingText || !headingSlug) return res.status(400).json({ error: 'Missing required fields' });
      const r = await p.query(
        `insert into safety_checklist_headings(tab_id, heading_text, heading_slug, display_order)
         values ($1,$2,$3,$4) returning id`,
        [tabId, headingText, headingSlug, displayOrder || 0]
      );
      res.json({ success: true, id: r.rows[0].id, message: 'Heading created successfully' });
    } catch (err) {
      console.error('Error creating heading:', err.message);
      if (err.code === '23505') return res.status(409).json({ error: 'Heading already exists' });
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/safety/checklist/headings/:id', async (req, res) => {
    try {
      await p.query('delete from safety_checklist_headings where id = $1', [req.params.id]);
      res.json({ success: true, message: 'Heading deleted successfully' });
    } catch (err) {
      console.error('Error deleting heading:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/safety/checklist/items/:tabId', async (req, res) => {
    try {
      const { tabId } = req.params;
      const r = await p.query(
        `select id, tab_id, heading_text, heading_slug, item_text, options, display_order, created_at, is_active
         from safety_checklist_items where tab_id = $1 and is_active = true order by heading_slug, display_order, id`,
        [tabId]
      );
      res.json(r.rows);
    } catch (err) {
      console.error('Error fetching checklist items:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/safety/checklist/items', async (req, res) => {
    try {
      const { tabId, headingText, headingSlug, itemText, options, displayOrder } = req.body;
      if (!tabId || !headingText || !headingSlug || !itemText || !options) return res.status(400).json({ error: 'Missing required fields' });
      const optionsStr = Array.isArray(options) ? options.join(',') : options;
      const r = await p.query(
        `insert into safety_checklist_items(tab_id, heading_text, heading_slug, item_text, options, display_order)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [tabId, headingText, headingSlug, itemText, optionsStr, displayOrder || 0]
      );
      res.json({ success: true, id: r.rows[0].id, message: 'Item created successfully' });
    } catch (err) {
      console.error('Error creating item:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/safety/checklist/items/:id', async (req, res) => {
    try {
      await p.query('update safety_checklist_items set is_active = false, updated_at = now() where id = $1', [req.params.id]);
      res.json({ success: true, message: 'Item deleted successfully' });
    } catch (err) {
      console.error('Error deleting item:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { setupChecklistRoutes };
