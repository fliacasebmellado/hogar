/**
 * Hogar — backend gratuito en Google Apps Script.
 * Se implementa como Aplicación web "Ejecutar como: yo (la cuenta de Google de la familia)" y "Acceso: cualquier persona".
 * Toda solicitud debe incluir el token familiar (Propiedades del script → HOGAR_TOKEN). Sin token correcto no se
 * devuelve ningún dato. El token es el verdadero control de acceso: no lo publiques ni lo subas al repositorio.
 *
 * Funciones para ejecutar a mano desde el editor (menú Ejecutar):
 *   inicializar()       → crea la planilla, las carpetas de Drive, las hojas y los activadores.
 *   generarToken()      → crea (o rota) el token familiar y lo muestra en el registro de ejecución.
 *   copiaDeSeguridad()  → genera una copia en Drive en el momento.
 */

var ACTIONS = {
  ping: function () { return { pong: true, schemaVersion: SCHEMA.schemaVersion, time: new Date().toISOString() }; },
  setup: function () { return setup_(); },
  status: function () { return status_(); },
  validateSchema: function () { return validateSheets_(false); },
  push: function (req) { return push_(req); },
  pull: function (req) { return pull_(req); },
  uploadFile: function (req) { return uploadFile_(req); },
  getFile: function (req) { return getFile_(req); },
  runBackup: function () { return backup_('manual'); },
  listBackups: function () { return listBackups_(); },
  getBackup: function (req) { return getBackup_(req); },
  restoreBackup: function (req) { return restoreBackup_(req); },
  calendarSync: function (req) { return calendarSync_(req); },
  calendarList: function () { return calendarList_(); },
  gmailSearch: function (req) { return gmailSearch_(req); },
  gmailGet: function (req) { return gmailGet_(req); },
  gmailAttachment: function (req) { return gmailAttachment_(req); },
  formsPending: function () { return formsPending_(); },
  formsAck: function (req) { return formsAck_(req); },
  setOption: function (req) { return setOption_(req); },
  ids: function () { return ids_(); },
  syncInvestments: function () { return syncInvestmentFolders_(); },
  investmentFiles: function (req) { return investmentFiles_(req); },
};

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Solicitud inválida.', code: 'format' });
  }
  if (!checkToken_(req.token)) return json_({ ok: false, error: 'Token familiar inválido o no configurado.', code: 'auth' });
  var fn = ACTIONS[req.action];
  if (!fn) return json_({ ok: false, error: 'Acción desconocida: ' + req.action, code: 'format' });
  try {
    return json_({ ok: true, result: fn(req) });
  } catch (err) {
    // No se devuelven trazas ni contenido de registros: solo el mensaje.
    logError_(req.action, err);
    return json_({ ok: false, error: String((err && err.message) || err), code: (err && err.code) || 'backend' });
  }
}

