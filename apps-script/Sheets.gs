/**
 * Almacenamiento en Google Sheets, repartido en varias planillas dentro de las carpetas de la familia:
 *   app         → "Hogar — datos de la app"   (carpeta Hogar App)
 *   gastos      → "Gastos de la casa"         (carpeta Gastos Mensuales casa)
 *   inversiones → "Inversiones"               (carpeta Inversiones)
 *   casa        → "Casa y mantenimiento"      (carpeta Reforma, mantenimiento casa)
 *   documentos  → "Índice de documentos"      (carpeta Documentos)
 * Cada entidad es una pestaña con encabezados en castellano (fila 1). Las columnas técnicas (ID, versión, …) van
 * primero y ocultas. El número de fila nunca se usa como identificador: la columna A guarda el ID estable.
 * Las personas e inversiones se muestran por nombre (y se aceptan por nombre al escribir en la planilla).
 */

var BOOK_CACHE_ = {};
var FOLDER_CACHE_ = {};
var REF_CACHE_ = null;

// ---------- Carpetas ----------
/** Adopta la carpeta existente con ese nombre (en Mi unidad); solo la crea si no existe. Nunca renombra ni mueve. */
function folderFor_(key) {
  if (FOLDER_CACHE_[key]) return FOLDER_CACHE_[key];
  var p = props_();
  var id = p.getProperty('FOLDER_ID_' + key);
  var folder = null;
  if (id) { try { folder = DriveApp.getFolderById(id); if (folder.isTrashed && folder.isTrashed()) folder = null; } catch (e) { folder = null; } }
  if (!folder) {
    var name = p.getProperty('FOLDER_NAME_' + key) || SCHEMA.folders[key];
    var it = DriveApp.getRootFolder().getFoldersByName(name);
    if (it.hasNext()) folder = it.next();
    else {
      var any = DriveApp.getFoldersByName(name);
      while (any.hasNext()) { var f = any.next(); if (!(f.isTrashed && f.isTrashed())) { folder = f; break; } }
    }
    if (!folder) folder = DriveApp.getRootFolder().createFolder(name);
    p.setProperty('FOLDER_ID_' + key, folder.getId());
  }
  FOLDER_CACHE_[key] = folder;
  return folder;
}

function childFolder_(parent, name) {
  var clean = safeName_(name);
  var it = parent.getFoldersByName(clean);
  return it.hasNext() ? it.next() : parent.createFolder(clean);
}

