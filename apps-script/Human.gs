/**
 * Ediciones hechas a mano en las planillas (activadores instalables "Al editar" y "Al cambiar").
 * - Fila nueva sin ID → se le asigna un ID y fecha de creación.
 * - Fechas "15/10/2026" → "2026-10-15"; importes "45.000" → 45000; personas e inversiones por nombre.
 * - Si faltan datos obligatorios, la fila queda marcada con una nota y NO se publica a la app hasta completarla.
 * - Cada fila completa recibe una versión y revisión nuevas: la app la descarga en su próxima sincronización.
 * - Si se borran filas, cambia IDS_EPOCH y la app compara IDs para quitar lo eliminado (con límite de seguridad).
 * Las escrituras hechas por el propio script no disparan estos activadores (no hay bucles).
 */

var DEFAULTS_ = {
  tasks: { category: 'otras', priority: 'media', status: 'pendiente' },
  events: { category: 'otros', rsvp: 'pendiente' },
  shoppingItems: { category: 'supermercado', priority: 'media', status: 'pendiente', listId: 'list-principal' },
  payments: { category: 'otros', currency: 'ARS', status: 'pendiente' },
  expenses: { category: 'otros', currency: 'ARS' },
  repairs: { status: 'reportada' },
  documents: { category: 'otros', visibility: 'adultos' },
  investments: { kind: 'otro', currency: 'USD' },
  investmentContracts: { currency: 'ARS', status: 'vigente' },
  investmentTaxes: { currency: 'ARS', status: 'pendiente' },
  investmentWorks: { currency: 'ARS', status: 'pendiente' },
  healthNotes: { kind: 'indicacion' },
  treatments: { status: 'activo' },
  medications: { status: 'activo' },
  vaccinations: { status: 'pendiente' },
};

function onSheetEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  var entity = entityForSheet_(sh.getParent().getId(), sh.getName());
  if (!entity) return;
  var first = Math.max(e.range.getRow(), 2), last = e.range.getLastRow();
  if (last < 2) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var r = processHumanRows_(entity, first, last);
    if (r.published && entity === 'investments') syncInvestmentFolders_();
    else if (r.published && /^investment/.test(entity)) rebuildInvestmentTabs_();
  } finally {
    lock.releaseLock();
  }
}

/** Procesa filas [first, last] (números de fila de la hoja). Devuelve cuántas se publicaron y cuántas quedaron incompletas. */
function processHumanRows_(entity, first, last) {
  var t = new Table_(entity);
  var now = new Date().toISOString();
  var required = SCHEMA.required[entity] || [];
  var out = { published: 0, incomplete: 0 };
  for (var row = first; row <= last; row++) {
    var i = row - 2;
    if (i >= t.values.length) break;
    var raw = t.values[i];
    var hasContent = raw.slice(SCHEMA.systemFields.length).some(function (c) { return c !== '' && c !== null; });
    if (!hasContent) continue;
    var rec = t.toRecord(raw);
    if (!rec.id) { rec.id = Utilities.getUuid(); rec.createdAt = now; rec.version = 0; rec.origin = 'planilla'; }
    var d = DEFAULTS_[entity] || {};
    Object.keys(d).forEach(function (k) { if (rec[k] === undefined || rec[k] === '') rec[k] = d[k]; });
    var missing = required.filter(function (k) { return rec[k] === undefined || rec[k] === '' || rec[k] === null; });
    var idCell = t.sheet.getRange(row, SCHEMA.systemFields.length + 1);
    if (missing.length) {
      t.putAt(i, rec);
      idCell.setNote('Falta completar: ' + missing.map(function (k) { return labelOf_(entity, k); }).join(', ') + '. La app no la verá hasta completarla.');
      out.incomplete++;
      continue;
    }
    rec.version = Number(rec.version || 0) + 1;
    rec.rev = nextRev_();
    rec.updatedAt = now;
    rec.updatedBy = 'planilla';
    t.putAt(i, rec);
    idCell.setNote('');
    out.published++;
  }
  t.flush();
  return out;
}

function labelOf_(entity, key) {
  var f = fields_(entity).filter(function (x) { return x[0] === key; })[0];
  return f ? (f[2] || key) : key;
}

/** Al borrar filas a mano: avisa a los dispositivos que comparen IDs. */
function onSheetChange(e) {
  if (e && e.changeType && e.changeType !== 'REMOVE_ROW' && e.changeType !== 'OTHER') return;
  props_().setProperty('IDS_EPOCH', new Date().toISOString());
}

/** IDs vigentes por entidad (para que la app quite lo que se borró en la planilla). */
function ids_() {
  var out = {};
  SCHEMA.syncOrder.forEach(function (entity) {
    var sh = sheetOf_(entity);
    if (!sh || sh.getLastRow() < 2) { out[entity] = []; return; }
    out[entity] = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); }).filter(String);
  });
  return { ids: out, idsEpoch: props_().getProperty('IDS_EPOCH') || '' };
}
