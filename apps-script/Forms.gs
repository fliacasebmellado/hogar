/**
 * Google Forms sin API: vinculá el formulario a la planilla "Hogar — datos" (Respuestas → Vincular a hoja de cálculo →
 * Seleccionar existente). Google crea una hoja "Respuestas de formulario N". Esta función lee esas hojas y entrega a la app
 * las respuestas aún no importadas; la app las convierte en capturas que pasan por revisión.
 * Duplicados: cada respuesta tiene una clave estable (hoja + fila de marca temporal + hash del contenido) registrada en
 * _forms_imported cuando la app confirma la importación.
 */

function formSheets_() {
  return getSS_().getSheets().filter(function (sh) { return /^(Respuestas de formulario|Form Responses|Form responses)/i.test(sh.getName()); });
}

function importedKeys_() {
  var sh = metaSheet_('_forms_imported', ['key', 'at']);
  var last = sh.getLastRow();
  var keys = {};
  if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { keys[String(r[0])] = true; });
  return { sheet: sh, keys: keys };
}

function formsPending_() {
  var imported = importedKeys_();
  var out = [];
  formSheets_().forEach(function (sh) {
    var last = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (last < 2 || lastCol < 1) return;
    var vals = sh.getRange(1, 1, last, lastCol).getValues();
    var header = vals[0].map(String);
    for (var i = 1; i < vals.length && out.length < 50; i++) {
      var row = vals[i];
      if (row.every(function (c) { return c === '' || c === null; })) continue;
      var ts = row[0] instanceof Date ? row[0].toISOString() : String(row[0]);
      var key = sh.getName() + '|' + ts + '|' + sha256Str_(JSON.stringify(row)).slice(0, 16);
      if (imported.keys[key]) continue;
      var answers = {};
      header.forEach(function (h, c) { if (c > 0 && row[c] !== '') answers[h] = row[c] instanceof Date ? row[c].toISOString() : String(row[c]); });
      out.push({ key: key, form: sh.getName(), submittedAt: ts, answers: answers });
    }
  });
  return out;
}

function formsAck_(req) {
  var imported = importedKeys_();
  var now = new Date().toISOString();
  var rows = (req.keys || []).filter(function (k) { return !imported.keys[k]; }).map(function (k) { return [k, now]; });
  if (rows.length) ensureSize_(imported.sheet, imported.sheet.getLastRow() + rows.length, 2);
  if (rows.length) imported.sheet.getRange(imported.sheet.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
  return { acknowledged: rows.length };
}
