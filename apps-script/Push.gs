/**
 * Avisos al celular con la app gratuita ntfy (https://ntfy.sh), también con Hogar cerrada.
 * - Cada adulto tiene su propio "tópico" secreto (nombre al azar, imposible de adivinar). Se guarda solo en las
 *   Propiedades del script (NTFY_CONFIG); no está en el código. La persona se suscribe a él en la app ntfy.
 * - Solo se avisa de compras nuevas y tareas nuevas. Nunca de Salud ni de Economía.
 * - No se avisa a quien cargó el registro. Varias cosas cargadas juntas llegan en un solo aviso.
 */

var NTFY_SERVER = 'https://ntfy.sh';

function pushConfig_() {
  try { return JSON.parse(props_().getProperty('NTFY_CONFIG') || '{}') || {}; } catch (e) { return {}; }
}
function savePushConfig_(cfg) { props_().setProperty('NTFY_CONFIG', JSON.stringify(cfg)); }

function newTopic_() {
  return 'hogar-' + Utilities.getUuid().replace(/-/g, '').slice(0, 20);
}

function pushProfile_(id) {
  if (!id) throw err_('Falta el perfil.', 'format');
  var p = new Table_('profiles').get(id);
  if (!p || p.deleted) throw err_('Perfil desconocido.', 'format');
  if (p.role !== 'adult') throw err_('Los avisos al celular son solo para adultos.', 'format');
  return p;
}

function pushStatus_(req) {
  pushProfile_(req.profileId);
  var cfg = pushConfig_();
  var c = cfg[req.profileId];
  if (!c) { c = cfg[req.profileId] = { topic: newTopic_(), enabled: false }; savePushConfig_(cfg); }
  if (req.appUrl && /^https:\/\//.test(req.appUrl) && cfg._appUrl !== req.appUrl) { cfg._appUrl = String(req.appUrl).slice(0, 200); savePushConfig_(cfg); }
  return { topic: c.topic, enabled: !!c.enabled, server: NTFY_SERVER };
}

function pushSet_(req) {
  pushProfile_(req.profileId);
  var cfg = pushConfig_();
  var c = cfg[req.profileId] || { topic: newTopic_(), enabled: false };
  if (req.newTopic) c.topic = newTopic_();
  if (req.enabled !== undefined) c.enabled = !!req.enabled;
  cfg[req.profileId] = c;
  savePushConfig_(cfg);
  return { topic: c.topic, enabled: c.enabled, server: NTFY_SERVER };
}

function pushTest_(req) {
  pushProfile_(req.profileId);
  var c = pushConfig_()[req.profileId];
  if (!c) throw err_('Primero abrí Ajustes → Notificaciones.', 'format');
  ntfySend_(c.topic, { title: 'Hogar', message: '✅ Listo: los avisos de Hogar llegan a este celular.', tags: ['house'] });
  return { sent: true };
}

function ntfySend_(topic, msg) {
  var cfg = pushConfig_();
  var body = { topic: topic, title: msg.title, message: msg.message, tags: msg.tags || [] };
  if (cfg._appUrl) body.click = cfg._appUrl + (msg.path ? '#' + msg.path : '');
  var res = UrlFetchApp.fetch(NTFY_SERVER + '/', { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(body) });
  var code = res.getResponseCode();
  if (code >= 300) throw err_('ntfy no respondió (' + code + ').', 'network');
}

/** Se llama después de cada push con los registros NUEVOS (no ediciones). Nunca hace fallar la sincronización. */
function notifyCreated_(created) {
  try {
    if (!created.length) return;
    var cfg = pushConfig_();
    var any = Object.keys(cfg).some(function (k) { return k.charAt(0) !== '_' && cfg[k] && cfg[k].enabled; });
    if (!any) return;
    var profiles = {};
    new Table_('profiles').all().forEach(function (p) { if (!p.deleted) profiles[p.id] = p; });
    var adults = Object.keys(profiles).filter(function (id) { return profiles[id].role === 'adult' && profiles[id].active !== false; });
    var nameOf = function (id) { return (profiles[id] && profiles[id].name) || ''; };
    var tpl = null;
    var templates = function () {
      if (!tpl) { tpl = {}; new Table_('shoppingLists').all().forEach(function (l) { if (l.isTemplate === true || l.isTemplate === 'TRUE' || l.isTemplate === 'true') tpl[l.id] = true; }); }
      return tpl;
    };
    var inbox = {}; //profileId → { shop: {by: [names]}, tasks: [] }
    var box = function (id) { return inbox[id] || (inbox[id] = { shop: {}, shopOrder: [], tasks: [] }); };

    created.forEach(function (x) {
      var r = x.rec;
      var by = r.updatedBy || r.requestedBy || '';
      if (x.entity === 'shoppingItems') {
        if (r.status && r.status !== 'pendiente') return;
        if (r.listId && templates()[r.listId]) return; // guardar una lista como plantilla no es un pedido
        var who = r.requestedBy || by;
        adults.forEach(function (a) {
          if (a === by) return;
          var b = box(a);
          if (!b.shop[who]) { b.shop[who] = []; b.shopOrder.push(who); }
          b.shop[who].push(String(r.name || '').trim());
        });
      } else if (x.entity === 'tasks') {
        if (r.occurrenceDate || r.status === 'completada') return; // repeticiones automáticas: no
        var targets = [r.assigneeId].concat(Array.isArray(r.collaboratorIds) ? r.collaboratorIds : []);
        var rec = {};
        targets.forEach(function (t) {
          if (!t || !profiles[t]) return;
          if (profiles[t].role === 'adult') rec[t] = 'vos';
          else adults.forEach(function (a) { if (!rec[a]) rec[a] = nameOf(t); }); // tareas de los chicos: avisa a los adultos
        });
        if (!r.assigneeId) adults.forEach(function (a) { if (!rec[a]) rec[a] = ''; });
        Object.keys(rec).forEach(function (a) {
          if (a === by) return;
          box(a).tasks.push({ title: String(r.title || '').trim(), forWho: rec[a], due: r.dueDate ? String(r.dueDate).slice(0, 10) : '', by: nameOf(by) });
        });
      }
    });

    Object.keys(inbox).forEach(function (a) {
      var c = cfg[a];
      if (!c || !c.enabled) return;
      var b = inbox[a];
      var lines = [];
      b.shopOrder.forEach(function (who) {
        var items = b.shop[who].filter(Boolean);
        if (items.length) lines.push('🛒 ' + (nameOf(who) ? nameOf(who) + (profiles[who] && profiles[who].role === 'child' ? ' pidió: ' : ' agregó: ') : 'Nuevo en compras: ') + items.join(', '));
      });
      b.tasks.forEach(function (t) {
        var head = t.forWho === 'vos' ? '✅ Nueva tarea para vos' : t.forWho ? '✅ Nueva tarea para ' + t.forWho : '✅ Nueva tarea';
        lines.push(head + ': ' + t.title + (t.due ? ' (' + t.due.slice(8, 10) + '/' + t.due.slice(5, 7) + ')' : '') + (t.by ? ' · cargó ' + t.by : ''));
      });
      if (!lines.length) return;
      var onlyShop = !b.tasks.length;
      try {
        ntfySend_(c.topic, { title: onlyShop ? 'Hogar · Compras' : b.shopOrder.length ? 'Hogar' : 'Hogar · Tareas', message: lines.join('\n').slice(0, 3500), tags: [], path: onlyShop ? '/compras' : '/tareas' });
      } catch (e) { logError_('avisos', e); }
    });
  } catch (e) { logError_('avisos', e); }
}
