/**
 * Copias de seguridad en Drive (carpeta Hogar App/Backups), en el mismo formato JSON que la exportación de la app.
 * - Cada copia se relee y verifica (cantidades + SHA-256) antes de marcarse como válida.
 * - Solo se eliminan copias antiguas cuando la nueva es válida; nunca se reemplaza una copia válida por una incompleta.
 * - restoreBackup crea primero una copia "pre-restauración" del estado actual.
 */

var KEEP_BACKUPS = 30;

function sha256Str_(s) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}

function snapshot_() {
  var data = {};
  var counts = {};
  Object.keys(SCHEMA.entities).forEach(function (entity) {
    var rows = new Table_(entity).all();
    rows.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    data[entity] = rows;
    counts[entity] = rows.length;
  });
  var json = JSON.stringify(data);
  return { data: data, counts: counts, checksum: sha256Str_(json) };
}

function verifyBackupObject_(b) {
  var problems = [];
  if (!b || b.format !== 'hogar-backup') problems.push('formato');
  if (!b.data) problems.push('sin datos');
  else {
    Object.keys(SCHEMA.entities).forEach(function (e) {
      if (!b.data[e] || b.data[e].length !== b.counts[e]) problems.push('incompleta: ' + e);
    });
    if (!problems.length && sha256Str_(JSON.stringify(b.data)) !== b.checksum) problems.push('checksum');
  }
  return problems;
}

function backup_(kind) {
  var snap = snapshot_();
  var created = new Date();
  var obj = {
    format: 'hogar-backup', schemaVersion: SCHEMA.schemaVersion, createdAt: created.toISOString(), deviceId: 'servidor:' + kind,
    counts: snap.counts, checksum: snap.checksum, data: snap.data,
  };
  var name = 'hogar-backup-' + Utilities.formatDate(created, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss') + '-' + kind + '.json';
  var file = subfolder_('Backups').createFile(name, JSON.stringify(obj), 'application/json');
  // Verificación: releer desde Drive y validar.
  var problems;
  try {
    problems = verifyBackupObject_(JSON.parse(file.getBlob().getDataAsString('UTF-8')));
  } catch (e) {
    problems = ['no se pudo releer'];
  }
  var valid = problems.length === 0;
  var total = Object.keys(snap.counts).reduce(function (a, k) { return a + snap.counts[k]; }, 0);
  var sh = metaSheet_('_backups', ['fileId', 'name', 'createdAt', 'kind', 'records', 'checksum', 'valid', 'note']);
  sh.appendRow([file.getId(), name, obj.createdAt, kind, String(total), snap.checksum, valid ? 'TRUE' : 'FALSE', problems.join('; ')]);
  if (valid) pruneBackups_();
  return { fileId: file.getId(), name: name, createdAt: obj.createdAt, records: total, valid: valid, problems: problems };
}

function backupRows_() {
  var sh = metaSheet_('_backups', ['fileId', 'name', 'createdAt', 'kind', 'records', 'checksum', 'valid', 'note']);
  var last = sh.getLastRow();
  return { sheet: sh, rows: last > 1 ? sh.getRange(2, 1, last - 1, 8).getValues() : [] };
}

function pruneBackups_() {
  var b = backupRows_();
  var valid = b.rows.filter(function (r) { return String(r[6]) === 'TRUE'; });
  valid.sort(function (x, y) { return String(y[2]) < String(x[2]) ? -1 : 1; });
  valid.slice(KEEP_BACKUPS).forEach(function (r) {
    try { DriveApp.getFileById(String(r[0])).setTrashed(true); } catch (e) { /* ya no existe */ }
    r[7] = 'eliminada por antigüedad';
    r[6] = 'ELIMINADA';
  });
  if (b.rows.length) b.sheet.getRange(2, 1, b.rows.length, 8).setValues(b.rows);
}

function listBackups_() {
  return backupRows_().rows
    .filter(function (r) { return String(r[6]) !== 'ELIMINADA'; })
    .map(function (r) {
      return { fileId: String(r[0]), name: String(r[1]), createdAt: String(r[2]), kind: String(r[3]), records: Number(r[4]), valid: String(r[6]) === 'TRUE', note: String(r[7]) };
    })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
}

function getBackup_(req) {
  var known = listBackups_().some(function (b) { return b.fileId === req.fileId; });
  if (!known) throw err_('Copia no registrada', 'auth');
  return JSON.parse(DriveApp.getFileById(req.fileId).getBlob().getDataAsString('UTF-8'));
}

function restoreBackup_(req) {
  var b = getBackup_(req);
  var problems = verifyBackupObject_(b);
  if (problems.length) throw err_('La copia no es válida (' + problems.join(', ') + '). No se restauró nada.', 'integrity');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw err_('El servidor está ocupado', 'busy');
  try {
    var pre = backup_('pre-restauracion');
    if (!pre.valid) throw err_('No se pudo asegurar el estado actual antes de restaurar. Se canceló.', 'integrity');
    var restored = 0;
    Object.keys(SCHEMA.entities).forEach(function (entity) {
      var t = new Table_(entity);
      var recs = b.data[entity].map(function (r) {
        var x = sanitize_(entity, r);
        x.version = Number(r.version || 0) + 1;
        x.rev = nextRev_();
        return x;
      });
      t.replaceAll(recs);
      restored += recs.length;
    });
    props_().setProperty('RESTORE_EPOCH', new Date().toISOString());
    return { restored: restored, preRestoreBackup: pre.fileId };
  } finally {
    lock.releaseLock();
  }
}
