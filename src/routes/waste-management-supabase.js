/**
 * Waste Management API Routes — Supabase (Postgres) implementation.
 * Mirrors routes/waste-management.js route-for-route.
 */

const express = require('express');
const { createSupabasePgPool } = require('../db/supabase');

let pool = null;
function getPool() {
  if (!pool) pool = createSupabasePgPool();
  return pool;
}

function setupWasteManagementRoutes(app) {
  const p = getPool();
  const router = express.Router();

  // Every route is scoped to the signed-in user's tenant (login is enforced by
  // the /api/waste middleware in web-server.js).
  router.get('/management', async (req, res) => {
    try {
      const r = await p.query('select * from waste_management where tenant_id = $1 order by created_at desc', [req.auth.tid]);
      res.json({ success: true, data: r.rows, count: r.rows.length });
    } catch (error) {
      console.error('Error fetching waste management records:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/management/:id', async (req, res) => {
    try {
      const r = await p.query('select * from waste_management where id = $1 and tenant_id = $2', [req.params.id, req.auth.tid]);
      if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'Waste management record not found' });
      res.json({ success: true, data: r.rows[0] });
    } catch (error) {
      console.error('Error fetching waste management record:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/management', async (req, res) => {
    try {
      const { dateOfWasteGeneration, wasteCategory, typeOfWaste, quantityOfWaste, unit, sourceOfWaste,
        collectionMethod, storageMethod, storageDuration, warehouseName, location, notes } = req.body;
      if (!dateOfWasteGeneration || !wasteCategory || !typeOfWaste || !quantityOfWaste) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }
      const r = await p.query(
        `insert into waste_management(tenant_id, date_of_waste_generation, waste_category, type_of_waste, quantity_of_waste,
           unit, source_of_waste, collection_method, storage_method, storage_duration_days, warehouse_name, location, notes, created_by)
         values ($13,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'system') returning id`,
        [new Date(dateOfWasteGeneration), wasteCategory, typeOfWaste, quantityOfWaste, unit || '', sourceOfWaste || '',
          collectionMethod || '', storageMethod || '', storageDuration || 0, warehouseName || '', location || '', notes || null, req.auth.tid]
      );
      res.status(201).json({ success: true, message: 'Waste management record created successfully', id: r.rows[0].id, data: req.body });
    } catch (error) {
      console.error('Error creating waste management record:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.put('/management/:id', async (req, res) => {
    try {
      const { dateOfWasteGeneration, wasteCategory, typeOfWaste, quantityOfWaste, unit, sourceOfWaste,
        collectionMethod, storageMethod, storageDuration, warehouseName, location, notes } = req.body;
      const r = await p.query(
        `update waste_management set date_of_waste_generation=$2, waste_category=$3, type_of_waste=$4, quantity_of_waste=$5,
           unit=$6, source_of_waste=$7, collection_method=$8, storage_method=$9, storage_duration_days=$10,
           warehouse_name=$11, location=$12, notes=$13, updated_by='system', updated_at=now()
         where id = $1 and tenant_id = $14`,
        [req.params.id, new Date(dateOfWasteGeneration), wasteCategory, typeOfWaste, quantityOfWaste, unit || '',
          sourceOfWaste || '', collectionMethod || '', storageMethod || '', storageDuration || 0, warehouseName || '',
          location || '', notes || null, req.auth.tid]
      );
      if (!r.rowCount) return res.status(404).json({ success: false, error: 'Waste management record not found' });
      res.json({ success: true, message: 'Waste management record updated successfully', id: req.params.id });
    } catch (error) {
      console.error('Error updating waste management record:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.delete('/management/:id', async (req, res) => {
    try {
      const r = await p.query('delete from waste_management where id = $1 and tenant_id = $2', [req.params.id, req.auth.tid]);
      if (!r.rowCount) return res.status(404).json({ success: false, error: 'Waste management record not found' });
      res.json({ success: true, message: 'Waste management record deleted successfully' });
    } catch (error) {
      console.error('Error deleting waste management record:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.use('/api/waste', router);
}

module.exports = { setupWasteManagementRoutes };
