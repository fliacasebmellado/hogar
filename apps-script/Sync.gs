/**
 * Sincronización: push (operaciones idempotentes con control de versión) y pull (cambios desde una revisión).
 * - Cada registro tiene `version` (se incrementa en cada escritura) y `rev` (contador global del hogar).
 * - Las operaciones aplicadas se registran en la hoja _ops por opId: reenviar una operación no la duplica.
 * - Si baseVersion no coincide con la versión actual → "conflict" (no se sobrescribe), salvo force=true (restauración).
 * - Las escrituras se serializan con LockService para que dos dispositivos no se pisen.
 */

function nextRev_() {
  var p = props_();
  var rev = Number(p.getProperty('REV') || 0) + 1;
  p.setProperty('REV', String(rev));
  return rev;
}

function opsIndex_() {
  var sh = metaSheet_('_ops', ['opId', 'at', 'entity', 'recordId', 'version', 'deviceId']);
  var last = sh.getLastRow();
  var idx = {};
  if (last > 1) {
    var vals = sh.getRange(2, 1, last - 1, 4).getValues();
    for (var i = 0; i < vals.length; i++) idx[String(vals[i][0])] = { entity: String(vals[i][2]), recordId: String(vals[i][3]) };
  }
  return { sheet: sh, idx: idx, appended: [] };
}

function sanitize_(entity, rec) {
  var out = {};
  columns_(entity).forEach(function (c) { if (rec[c] !== undefined) out[c] = rec[c]; });
  return out;
}

function push_(req) {
  if (!req.ops || !req.ops.length) return { results: [] };
  if (req.ops.length > 100) throw err_('Lote demasiado grande', 'format');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw err_('El servidor está ocupado; se reintentará.', 'busy');
  try {
    var ops = opsIndex_();
    var tables = {};
    var table = function (e) { return tables[e] || (tables[e] = new Table_(e)); };
    var results = [];
    var moves = [];
    var touched = {};
    var now = new Date().toISOString();
    req.ops.forEach(function (op) {
      try {
        if (!SCHEMA.entities[op.entity]) throw err_('Entidad desconocida', 'format');
        if (!op.opId || !op.record || op.record.id !== op.recordId || !op.recordId) throw err_('Operación mal formada', 'format');
        var t = table(op.entity);
        if (ops.idx[op.opId]) {
          results.push({ opId: op.opId, status: 'duplicate', record: t.get(op.recordId) });
          return;
        }
        var current = t.get(op.recordId);
        var currentVersion = current ? Number(current.version || 0) : 0;
        if (current && !op.force && currentVersion !== Number(op.baseVersion || 0)) {
          results.push({ opId: op.opId, status: 'conflict', record: current });
          return;
        }
        var rec = sanitize_(op.entity, op.record);
        rec.version = currentVersion + 1;
        rec.rev = nextRev_();
        if (current && current.createdAt) rec.createdAt = current.createdAt;
        if (!rec.updatedAt) rec.updatedAt = now;
        t.put(rec);
        touched[op.entity] = true;
        if (op.entity === 'attachments') moves.push([current, rec]);
        ops.idx[op.opId] = { entity: op.entity, recordId: op.recordId };
        ops.appended.push([op.opId, now, op.entity, op.recordId, String(rec.version), String(req.deviceId || '')]);
        results.push({ opId: op.opId, status: 'applied', record: t.get(op.recordId) });
      } catch (e) {
        results.push({ opId: op.opId, status: 'error', error: String(e.message || e) });
      }
    });
    Object.keys(tables).forEach(function (k) { tables[k].flush(); });
    moves.forEach(function (m) { moveFileIfNeeded_(m[0], m[1]); });
    try {
      if (touched.investments) syncInvestmentFolders_();
      else if (touched.investmentContracts || touched.investmentTaxes || touched.investmentWorks) rebuildInvestmentTabs_();
    } catch (e) { logError_('inversiones', e); }
    if (ops.appended.length) {
      ensureSize_(ops.sheet, ops.sheet.getLastRow() + ops.appended.length, 6);
      ops.sheet.getRange(ops.sheet.getLastRow() + 1, 1, ops.appended.length, 6).setValues(ops.appended);
    }
    return { results: results };
  } finally {
    lock.releaseLock();
  }
}

function pull_(req) {
  var since = Number(req.since || 0);
  var limit = Math.min(Number(req.limit || 500), 1000);
  var all = [];
  SCHEMA.syncOrder.forEach(function (entity) {
    var t = new Table_(entity);
    t.all().forEach(function (r) { if (Number(r.rev || 0) > since) all.push({ entity: entity, rec: r }); });
  });
  all.sort(function (a, b) { return Number(a.rec.rev) - Number(b.rec.rev); });
  var page = all.slice(0, limit);
  var rows = {};
  page.forEach(function (x) { (rows[x.entity] = rows[x.entity] || []).push(x.rec); });
  var maxRev = page.length ? Number(page[page.length - 1].rec.rev) : since;
  return { rows: rows, maxRev: maxRev, hasMore: all.length > limit, restoreEpoch: props_().getProperty('RESTORE_EPOCH') || '', idsEpoch: props_().getProperty('IDS_EPOCH') || '' };
}

function pruneOps_(days) {
  var sh = metaSheet_('_ops', ['opId', 'at', 'entity', 'recordId', 'version', 'deviceId']);
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var cutoff = new Date(Date.now() - days * 86400000).toISOString();
  var vals = sh.getRange(2, 1, last - 1, 6).getValues();
  var keep = vals.filter(function (r) { return String(r[1]) >= cutoff; });
  if (keep.length === vals.length) return 0;
  sh.getRange(2, 1, last - 1, 6).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, 6).setValues(keep);
  return vals.length - keep.length;
}
