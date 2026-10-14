/**
 * Inversiones ↔ carpetas de Drive.
 * - Cada subcarpeta de "Inversiones" es una inversión (propiedad, local, terreno…). Si la carpeta ya existe se adopta
 *   (no se renombra ni se mueve nada); si la inversión se crea en la app, se crea su carpeta.
 * - Dentro de cada una se agregan, si faltan, las subcarpetas Contratos, Impuestos, Mantenimiento y Otros.
 * - En la planilla "Inversiones" hay una pestaña "Resumen - <inversión>" por cada una, con fórmulas que muestran sus
 *   contratos, impuestos y mantenimiento (vista de solo lectura: los datos se cargan en las pestañas principales).
 */

var INVESTMENT_SUBFOLDERS = ['Contratos', 'Impuestos', 'Mantenimiento', 'Otros'];
var SUMMARY_PREFIX = 'Resumen - ';

function syncInvestmentFolders_() {
  var parent = folderFor_('inversiones');
  var t = new Table_('investments');
  var now = new Date().toISOString();
  var recs = t.all();
  var byFolder = {};
  recs.forEach(function (r) { if (r.driveFolderId) byFolder[r.driveFolderId] = r; });
  var report = { adopted: [], created: [] };
  var bump = function (r) { r.version = Number(r.version || 0) + 1; r.rev = nextRev_(); r.updatedAt = now; t.put(r); };

  var it = parent.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed && f.isTrashed()) continue;
    if (!byFolder[f.getId()]) {
      var match = recs.filter(function (r) { return !r.driveFolderId && fold_(r.name) === fold_(f.getName()); })[0];
      if (match) { match.driveFolderId = f.getId(); match.driveUrl = f.getUrl(); bump(match); }
      else {
        var rec = { id: Utilities.getUuid(), name: f.getName(), kind: 'otro', currency: 'USD', driveFolderId: f.getId(), driveUrl: f.getUrl(), createdAt: now, version: 0, deleted: false, origin: 'drive' };
        bump(rec); recs.push(rec);
      }
      report.adopted.push(f.getName());
    }
    ensureInvestmentSubfolders_(f);
  }
  recs.forEach(function (r) {
    if (r.deleted || r.driveFolderId) return;
    var nf = parent.createFolder(safeName_(r.name));
    r.driveFolderId = nf.getId(); r.driveUrl = nf.getUrl();
    bump(r);
    ensureInvestmentSubfolders_(nf);
    report.created.push(r.name);
  });
  t.flush();
  rebuildInvestmentTabs_();
  return report;
}

function ensureInvestmentSubfolders_(folder) {
  INVESTMENT_SUBFOLDERS.forEach(function (n) { if (!folder.getFoldersByName(n).hasNext()) folder.createFolder(n); });
}

function colLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Pestañas de resumen por inversión (fórmulas FILTER sobre Contratos, Impuestos y Mantenimiento). */
function rebuildInvestmentTabs_() {
  var ss = getBook_('inversiones');
  var invs = new Table_('investments').all().filter(function (r) { return !r.deleted && r.name; });
  var wanted = {};
  var sys = SCHEMA.systemFields.length;
  invs.forEach(function (inv) {
    var tabName = (SUMMARY_PREFIX + safeName_(inv.name)).slice(0, 95);
    wanted[tabName] = true;
    var sh = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
    sh.clear();
    var rows = [[inv.name, '', ''], [[inv.kind, inv.status, inv.address].filter(String).join(' · '), '', ''], ['Vista automática (solo lectura): cargá los datos en las pestañas Contratos, Impuestos y Mantenimiento.', '', '']];
    ensureSize_(sh, 60, 20);
    sh.getRange(1, 1, 3, 3).setValues(rows);
    var r = 5;
    [['investmentContracts', 'Contratos'], ['investmentTaxes', 'Impuestos'], ['investmentWorks', 'Mantenimiento']].forEach(function (pair) {
      var entity = pair[0], tab = placement_(entity).tab;
      var labels = labels_(entity).slice(sys);
      var firstCol = colLetter_(sys + 1), lastCol = colLetter_(columns_(entity).length);
      var delCol = colLetter_(columns_(entity).indexOf('deleted') + 1);
      ensureSize_(sh, r + 25, labels.length + 1);
      sh.getRange(r, 1, 1, 1).setValues([[pair[1]]]);
      sh.getRange(r + 1, 1, 1, labels.length).setValues([labels]);
      var q = "'" + tab + "'!";
      sh.getRange(r + 2, 1).setFormula('=IFERROR(FILTER(' + q + firstCol + '2:' + lastCol + ', ' + q + firstCol + '2:' + firstCol + '="' + String(inv.name).replace(/"/g, '""') + '", ' + q + delCol + '2:' + delCol + '<>"Sí"), "Sin registros")');
      r += 20;
    });
  });
  ss.getSheets().forEach(function (sh) {
    var n = sh.getName();
    if (n.indexOf(SUMMARY_PREFIX) === 0 && !wanted[n]) { try { ss.deleteSheet(sh); } catch (e) { /* queda */ } }
  });
}

/**
 * Archivos que hay en la carpeta de Drive de una inversión (y sus subcarpetas, hasta 2 niveles), para verlos y abrirlos
 * desde la app: planillas (p. ej. un plan de pagos), documentos, PDF, fotos. Solo lectura del listado; no mueve ni borra.
 */
function investmentFiles_(req) {
  var rec = new Table_('investments').get(String(req.investmentId || ''));
  if (!rec || rec.deleted) throw new Error('Inversión inexistente.');
  if (!rec.driveFolderId) return { files: [], folderUrl: '' };
  var root = DriveApp.getFolderById(rec.driveFolderId);
  var out = [];
  var walk = function (folder, path, depth) {
    var fi = folder.getFiles();
    while (fi.hasNext() && out.length < 200) {
      var f = fi.next();
      if (f.isTrashed && f.isTrashed()) continue;
      out.push({
        id: f.getId(), name: f.getName(), mimeType: f.getMimeType(), url: f.getUrl(), path: path,
        updatedAt: f.getLastUpdated ? new Date(f.getLastUpdated()).toISOString() : '',
      });
    }
    if (depth >= 2) return;
    var it = folder.getFolders();
    while (it.hasNext()) {
      var sub = it.next();
      if (sub.isTrashed && sub.isTrashed()) continue;
      walk(sub, path ? path + ' / ' + sub.getName() : sub.getName(), depth + 1);
    }
  };
  walk(root, '', 0);
  out.sort(function (a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
  return { files: out, folderUrl: root.getUrl() };
}