function safeName_(s) {
  return String(s || 'Sin nombre').replace(/[\\/:*?"<>|#\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Sin nombre';
}

// ---------- Planillas ----------
function getBook_(key) {
  if (BOOK_CACHE_[key]) return BOOK_CACHE_[key];
  var meta = SCHEMA.books[key];
  if (!meta) throw err_('Planilla desconocida: ' + key, 'format');
  var p = props_();
  var id = p.getProperty('SS_' + key);
  var ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    var folder = folderFor_(meta.folder);
    var files = folder.getFilesByName(meta.title);
    while (files.hasNext()) {
      var f = files.next();
      if (f.getMimeType() === 'application/vnd.google-apps.spreadsheet' && !(f.isTrashed && f.isTrashed())) { ss = SpreadsheetApp.openById(f.getId()); break; }
    }
    if (!ss) {
      ss = SpreadsheetApp.create(meta.title);
      try { DriveApp.getFileById(ss.getId()).moveTo(folder); } catch (e2) { /* queda en Mi unidad */ }
    }
    p.setProperty('SS_' + key, ss.getId());
  }
  BOOK_CACHE_[key] = ss;
  return ss;
}

/** Compatibilidad: la planilla principal (hojas técnicas, formularios). */
function getSS_() { return getBook_('app'); }

function placement_(entity) {
  var pl = SCHEMA.placement[entity];
  if (!pl) throw err_('Entidad desconocida: ' + entity, 'format');
  return { book: pl[0], tab: pl[1] };
}

function sheetOf_(entity) {
  var pl = placement_(entity);
  return getBook_(pl.book).getSheetByName(pl.tab);
}

/** Qué entidad corresponde a una pestaña de una planilla (para las ediciones manuales). */
function entityForSheet_(ssId, tab) {
  var keys = Object.keys(SCHEMA.placement);
  for (var i = 0; i < keys.length; i++) {
    var pl = SCHEMA.placement[keys[i]];
    if (pl[1] === tab && props_().getProperty('SS_' + pl[0]) === ssId) return keys[i];
  }
  return null;
}

function fields_(entity) {
  var f = SCHEMA.entities[entity];
  if (!f) throw err_('Entidad desconocida: ' + entity, 'format');
  return SCHEMA.systemFields.concat(f);
}
function columns_(entity) { return fields_(entity).map(function (f) { return f[0]; }); }
function labels_(entity) { return fields_(entity).map(function (f) { return f[2] || f[0]; }); }
function types_(entity) {
  var t = {};
  fields_(entity).forEach(function (f) { t[f[0]] = f[1]; });
  return t;
}

/** Agranda la hoja si hace falta: Sheets no permite escribir fuera de sus dimensiones (por defecto 1000 x 26). */
function ensureSize_(sh, rows, cols) {
  var mr = sh.getMaxRows(), mc = sh.getMaxColumns();
  if (rows > mr) sh.insertRowsAfter(mr, rows - mr);
  if (cols > mc) sh.insertColumnsAfter(mc, cols - mc);
}

function metaSheet_(name, header) {
  var ss = getSS_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    ensureSize_(sh, 2, header.length);
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    sh.setFrozenRows(1);
  }
  return sh;
}

var ENUMS_ = {
  'tasks.status': ['pendiente', 'en_curso', 'bloqueada', 'completada'], 'tasks.priority': ['baja', 'media', 'alta'],
  'payments.status': ['pendiente', 'programado', 'pagado', 'vencido'], 'payments.currency': ['ARS', 'USD', 'EUR'],
  'expenses.currency': ['ARS', 'USD', 'EUR'], 'repairs.status': ['reportada', 'en_curso', 'resuelta'],
  'shoppingItems.status': ['pendiente', 'comprado', 'descartado'],
  'documents.visibility': ['familia', 'adultos', 'personal'],
  'investments.kind': ['departamento', 'casa', 'local', 'oficina', 'cochera', 'terreno', 'campo', 'financiera', 'otro'],
  'investments.status': ['alquilada', 'disponible', 'uso propio', 'en obra', 'en venta', 'vendida'],
  'investments.currency': ['ARS', 'USD'],
  'investmentContracts.kind': ['alquiler', 'administración', 'seguro', 'compraventa', 'servicio', 'otro'],
  'investmentContracts.status': ['vigente', 'por vencer', 'vencido', 'rescindido'],
  'investmentContracts.currency': ['ARS', 'USD'],
  'investmentContracts.frequency': ['mensual', 'bimestral', 'trimestral', 'semestral', 'anual', 'única vez'],
  'investmentTaxes.status': ['pendiente', 'pagado', 'vencido'], 'investmentTaxes.currency': ['ARS', 'USD'],
  'investmentWorks.status': ['pendiente', 'en curso', 'terminado'], 'investmentWorks.currency': ['ARS', 'USD'],
  'healthNotes.kind': ['plan', 'indicacion', 'diagnostico', 'alergia', 'control', 'vacuna'],
  'treatments.status': ['activo', 'terminado'], 'medications.status': ['activo', 'terminado', 'suspendido'],
  'vaccinations.status': ['pendiente', 'aplicada', 'no corresponde'],
};