function doGet() {
  // Por GET no se expone ningún dato; solo sirve para comprobar que la implementación responde.
  return json_({ ok: true, result: { service: 'hogar', usage: 'POST' } });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function props_() { return PropertiesService.getScriptProperties(); }

function checkToken_(token) {
  var expected = props_().getProperty('HOGAR_TOKEN');
  if (!expected || !token || typeof token !== 'string') return false;
  if (expected.length !== token.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

function err_(message, code) { var e = new Error(message); e.code = code || 'backend'; return e; }

function generarToken() {
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  props_().setProperty('HOGAR_TOKEN', token);
  Logger.log('Token familiar (copialo en la app, Ajustes → Integraciones): ' + token);
  return token;
}

function inicializar() {
  var r = setup_();
  if (!props_().getProperty('HOGAR_TOKEN')) generarToken();
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

function copiaDeSeguridad() { return backup_('manual'); }

function setOption_(req) {
  var allowed = { CALENDAR_ID: true, GMAIL_ENABLED: true, CALENDAR_AUTO: true };
  if (!allowed[req.key]) throw err_('Opción no permitida', 'format');
  if (req.value === null || req.value === '') props_().deleteProperty(req.key);
  else props_().setProperty(req.key, String(req.value));
  return { key: req.key, value: props_().getProperty(req.key) };
}

function logError_(action, err) {
  try {
    var sh = metaSheet_('_log', ['at', 'action', 'error']);
    sh.appendRow([new Date().toISOString(), action, String((err && err.message) || err).slice(0, 300)]);
  } catch (e) { /* sin registro */ }
}

/**
 * Inicialización: adopta las carpetas de la familia (Documentos, Gastos Mensuales casa, Inversiones, Peques,
 * Reforma, mantenimiento casa) y crea solo lo que falte: Hogar App (técnica y copias), las planillas en castellano,
 * las subcarpetas de cada inversión y los activadores. No renombra, mueve ni borra nada existente.
 */
function setup_() {
  Object.keys(SCHEMA.folders).forEach(function (k) { folderFor_(k); });
  ['Capturas', 'Audios', 'Backups'].forEach(function (n) { subfolder_(n); });
  childFolder_(folderFor_('gastos'), 'Comprobantes');
  CASA_SUBFOLDERS.forEach(function (n) { childFolder_(folderFor_('casa'), n); });
  var report = validateSheets_(true);
  var inv = syncInvestmentFolders_();
  installTriggers_();
  return { spreadsheetUrl: getSS_().getUrl(), rootFolderUrl: rootFolder_().getUrl(), sheets: report, books: booksInfo_(), folders: foldersInfo_(), investments: inv };
}

function booksInfo_() {
  var out = {};
  Object.keys(SCHEMA.books).forEach(function (k) { out[k] = { title: SCHEMA.books[k].title, url: getBook_(k).getUrl() }; });
  return out;
}
function foldersInfo_() {
  var out = {};
  Object.keys(SCHEMA.folders).forEach(function (k) { var f = folderFor_(k); out[k] = { name: f.getName(), url: f.getUrl() }; });
  return out;
}

function installTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  var has = function (fn, src) { return triggers.some(function (t) { return t.getHandlerFunction() === fn && (!src || (t.getTriggerSourceId && t.getTriggerSourceId() === src)); }); };
  if (!has('dailyJob')) ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(3).create();
  if (!has('hourlyJob')) ScriptApp.newTrigger('hourlyJob').timeBased().everyHours(1).create();
  // Ediciones a mano en cada planilla → se publican a la app.
  Object.keys(SCHEMA.books).forEach(function (k) {
    var ss = getBook_(k);
    if (!has('onSheetEdit', ss.getId())) ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();
    if (!has('onSheetChange', ss.getId())) ScriptApp.newTrigger('onSheetChange').forSpreadsheet(ss).onChange().create();
  });
}

/** Activador diario: copia de seguridad + limpieza del registro de operaciones antiguas. */
function dailyJob() {
  backup_('automatica');
  pruneOps_(60);
}

/** Activador horario: sincroniza Google Calendar solo si se habilitó CALENDAR_AUTO. */
function hourlyJob() {
  try { syncInvestmentFolders_(); } catch (e) { logError_('inversiones', e); }
  if (props_().getProperty('CALENDAR_AUTO') === 'true') calendarSync_({ auto: true });
}

function status_() {
  var p = props_();
  var backups = listBackups_();
  var triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  return {
    schemaVersion: SCHEMA.schemaVersion,
    spreadsheetUrl: getSS_().getUrl(),
    books: booksInfo_(),
    folders: foldersInfo_(),
    rootFolderUrl: rootFolder_().getUrl(),
    rev: Number(p.getProperty('REV') || 0),
    restoreEpoch: p.getProperty('RESTORE_EPOCH') || '',
    sheets: validateSheets_(false),
    lastBackup: backups.length ? backups[0] : null,
    triggers: triggers,
    gmailEnabled: p.getProperty('GMAIL_ENABLED') === 'true',
    calendarId: p.getProperty('CALENDAR_ID') || 'primary',
    calendarAuto: p.getProperty('CALENDAR_AUTO') === 'true',
    owner: ownerEmail_(),
  };
}

/**
 * Mail de la cuenta dueña, solo informativo. Session.getEffectiveUser() pide el permiso extra userinfo.email, que el
 * proyecto no tiene: se obtiene del dueño de la carpeta de la app (permiso de Drive, ya otorgado). Si falla, queda vacío.
 */
function ownerEmail_() {
  try { return folderFor_('app').getOwner().getEmail(); } catch (e) {}
  try { return Session.getEffectiveUser().getEmail(); } catch (e2) {}
  return '';
}
