/**
 * Water Management API Routes — Supabase (Postgres) implementation.
 * Mirrors routes/water-management.js route-for-route.
 */

const express = require('express');
const { createSupabasePgPool } = require('../db/supabase');

let pool = null;
function getPool() {
  if (!pool) pool = createSupabasePgPool();
  return pool;
}

// Each module: JS body field -> Postgres column, in the exact order the
// legacy stored procedures accepted them (order doesn't matter for named
// params, but keeping it 1:1 makes this easy to audit against the source).
const MODULES = {
  buying: {
    table: 'water_buying', idPath: '/buying',
    fields: [
      ['supplierName', 'supplier_name'], ['supplierContact', 'supplier_contact'],
      ['dateOfPurchase', 'date_of_purchase', 'date'], ['quantityPurchased', 'quantity_purchased'],
      ['unit', 'unit'], ['costPerUnit', 'cost_per_unit'], ['totalCost', 'total_cost'],
      ['paymentMethod', 'payment_method'], ['invoiceNumber', 'invoice_number'], ['waterTank', 'water_tank'],
      ['notes', 'notes'],
    ],
    required: ['supplierName', 'invoiceNumber', 'dateOfPurchase'],
    responseShape: 'id',
    label: 'Water buying record',
  },
  rain: {
    table: 'water_rain_collection', idPath: '/rain',
    fields: [
      ['collectionDate', 'collection_date', 'date'], ['collectionLocation', 'collection_location'],
      ['quantityCollected', 'quantity_collected'], ['collectionUnit', 'collection_unit'],
      ['rainTank', 'rain_tank'], ['waterQuality', 'water_quality'], ['treatmentRequired', 'treatment_required'],
      ['treatmentType', 'treatment_type'], ['collectedBy', 'collected_by'], ['notes', 'notes'],
    ],
    required: [],
    responseShape: 'id',
    label: 'Rain collection record',
  },
  usage: {
    table: 'water_usage', idPath: '/usage',
    fields: [
      ['department', 'department'], ['dateOfUsage', 'date_of_usage', 'date'], ['quantityUsed', 'quantity_used'],
      ['unit', 'unit'], ['purposeOfUsage', 'purpose_of_usage'], ['waterEfficientTech', 'water_efficient_tech'],
      ['reductionPercentage', 'reduction_percentage'], ['sourceOfWater', 'source_of_water'],
      ['availableQty', 'available_qty'], ['usageMonth', 'usage_month', 'date'], ['notes', 'notes'],
    ],
    required: ['department', 'dateOfUsage', 'quantityUsed'],
    responseShape: 'id',
    label: 'Water usage record',
  },
  discharge: {
    table: 'water_discharge_quality', idPath: '/discharge',
    fields: [
      ['monitoringFrequency', 'monitoring_frequency'], ['samplingPointsLocations', 'sampling_points_locations'],
      ['personResponsible', 'person_responsible'], ['commentsObservations', 'comments_observations'],
      ['laboratoryUsed', 'laboratory_used'], ['parametersMonitored', 'parameters_monitored'],
      ['resultValue', 'result_value', 'float'], ['units', 'units'], ['complianceStandards', 'compliance_standards'],
      ['monitoringEquipment', 'monitoring_equipment'], ['monitoringDate', 'monitoring_date', 'date'],
    ],
    required: [],
    responseShape: 'id',
    label: 'Discharge quality record',
  },
  recycling: {
    table: 'water_recycling', idPath: '/recycling',
    fields: [
      ['department', 'department'], ['dateOfRecycling', 'date_of_recycling', 'date'],
      ['recyclingMethod', 'recycling_method'], ['quantityRecycled', 'quantity_recycled'],
      ['unit', 'unit'], ['waterTank', 'water_tank'], ['notes', 'notes'],
    ],
    required: ['department', 'dateOfRecycling', 'recyclingMethod', 'quantityRecycled', 'unit', 'waterTank'],
    responseShape: 'row',
    label: 'Water recycling record',
  },
  waste: {
    table: 'water_waste', idPath: '/waste',
    fields: [
      ['department', 'department'], ['dateOfWasteGeneration', 'date_of_waste_generation', 'date'],
      ['quantityOfWastewater', 'quantity_of_wastewater'], ['unit', 'unit'],
      ['typeOfWastewater', 'type_of_wastewater'], ['wastewaterTreatmentProcess', 'wastewater_treatment_process'],
      ['percentageOfPollutantRemoval', 'percentage_of_pollutant_removal'], ['disposalMethod', 'disposal_method'],
      ['quantityDisposed', 'quantity_disposed'], ['disposedUnit', 'disposed_unit'], ['notes', 'notes'],
    ],
    required: ['department', 'dateOfWasteGeneration', 'quantityOfWastewater', 'unit', 'typeOfWastewater', 'wastewaterTreatmentProcess', 'disposalMethod', 'quantityDisposed', 'disposedUnit'],
    responseShape: 'row',
    label: 'Water waste record',
  },
};