/** Formato de una pestaña nueva o ampliada: texto plano, columnas técnicas ocultas, listas desplegables. */
function formatSheet_(entity, sh) {
  var cols = columns_(entity);
  var rows = Math.max(sh.getMaxRows(), 2);
  sh.getRange(1, 1, rows, cols.length).setNumberFormat('@');
  sh.setFrozenRows(1);
  try { sh.hideColumns(1, SCHEMA.systemFields.length); } catch (e) { /* sin permiso de formato */ }
  var types = types_(entity);
  cols.forEach(function (c, i) {
    var list = ENUMS_[entity + '.' + c];
    var rule = null;
    if (list) rule = SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();
    else if (types[c] === 'boolean' && i >= SCHEMA.systemFields.length) rule = SpreadsheetApp.newDataValidation().requireValueInList(['Sí', 'No'], true).setAllowInvalid(true).build();
    if (rule) sh.getRange(2, i + 1, rows - 1, 1).setDataValidation(rule);
  });
}

/**
 * Valida (y si `fix` es true, crea o completa) las pestañas de cada entidad.
 * Compatible: faltan columnas nuevas al final → se agregan. Incompatible: otro orden u otros nombres → se informa y se
 * bloquean las escrituras de esa pestaña. Se aceptan encabezados en castellano o con las claves técnicas.
 */
function validateSheets_(fix) {
  var report = { ok: true, created: [], extended: [], incompatible: [] };
  Object.keys(SCHEMA.entities).forEach(function (entity) {
    var pl = placement_(entity);
    var ss = getBook_(pl.book);
    var cols = columns_(entity), labels = labels_(entity);
    var sh = ss.getSheetByName(pl.tab);
    if (!sh) {
      if (!fix) { report.ok = false; report.incompatible.push(pl.tab + ': falta la pestaña'); return; }
      sh = ss.insertSheet(pl.tab);
      ensureSize_(sh, 2, cols.length);
      sh.getRange(1, 1, 1, cols.length).setValues([labels]);
      formatSheet_(entity, sh);
      report.created.push(pl.book + '/' + pl.tab);
      return;
    }
    var lastCol = Math.max(sh.getLastColumn(), 1);
    var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(function (h) { return h !== ''; });
    var prefixOk = header.every(function (h, i) { return labels[i] === h || cols[i] === h; });
    if (!prefixOk) {
      report.ok = false;
      report.incompatible.push(pl.tab + ': encabezados distintos de los esperados');
      return;
    }
    if (header.length < cols.length) {
      if (!fix) { report.ok = false; report.incompatible.push(pl.tab + ': faltan columnas'); return; }
      ensureSize_(sh, 2, cols.length);
      sh.getRange(1, header.length + 1, 1, cols.length - header.length).setValues([labels.slice(header.length)]);
      formatSheet_(entity, sh);
      report.extended.push(pl.tab);
    }
  });
  if (fix) removeDefaultSheets_();
  metaSheet_('_ops', ['opId', 'at', 'entity', 'recordId', 'version', 'deviceId']);
  metaSheet_('_files', ['hash', 'attachmentId', 'driveFileId', 'name', 'at']);
  metaSheet_('_backups', ['fileId', 'name', 'createdAt', 'kind', 'records', 'checksum', 'valid', 'note']);
  if (report.incompatible.length) report.ok = false;
  return report;
}

/** Borra la "Hoja 1" vacía que trae una planilla nueva (solo si está vacía). */
function removeDefaultSheets_() {
  Object.keys(SCHEMA.books).forEach(function (k) {
    var ss = getBook_(k);
    ss.getSheets().forEach(function (sh) {
      if (/^(Hoja ?1|Sheet ?1)$/.test(sh.getName()) && sh.getLastRow() === 0 && ss.getSheets().length > 1) {
        try { ss.deleteSheet(sh); } catch (e) { /* no se pudo: queda */ }
      }
    });
  });
}

