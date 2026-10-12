/**
 * Google Drive: los archivos se guardan en las carpetas de la familia según de qué se trate.
 *
 *   Documentos/<Persona>/                 DNI, pasaporte, obra social, partidas… (adultos y familia)
 *   Peques/<Nombre>/                      documentos de los chicos (colegio, salud, actividades)
 *   Gastos Mensuales casa/Comprobantes/<AAAA-MM>/   facturas y comprobantes de pagos y gastos
 *   Reforma, mantenimiento casa/<Reparaciones | Manuales y garantías | Fotos>/
 *   Inversiones/<inversión>/<Contratos | Impuestos | Mantenimiento | Otros>/
 *   Hogar App/<Capturas | Audios | Backups>/   material del asistente y copias de seguridad
 *
 * La clave de carpeta (attachments.folder) la decide la app; acá se valida y se resuelve. Si cambia (por ejemplo,
 * una foto capturada que se confirma como DNI), el archivo se mueve a su nueva carpeta. Nunca se borran archivos.
 * Los archivos se registran en la hoja _files por hash SHA-256: subir dos veces el mismo archivo no lo duplica.
 * getFile solo entrega archivos registrados por la app (no cualquier archivo del Drive).
 */

var MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
var CASA_SUBFOLDERS = ['Reparaciones', 'Manuales y garantías', 'Fotos', 'Facturas'];
// Claves de versiones anteriores → claves nuevas
var LEGACY_FOLDERS = { Documentos: 'documentos/Familia', Comprobantes: 'gastos', Fotos: 'casa/Fotos', Manuales: 'casa/Manuales y garantías', Capturas: 'app/Capturas', Audios: 'app/Audios' };

/** Carpeta técnica de la app (Hogar App). */
function rootFolder_() { return folderFor_('app'); }

function subfolder_(name) { return childFolder_(rootFolder_(), name); }

/** Resuelve una clave como "documentos/Mamá" o "inversion/<id>/Impuestos" a la carpeta de Drive (creando lo que falte). */
function resolveFolder_(key) {
  key = LEGACY_FOLDERS[key] || String(key || 'app/Capturas');
  var parts = key.split('/').filter(String);
  var root = parts[0];
  if (root === 'app') return childFolder_(folderFor_('app'), parts[1] === 'Audios' ? 'Audios' : 'Capturas');
  if (root === 'documentos') return childFolder_(folderFor_('documentos'), parts[1] || 'Familia');
  if (root === 'peques') return childFolder_(folderFor_('peques'), parts[1] || 'Varios');
  if (root === 'gastos') {
    var month = /^\d{4}-\d{2}$/.test(parts[1] || '') ? parts[1] : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
    return childFolder_(childFolder_(folderFor_('gastos'), 'Comprobantes'), month);
  }
  if (root === 'casa') return childFolder_(folderFor_('casa'), CASA_SUBFOLDERS.indexOf(parts[1]) >= 0 ? parts[1] : 'Facturas');
  if (root === 'inversion') {
    var inv = new Table_('investments').get(parts[1] || '');
    var base;
    if (inv && inv.driveFolderId) { try { base = DriveApp.getFolderById(inv.driveFolderId); } catch (e) { base = null; } }
    if (!base) base = childFolder_(folderFor_('inversiones'), inv ? inv.name : 'Sin asignar');
    var sub = INVESTMENT_SUBFOLDERS.indexOf(parts[2]) >= 0 ? parts[2] : 'Otros';
    return childFolder_(base, sub);
  }
  throw err_('Carpeta no permitida: ' + key, 'format');
}

function hex_(bytes) {
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

function filesIndex_() {
  var sh = metaSheet_('_files', ['hash', 'attachmentId', 'driveFileId', 'name', 'at']);
  var last = sh.getLastRow();
  var vals = last > 1 ? sh.getRange(2, 1, last - 1, 5).getValues() : [];
  return { sheet: sh, rows: vals };
}

function uploadFile_(req) {
  if (!req.base64 || !req.name || !req.hash) throw err_('Archivo incompleto', 'format');
  var target = resolveFolder_(req.folder);
  var bytes = Utilities.base64Decode(req.base64);
  if (bytes.length > MAX_UPLOAD_BYTES) throw err_('El archivo supera 20 MB', 'format');
  var hash = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
  if (hash !== req.hash) throw err_('El archivo llegó dañado (hash distinto). Se reintentará.', 'integrity');
  var idx = filesIndex_();
  for (var i = 0; i < idx.rows.length; i++) {
    if (String(idx.rows[i][0]) === hash) {
      try {
        var existing = DriveApp.getFileById(String(idx.rows[i][2]));
        if (!existing.isTrashed()) return { driveFileId: existing.getId(), driveUrl: existing.getUrl(), deduped: true };
      } catch (e) { /* el archivo ya no existe: se vuelve a subir */ }
    }
  }
  var blob = Utilities.newBlob(bytes, req.mimeType || 'application/octet-stream', String(req.name).slice(0, 180));
  var file = target.createFile(blob);
  file.setDescription('hogar:' + req.id + ' sha256:' + hash);
  idx.sheet.appendRow([hash, req.id, file.getId(), req.name, new Date().toISOString()]);
  return { driveFileId: file.getId(), driveUrl: file.getUrl(), deduped: false };
}

/** Mueve un archivo ya subido si su carpeta cambió (no borra nada). */
function moveFileIfNeeded_(prev, rec) {
  if (!rec || !rec.driveFileId || !rec.folder) return;
  if (prev && prev.folder === rec.folder) return;
  try { DriveApp.getFileById(rec.driveFileId).moveTo(resolveFolder_(rec.folder)); } catch (e) { logError_('moveFile', e); }
}

function getFile_(req) {
  var idx = filesIndex_();
  var known = idx.rows.some(function (r) { return String(r[2]) === req.driveFileId; });
  if (!known) throw err_('Archivo no registrado por la app', 'auth');
  var file = DriveApp.getFileById(req.driveFileId);
  var blob = file.getBlob();
  return { base64: Utilities.base64Encode(blob.getBytes()), mimeType: blob.getContentType(), name: file.getName() };
}