function coerce(value, kind) {
  if (value === undefined) return null;
  if (kind === 'date') return value ? new Date(value) : null;
  if (kind === 'float') return value ? parseFloat(value) : null;
  return value === '' ? null : value;
}

function setupWaterManagementRoutes(app) {
  const p = getPool();
  const router = express.Router();

  // Every route is scoped to the signed-in user's tenant (login is enforced by
  // the /api/water middleware in web-server.js).
  for (const [, cfg] of Object.entries(MODULES)) {
    router.get(cfg.idPath, async (req, res) => {
      try {
        const r = await p.query(`select * from ${cfg.table} where tenant_id = $1 order by created_at desc`, [req.auth.tid]);
        res.json({ success: true, data: r.rows, count: r.rows.length });
      } catch (error) {
        console.error(`Error fetching ${cfg.label} records:`, error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    router.get(`${cfg.idPath}/:id`, async (req, res) => {
      try {
        const r = await p.query(`select * from ${cfg.table} where id = $1 and tenant_id = $2`, [req.params.id, req.auth.tid]);
        if (r.rows.length === 0) return res.status(404).json({ success: false, error: `${cfg.label} not found` });
        res.json({ success: true, data: r.rows[0] });
      } catch (error) {
        console.error(`Error fetching ${cfg.label}:`, error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    router.post(cfg.idPath, async (req, res) => {
      try {
        const missing = cfg.required.filter((k) => !req.body[k]);
        if (missing.length) return res.status(400).json({ success: false, error: 'Missing required fields' });
        const cols = ['tenant_id', 'created_by', ...cfg.fields.map(([, col]) => col)];
        const vals = [req.auth.tid, 'system', ...cfg.fields.map(([key, , kind]) => coerce(req.body[key], kind))];
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        const r = await p.query(`insert into ${cfg.table}(${cols.join(', ')}) values (${placeholders}) returning *`, vals);
        if (cfg.responseShape === 'row') {
          res.json({ success: true, data: r.rows[0], message: `${cfg.label} created successfully` });
        } else {
          res.status(201).json({ success: true, message: `${cfg.label} created successfully`, id: r.rows[0].id, data: req.body });
        }
      } catch (error) {
        console.error(`Error creating ${cfg.label}:`, error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    router.put(`${cfg.idPath}/:id`, async (req, res) => {
      try {
        const missing = cfg.required.filter((k) => !req.body[k]);
        if (missing.length) return res.status(400).json({ success: false, error: 'Missing required fields' });
        const assigns = cfg.fields.map(([, col], i) => `${col} = $${i + 3}`).join(', ');
        const vals = [req.params.id, req.auth.tid, ...cfg.fields.map(([key, , kind]) => coerce(req.body[key], kind))];
        const r = await p.query(`update ${cfg.table} set ${assigns}, updated_by = 'system', updated_at = now() where id = $1 and tenant_id = $2`, vals);
        if (!r.rowCount) return res.status(404).json({ success: false, error: `${cfg.label} not found` });
        res.json({ success: true, message: `${cfg.label} updated successfully`, id: req.params.id });
      } catch (error) {
        console.error(`Error updating ${cfg.label}:`, error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    router.delete(`${cfg.idPath}/:id`, async (req, res) => {
      try {
        const r = await p.query(`delete from ${cfg.table} where id = $1 and tenant_id = $2`, [req.params.id, req.auth.tid]);
        if (!r.rowCount) return res.status(404).json({ success: false, error: `${cfg.label} not found` });
        res.json({ success: true, message: `${cfg.label} deleted successfully` });
      } catch (error) {
        console.error(`Error deleting ${cfg.label}:`, error);
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }

  app.use('/api/water', router);
}

module.exports = { setupWaterManagementRoutes };