function assertSchemaOk_(entity) {
  var sh = sheetOf_(entity);
  var pl = placement_(entity);
  // Pestaña nueva de una versión más reciente de la app (p. ej. "Salud - Vacunas"): se crea sola, sin tocar las demás.
  if (!sh) { validateSheets_(true); sh = sheetOf_(entity); }
  if (!sh) throw err_('Falta la pestaña "' + pl.tab + '". Ejecutá inicializar().', 'schema');
  var cols = columns_(entity), labels = labels_(entity);
  if (sh.getMaxColumns() < cols.length) throw err_('La pestaña "' + pl.tab + '" tiene menos columnas que las esperadas. Ejecutá inicializar().', 'schema');
  var header = sh.getRange(1, 1, 1, cols.length).getValues()[0].map(String);
  for (var i = 0; i < cols.length; i++) {
    if (header[i] !== labels[i] && header[i] !== cols[i]) throw err_('La pestaña "' + pl.tab + '" tiene encabezados incompatibles. No se escribió nada.', 'schema');
  }
  return sh;
}

// ---------- Nombres ↔ IDs (personas e inversiones) ----------
function fold_(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }

function refMaps_() {
  if (REF_CACHE_) return REF_CACHE_;
  var maps = { person: { byId: {}, byName: {} }, investments: { byId: {}, byName: {} } };
  var load = function (entity, target) {
    var sh = sheetOf_(entity);
    if (!sh || sh.getLastRow() < 2) return;
    var n = SCHEMA.systemFields.length;
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, n + 1).getValues();
    vals.forEach(function (r) {
      var id = String(r[0]), name = String(r[n]);
      if (!id || !name) return;
      target.byId[id] = name;
      target.byName[fold_(name)] = id;
    });
  };
  try { load('profiles', maps.person); } catch (e) { /* aún sin hoja */ }
  try { load('investments', maps.investments); } catch (e2) { /* aún sin hoja */ }
  REF_CACHE_ = maps;
  return maps;
}
function resetRefs_() { REF_CACHE_ = null; }
/** Registra en memoria un nombre recién escrito (aunque la hoja todavía no se haya guardado). */
function registerRef_(entity, rec) {
  if (!rec || !rec.id || !rec.name) return;
  var m = refMaps_()[entity === 'profiles' ? 'person' : 'investments'];
  m.byId[rec.id] = rec.name;
  m.byName[fold_(rec.name)] = rec.id;
}

// ---------- Conversión de valores ----------
function isoDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(v).trim();
  var m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s);
  if (m) {
    var y = Number(m[3]); if (y < 100) y += 2000;
    return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }
  return s;
}
/** Números escritos a mano con formato argentino: "45.000" → 45000; "12,5" → 12.5. */
function parseNumberAR_(s) {
  s = String(s).replace(/[$\s]|ARS|USD|U\$S/gi, '');
  if (!s) return undefined;
  var lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    var dec = lastDot > lastComma ? '.' : ',';
    s = s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    var sep = lastComma >= 0 ? ',' : '.';
    var parts = s.split(sep);
    s = parts.length > 2 || (parts.length === 2 && parts[1].length === 3) ? parts.join('') : parts.join('.');
  }
  var n = Number(s);
  return isNaN(n) ? undefined : n;
}

