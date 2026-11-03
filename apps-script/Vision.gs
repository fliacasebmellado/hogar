/**
 * Lectura de imágenes y textos con IA (Gemini, de Google) — opcional.
 * - La clave queda SOLO en las Propiedades del script (GEMINI_API_KEY): nunca viaja a la app ni está en el código.
 * - Se usa solo si la familia la activa en Ajustes → Asistente. Sin clave o sin conexión, la app usa sus reglas locales.
 * - Devuelve propuestas en un formato fijo; la app las muestra para revisar antes de guardar (nada se guarda solo).
 * - Nivel gratuito de Gemini: Google puede usar el contenido para mejorar sus productos (por eso es opcional).
 */

var GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

/** Ejecutar UNA vez desde el editor para autorizar la conexión con Gemini (permiso "servicio externo"). */
function autorizarIA() {
  UrlFetchApp.fetch('https://generativelanguage.googleapis.com/', { muteHttpExceptions: true });
  Logger.log('Listo: Hogar ya puede conectarse con Gemini. Ahora cargá la clave desde la app (Ajustes → Asistente).');
}

function visionStatus_() {
  return { configured: !!props_().getProperty('GEMINI_API_KEY'), model: props_().getProperty('GEMINI_MODEL') || GEMINI_DEFAULT_MODEL };
}

function setGeminiKey_(req) {
  var k = String(req.key || '').trim();
  if (!k) { props_().deleteProperty('GEMINI_API_KEY'); return visionStatus_(); }
  if (k.length < 20 || /\s/.test(k)) throw err_('La clave no parece válida.', 'format');
  props_().setProperty('GEMINI_API_KEY', k);
  return visionStatus_();
}

var VISION_SCHEMA_ = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: ['evento', 'tarea', 'compra', 'pago', 'nota'] },
          title: { type: 'STRING' },
          date: { type: 'STRING', description: 'AAAA-MM-DD' },
          time: { type: 'STRING', description: 'HH:MM (24 h) o vacío' },
          endTime: { type: 'STRING' },
          location: { type: 'STRING' },
          personIds: { type: 'ARRAY', items: { type: 'STRING' } },
          personSure: { type: 'BOOLEAN' },
          category: { type: 'STRING', enum: ['colegio', 'actividades', 'turnos', 'salud', 'cumpleanos', 'tramites', 'reuniones', 'familia', 'otros'] },
          notes: { type: 'STRING' },
          amount: { type: 'NUMBER' },
          currency: { type: 'STRING' },
          products: { type: 'ARRAY', items: { type: 'STRING' } },
          doubt: { type: 'STRING', description: 'Qué conviene que la persona revise, si algo no es seguro' },
        },
        required: ['type', 'title'],
      },
    },
    summary: { type: 'STRING' },
  },
  required: ['items'],
};

function visionPrompt_(ctx) {
  var people = (ctx.profiles || []).map(function (p) {
    return '- id "' + p.id + '": ' + p.name + ' (' + (p.role === 'child' ? 'hijo/a' : p.role === 'adult' ? 'adulto' : 'familia') + ')' +
      (p.school ? ', curso/grado/división: ' + p.school : '') + (p.aliases && p.aliases.length ? ', también le dicen: ' + p.aliases.join(', ') : '');
  }).join('\n');
  return [
    'Sos el asistente de la agenda de una familia de Argentina. Hoy es ' + ctx.today + ' (zona horaria America/Argentina/Buenos_Aires).',
    'La persona que carga esto es: ' + (ctx.currentName || 'un adulto de la familia') + ' (id "' + (ctx.currentProfileId || '') + '").',
    'Integrantes:', people, '',
    'Extraé SOLO lo que la familia tiene que agendar o hacer. Reglas:',
    '1. Tablas o cronogramas del colegio (exámenes, actos, horarios): usá únicamente las filas o columnas del curso de cada hijo/a (según "curso/grado/división"). Un evento por fecha y materia, con personIds de ese hijo/a, category "colegio" y título como "Examen de Matemática" o "Examen oral de Inglés". Si una fila tiene varias fechas posibles, creá una por fecha y explicá en doubt que hay que confirmar cuál le toca. Ignorá los demás cursos.',
    '2. Tarjetas o invitaciones de cumpleaños: un evento "Cumpleaños de <nombre de quien cumple>" con fecha, hora, lugar, category "cumpleanos". Si la invitación es para uno de los hijos, ponelo en personIds.',
    '3. Turnos médicos: un evento "Turno <especialidad> con <médico>" con fecha, hora, lugar, category "turnos" y en notes la especialidad, el médico y la obra social. personIds = el paciente si coincide con un integrante; si no se sabe de quién es, personIds vacío y personSure false.',
    '4. Si falta el año, usá la próxima fecha a partir de hoy. Fechas en formato AAAA-MM-DD y horas HH:MM de 24 h; si dice "am"/"pm" sin hora exacta, dejá time vacío y explicalo en doubt.',
    '5. No inventes datos. No incluyas logos, encabezados, publicidad, números de página ni texto suelto sin una acción concreta.',
    '6. personSure = true solo si estás seguro de a quién corresponde.',
    '7. Todo en español rioplatense.',
  ].join('\n');
}

/** req: { images: [{ mime, base64 }], text, context: { today, profiles, currentProfileId, currentName } } */
function visionInterpret_(req) {
  var key = props_().getProperty('GEMINI_API_KEY');
  if (!key) throw err_('Falta la clave de Gemini (Ajustes → Asistente).', 'config');
  var parts = [{ text: visionPrompt_(req.context || {}) }];
  if (req.text) parts.push({ text: 'Texto recibido:\n' + String(req.text).slice(0, 20000) });
  (req.images || []).slice(0, 4).forEach(function (im) { parts.push({ inline_data: { mime_type: im.mime || 'image/jpeg', data: im.base64 } }); });
  var model = props_().getProperty('GEMINI_MODEL') || GEMINI_DEFAULT_MODEL;
  var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify({ contents: [{ role: 'user', parts: parts }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: VISION_SCHEMA_ } }),
  });
  var code = res.getResponseCode();
  if (code === 429) throw err_('Se alcanzó el límite gratuito de Gemini por ahora. Se usaron las reglas locales.', 'quota');
  if (code === 400 || code === 403) throw err_('Gemini rechazó la clave o el pedido (' + code + '). Revisá la clave en Ajustes → Asistente.', 'config');
  if (code >= 300) throw err_('Gemini no respondió (' + code + ').', 'network');
  var body = JSON.parse(res.getContentText());
  var txt = body && body.candidates && body.candidates[0] && body.candidates[0].content && body.candidates[0].content.parts && body.candidates[0].content.parts[0] && body.candidates[0].content.parts[0].text;
  if (!txt) return { items: [], summary: '' };
  var out = JSON.parse(txt);
  return { items: out.items || [], summary: out.summary || '', model: model };
}
