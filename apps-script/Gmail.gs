/**
 * Gmail (opcional, solo lectura). Requiere GMAIL_ENABLED = true en las propiedades del script (se activa desde la app)
 * y el permiso gmail.readonly. Solo busca con la consulta que escribe la persona y devuelve como máximo 20 mensajes;
 * nunca envía, elimina, archiva ni marca mensajes. Lo importado pasa por la revisión del asistente.
 * Si no querés esta integración, borrá este archivo y el permiso gmail.readonly de appsscript.json.
 */

function assertGmail_() {
  if (props_().getProperty('GMAIL_ENABLED') !== 'true') throw err_('La integración con Gmail está desactivada.', 'disabled');
}

function gmailSearch_(req) {
  assertGmail_();
  var q = String(req.query || '').trim();
  if (!q) throw err_('Escribí una búsqueda (por ejemplo: factura newer_than:30d).', 'format');
  var max = Math.min(Number(req.max || 10), 20);
  return GmailApp.search(q, 0, max).map(function (th) {
    var msgs = th.getMessages();
    var m = msgs[msgs.length - 1];
    return {
      id: m.getId(), threadId: th.getId(), subject: m.getSubject(), from: m.getFrom(), date: m.getDate().toISOString(),
      snippet: m.getPlainBody().replace(/\s+/g, ' ').slice(0, 280), attachments: m.getAttachments().length,
    };
  });
}

function gmailGet_(req) {
  assertGmail_();
  var m = GmailApp.getMessageById(req.id);
  if (!m) throw err_('Mensaje no encontrado', 'format');
  return {
    id: m.getId(), subject: m.getSubject(), from: m.getFrom(), date: m.getDate().toISOString(),
    body: m.getPlainBody().slice(0, 20000),
    attachments: m.getAttachments().map(function (a, i) { return { index: i, name: a.getName(), mimeType: a.getContentType(), size: a.getSize() }; }),
  };
}

function gmailAttachment_(req) {
  assertGmail_();
  var m = GmailApp.getMessageById(req.id);
  var a = m.getAttachments()[Number(req.index)];
  if (!a) throw err_('Adjunto no encontrado', 'format');
  var type = a.getContentType();
  if (!/^(application\/pdf|image\/)/.test(type)) throw err_('Solo se importan adjuntos PDF o imágenes.', 'format');
  if (a.getSize() > 10 * 1024 * 1024) throw err_('El adjunto supera 10 MB.', 'format');
  return { name: a.getName(), mimeType: type, base64: Utilities.base64Encode(a.getBytes()) };
}