function toCell_(value, type) {
  if (value === undefined || value === null) return '';
  if (type === 'json') return JSON.stringify(value);
  if (type === 'boolean') return value ? 'Sí' : 'No';
  if (type === 'number') return typeof value === 'number' ? value : String(value);
  if (type === 'person') return refMaps_().person.byId[value] || String(value);
  if (type === 'persons') return (value || []).map(function (id) { return refMaps_().person.byId[id] || id; }).join(', ');
  if (type === 'ref:investments') return refMaps_().investments.byId[value] || String(value);
  var s = String(value);
  // Evita que Sheets interprete textos como fórmulas (y conserva un apóstrofo inicial real).
  if (/^[=+@']/.test(s)) return "'" + s;
  return s;
}

function fromCell_(value, type) {
  if (value === '' || value === null || value === undefined) return type === 'boolean' ? false : type === 'persons' ? [] : undefined;
  if (type === 'number') return typeof value === 'number' ? value : parseNumberAR_(value);
  if (type === 'boolean') return value === true || /^(true|s[ií]|x|yes|1|verdadero)$/i.test(String(value).trim());
  if (type === 'json') { try { return JSON.parse(String(value)); } catch (e) { return undefined; } }
  if (type === 'date') return isoDate_(value);
  if (type === 'person') { var s1 = String(value).trim(); return refMaps_().person.byName[fold_(s1)] || s1; }
  if (type === 'persons') {
    var s2 = String(value).trim();
    if (s2.charAt(0) === '[') { try { return JSON.parse(s2); } catch (e2) { /* sigue */ } }
    return s2.split(/\s*,\s*|\s+y\s+/).filter(String).map(function (n) { return refMaps_().person.byName[fold_(n)] || n; });
  }
  if (type === 'ref:investments') { var s3 = String(value).trim(); return refMaps_().investments.byName[fold_(s3)] || s3; }
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm");
  return String(value);
}

/** Tabla en memoria durante una ejecución: lee una vez y escribe en bloque. */
function Table_(entity) {
  this.entity = entity;
  this.sheet = assertSchemaOk_(entity);
  this.cols = columns_(entity);
  this.types = types_(entity);
  var last = this.sheet.getLastRow();
  this.values = last > 1 ? this.sheet.getRange(2, 1, last - 1, this.cols.length).getValues() : [];
  this.index = {};
  for (var i = 0; i < this.values.length; i++) {
    var id = String(this.values[i][0]);
    if (id) this.index[id] = i;
  }
  this.dirty = {};
  this.appended = [];
}

Table_.prototype.get = function (id) {
  var i = this.index[id];
  return i === undefined ? null : this.toRecord(this.values[i]);
};

Table_.prototype.toRecord = function (row) {
  var r = {};
  for (var c = 0; c < this.cols.length; c++) {
    var v = fromCell_(row[c], this.types[this.cols[c]]);
    if (v !== undefined) r[this.cols[c]] = v;
  }
  return r;
};

Table_.prototype.toRow = function (rec) {
  var self = this;
  return this.cols.map(function (c) { return toCell_(rec[c], self.types[c]); });
};

Table_.prototype.put = function (rec) {
  var i = this.index[rec.id];
  if (i === undefined) {
    this.values.push(this.toRow(rec));
    i = this.values.length - 1;
    this.index[rec.id] = i;
    this.appended.push(i);
  } else this.putAt(i, rec);
  if (this.entity === 'profiles' || this.entity === 'investments') registerRef_(this.entity, rec);
};

/** Reescribe una fila concreta (filas cargadas a mano que todavía no tenían ID). */
Table_.prototype.putAt = function (i, rec) {
  this.values[i] = this.toRow(rec);
  if (rec.id) this.index[rec.id] = i;
  if (this.appended.indexOf(i) < 0) this.dirty[i] = true;
};

Table_.prototype.all = function () {
  var self = this;
  return this.values.filter(function (r) { return String(r[0]) !== ''; }).map(function (r) { return self.toRecord(r); });
};

Table_.prototype.flush = function () {
  var self = this;
  Object.keys(this.dirty).forEach(function (k) {
    var i = Number(k);
    self.sheet.getRange(i + 2, 1, 1, self.cols.length).setValues([self.values[i]]);
  });
  if (this.appended.length) {
    var first = this.appended[0];
    var block = this.appended.map(function (i) { return self.values[i]; });
    ensureSize_(this.sheet, first + 1 + block.length, this.cols.length);
    var range = this.sheet.getRange(first + 2, 1, block.length, this.cols.length);
    range.setNumberFormat('@');
    range.setValues(block);
  }
  this.dirty = {};
  this.appended = [];
};

/** Reemplaza todo el contenido de la pestaña (solo restauración). */
Table_.prototype.replaceAll = function (records) {
  var last = this.sheet.getLastRow();
  if (last > 1) this.sheet.getRange(2, 1, last - 1, this.cols.length).clearContent();
  this.values = [];
  this.index = {};
  this.dirty = {};
  this.appended = [];
  var self = this;
  records.forEach(function (r) { self.put(r); });
  this.flush();
};
