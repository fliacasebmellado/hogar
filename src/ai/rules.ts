// Clasificador por reglas: separa el texto en fragmentos, detecta el tipo de cada uno y arma propuestas.
// No inventa datos: lo que no se encuentra queda como faltante o ambigüedad para que la persona lo complete.
import type { Ambiguity, InterpretContext, Proposal, ProposalKind, ShoppingProposalItem } from './types';
import { extractAmounts, extractDates, extractRecurrence, extractTimes, findPeople, fold, type Span } from './es';
import {
  DOC_CATEGORY, DUE_WORDS, EVENT_CATEGORY, EXPENSE_CATEGORY, KIND_KEYWORDS, MAINT_CATEGORY, PAST_PAY, PAYMENT_CATEGORY, QUESTION_START,
  SHOP_CATEGORY, STOP_FILLERS, TASK_CATEGORY,
} from './lexicon';
import { uuid } from '../domain/ids';
import { addDays, toISODate } from '../domain/dates';
import { occurrencesBetween } from '../domain/recurrence';

// ---------- Segmentación ----------
const CLAUSE_STARTERS = '(hay que|tenemos que|tengo que|comprar|pagar|vence|llevar|traer|llamar|acordate|recorda|no olvidar|no te olvides|ademas|tambien hay|tambien)';

/** Rubro de compras para un producto escrito a mano ("codo 110" → ferretería). */
export function guessShopCategory(name: string): string { return pickCategory(fold(name), SHOP_CATEGORY, 'supermercado'); }

export function segment(text: string): string[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    const f = fold(line);
    // Encabezado de lista ("Comprar:", "Lista del super:") seguido de renglones cortos → un único fragmento de compras.
    if (/:\s*$/.test(line) && /(compra|lista|super|falta|traer|necesit)/.test(f)) {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() && isListLine(lines[j])) { items.push(lines[j].trim()); j++; }
      if (items.length) { out.push(`${line}\n${items.join('\n')}`); i = j; continue; }
    }
    // Bloque de renglones tipo lista sin encabezado (p. ej. captura de una lista).
    if (isBareListLine(line)) {
      const items: string[] = [];
      let j = i;
      while (j < lines.length && lines[j].trim() && isBareListLine(lines[j])) { items.push(lines[j].trim()); j++; }
      if (items.length >= 3) { out.push(`__LISTA__\n${items.join('\n')}`); i = j; continue; }
    }
    for (const s of splitSentences(line)) out.push(s);
    i++;
  }
  return out.filter((s) => s.replace(/[\s.,;!¡¿?-]/g, '').length > 1);
}

function isListLine(l: string) {
  const t = l.trim();
  return /^([-•*·▪◦–]|\d+[.)]|\[ ?\]|☐|□|✓|✔)\s*/.test(t) || (t.split(/\s+/).length <= 5 && !/[.!?]$/.test(t));
}
function isBareListLine(l: string) {
  const t = l.trim();
  const words = t.split(/\s+/).length;
  const f = fold(t);
  if (/\b(hay que|tenemos|pagar|vence|reunion|turno|manana|hoy|a las)\b/.test(f) || /\d{1,2}[/:]\d{1,2}/.test(t) || /\$/.test(t)) return false;
  return words <= 4 && t.length <= 40 && !/[.!?:]$/.test(t);
}

function splitSentences(line: string): string[] {
  const parts = line.split(/(?<=[.!?;])\s+(?=[A-ZÁÉÍÓÚÑ¿¡a-z])/);
  const out: string[] = [];
  const re = new RegExp(`\\s+y\\s+(?=${CLAUSE_STARTERS}\\b)|,\\s*(?=${CLAUSE_STARTERS}\\b)|\\.\\s*(?=${CLAUSE_STARTERS}\\b)`, 'i');
  for (const p of parts) {
    // dividir solo en límites de cláusula sobre el texto normalizado para respetar tildes
    const f = fold(p);
    const cuts: number[] = [];
    const g = new RegExp(re.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = g.exec(f))) cuts.push(m.index, m.index + m[0].length);
    if (!cuts.length) { out.push(p.trim()); continue; }
    let last = 0;
    for (let k = 0; k < cuts.length; k += 2) { out.push(p.slice(last, cuts[k]).trim()); last = cuts[k + 1]; }
    out.push(p.slice(last).trim());
  }
  return out.filter(Boolean);
}

// ---------- Clasificación ----------
const GENERIC = ['hay que', 'tenemos que', 'tengo que', 'tiene que', 'tienen que', 'hacer'];
export interface Classification { kind: ProposalKind; intent: Proposal['intent']; scores: Record<string, number>; ruleScore: number; close?: ProposalKind }

export function classify(seg: string, hasDate: boolean, hasTime: boolean, hasAmount: boolean): Classification {
  const f = fold(seg);
  const scores: Record<string, number> = {};
  for (const [kind, words] of Object.entries(KIND_KEYWORDS)) {
    let s = 0;
    for (const w of words!) if (new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(f)) s += GENERIC.includes(w) ? 1 : w.includes(' ') ? 3 : 2;
    scores[kind] = s;
  }
  if (hasDate) { scores.evento += 1; scores.tarea += 0.5; scores.pago += 0.5; }
  if (hasTime) scores.evento += 2.5;
  if (hasAmount) { scores.pago += 1.5; scores.gasto += 1.5; scores.compra -= 1; }
  if (PAST_PAY.test(f)) { scores.gasto += 4; scores.compra -= 3; }
  if (DUE_WORDS.test(f)) scores.pago += 3;
  if (/\bvence\b|\bvencimiento\b/.test(f)) scores.gasto -= 3;
  if (/\b(se rompio|no anda|no funciona|pierde|gotea)\b/.test(f)) scores.tarea -= 1;
  if (/\b(cada \d+|cada (dos|tres|seis) meses|todos los meses)\b/.test(f) && scores.mantenimiento > 0) scores.mantenimiento += 2;
  if (/\bcomprar\b/.test(f)) scores.compra += 2;
  if (scores.mantenimiento > 0 && !/\b(mantenimiento|service|cada|todos los|todas las|mensual|anual)\b/.test(f)) {
    scores.tarea += scores.mantenimiento; scores.mantenimiento = 0; // sin frecuencia es una tarea puntual
  }
  if (/\b(turno)\b/.test(f) &&/\b(sacar|pedir)\s+turno\b/.test(f)) { scores.tarea += 3; scores.evento -= 2; }

  const question = /\?\s*$/.test(seg.trim()) || QUESTION_START.test(seg);
  const idea = /\b(estaria bueno|podriamos|quizas|tal vez|a lo mejor|habria que ver|pensar en)\b/.test(f);
  const reminder = /\b(recordame|acordate|recorda|no olvidar|no te olvides|avisame)\b/.test(f);

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topKind, top] = ranked[0];
  const second = ranked[1];
  const total = ranked.reduce((a, [, v]) => a + Math.max(0, v), 0);
  if (question) return { kind: 'consulta', intent: 'consulta', scores, ruleScore: 0.6 };
  if (top <= 0.6) return { kind: idea ? 'nota' : 'otro', intent: idea ? 'idea' : 'informacion', scores, ruleScore: 0.2 };
  const kind = topKind as ProposalKind;
  if (idea) return { kind: 'nota', intent: 'idea', scores, ruleScore: 0.4, close: kind !== 'nota' ? kind : undefined };
  const ruleScore = Math.min(0.95, top / (total || 1));
  const close = second && second[1] > 0 && top - second[1] < 1 ? (second[0] as ProposalKind) : undefined;
  return { kind, intent: reminder ? 'recordatorio' : 'crear', scores, ruleScore, close };
}

// ---------- Construcción de propuestas ----------
function pickCategory(f: string, table: [RegExp, string][], fallback: string) {
  for (const [re, c] of table) if (re.test(f)) return c;
  return fallback;
}

function capitalize(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

/** Título legible: quita fechas, horas, importes, muletillas y conectores sobrantes. */
export function cleanTitle(seg: string, spans: Span[], maxLen = 90): string {
  let chars = seg.split('');
  for (const s of spans) for (let k = s.start; k < s.end && k < chars.length; k++) chars[k] = ' ';
  let t = chars.join('');
  const f = fold(t);
  const fillers = new RegExp(STOP_FILLERS.source, 'g');
  let m: RegExpExecArray | null;
  const arr = t.split('');
  while ((m = fillers.exec(f))) for (let k = m.index; k < m.index + m[0].length; k++) arr[k] = ' ';
  t = arr.join('')
    .replace(/\s+/g, ' ')
    .replace(/\b(el|la|los|las|de|del|a|para|por|con|y|que|en)\s*([,.;:]|$)/gi, '$2')
    .replace(/^[\s,.;:\-–y]+|[\s,.;:\-–]+$/g, '')
    .replace(/^(el|la|a|de|que|en|y)\s+/i, '')
    .replace(/^(hay|tenemos|tengo)\s+(?!que\b)/i, '')
    .trim();
  if (t.length > maxLen) t = t.slice(0, maxLen - 1).replace(/\s+\S*$/, '') + '…';
  return capitalize(t);
}

export function parseShoppingItems(seg: string): ShoppingProposalItem[] {
  let body = seg.replace(/^__LISTA__\n/, '');
  const f0 = fold(body);
  // quitar el disparador ("hay que comprar", "faltan", "comprar:")
  const trig = /(.*?\b(comprar|compras|faltan|falta|se acabo|se termino|no hay mas|no queda|traer|reponer|lista del super|lista de compras|lista)\b\s*:?\s*)/.exec(f0);
  if (trig && !body.includes('\n')) body = body.slice(trig[0].length);
  else if (trig && body.includes('\n')) body = body.split('\n').slice(1).join('\n');
  const raw = body
    .split(/\n|,|;|\s+y\s+|\s+e\s+/)
    .map((x) => x.replace(/^\s*([-•*·▪◦–]|\d+[.)]|\[ ?[xX✓]?\]|☐|□|✓|✔)\s*/, '').replace(/[.!]+$/, '').trim())
    .filter((x) => x && x.length < 60);
  const items: ShoppingProposalItem[] = [];
  for (const r of raw) {
    let name = r;
    let quantity: number | undefined;
    let unit: string | undefined;
    const f = fold(r);
    let m = /^(\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|medio|media)\s*(kg|kilo|kilos|g|gr|gramos|l|lt|litro|litros|ml|paquete|paquetes|paq|caja|cajas|docena|docenas|u|unidades|botella|botellas|lata|latas|sachet|sachets)?\s*(?:de\s+)?(.+)$/.exec(f);
    if (m) {
      const words: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, medio: 0.5, media: 0.5 };
      quantity = words[m[1]] ?? Number(m[1].replace(',', '.'));
      const u = m[2];
      if (u) unit = /^k/.test(u) ? 'kg' : /^(g|gr|gramos)$/.test(u) ? 'g' : /^(l|lt|litro|litros)$/.test(u) ? 'l' : u === 'ml' ? 'ml' : /^paq/.test(u) ? 'paq' : /^caja/.test(u) ? 'caja' : /^docena/.test(u) ? 'docena' : u.replace(/s$/, '');
      name = r.slice(r.length - m[3].length);
    }
    m = /^(.+?)\s+x\s*(\d+)\s*(kg|u|l)?$/i.exec(name);
    if (m) { name = m[1]; quantity = Number(m[2]); unit = m[3]?.toLowerCase() ?? unit; }
    name = capitalize(name.trim());
    if (!name || /^(nada|etc)$/i.test(name)) continue;
    items.push({ name, quantity, unit, category: pickCategory(fold(name), SHOP_CATEGORY, 'supermercado'), include: true });
  }
  return items;
}

// ---------- Turnos con formato de ficha ("Paciente: … / Fecha: … / Hora: … / Médico: …") ----------
const APPT_KEYS: [RegExp, string][] = [
  [/^(paciente|nombre|afiliado)$/, 'patient'], [/^(fecha|dia|fecha del turno)$/, 'date'], [/^(hora|horario)$/, 'time'],
  [/^(medico|medico actuante|medica|profesional|doctor|doctora|dr|dra|especialista|prestador)$/, 'doctor'],
  [/^(centro|lugar|sede|consultorio|clinica|institucion|direccion|domicilio|establecimiento)$/, 'place'],
  [/^(especialidad|servicio|practica|estudio|tipo de turno|motivo)$/, 'specialty'], [/^(os|obra social|cobertura|prepaga|plan)$/, 'insurance'],
];
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s(-])([a-záéíóúñ])/g, (_, a, b) => a + b.toUpperCase());

/** Lee un mensaje de turno con renglones "Clave: valor". Devuelve null si no tiene esa forma (fecha y al menos otros 2 datos). */
export function parseAppointment(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  let hits = 0;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const m = raw.trim().match(/^([^:]{2,30}):\s*(.+)$/);
    if (!m) continue;
    const key = fold(m[1]).replace(/[.°]/g, '').replace(/\s+/g, ' ').trim();
    const hit = APPT_KEYS.find(([re]) => re.test(key));
    if (!hit) continue;
    if (!out[hit[1]]) { out[hit[1]] = m[2].trim(); hits++; }
  }
  if (!out.date || hits < 3) return null;
  if (!out.time && !out.doctor && !out.place && !/\bturno\b/.test(fold(text))) return null;
  return out;
}

export function appointmentProposal(text: string, a: Record<string, string>, ctx: InterpretContext): Proposal {
  const numeric = a.date.match(/\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?/);
  const dateHit = extractDates(numeric ? numeric[0] : a.date, ctx.now).find((d) => d.date && !d.ambiguity);
  const tm = (a.time ?? '').match(/(\d{1,2})[:.hH](\d{2})/) ?? (a.time ?? '').match(/^(\d{1,2})\s*(?:hs?|horas)?$/);
  const time = tm ? `${tm[1].padStart(2, '0')}:${(tm[2] ?? '00').padStart(2, '0')}` : undefined;
  const date = dateHit?.date;
  // Paciente: se busca cada palabra del nombre entre los perfiles ("PEREZ GOMEZ TOMAS JUAN" → Tomás).
  const words = fold(a.patient ?? '').split(/[^a-z]+/).filter((w) => w.length > 2);
  const person = ctx.profiles.find((p) => p.active && p.role !== 'family' && [p.name, ...p.aliases].some((n) => words.includes(fold(n))));
  const doctor = a.doctor ? titleCase(a.doctor) : undefined;
  const title = ['Turno', a.specialty ? titleCase(a.specialty) : '', doctor ? `con ${doctor}` : ''].filter(Boolean).join(' ').replace(/^Turno$/, a.place ? `Turno en ${a.place.split('(')[0].trim()}` : 'Turno');
  const p = base('evento', 'crear', text, {
    title, start: date ? (time ? `${date}T${time}` : date) : undefined, allDay: !!date && !time, category: 'turnos',
    participantIds: person ? [person.id] : [], ownerId: person?.id ?? ctx.currentProfileId, reminders: [60, 24 * 60], recurrence: null,
    location: a.place, description: text.trim(), syncCalendar: false,
  }, 0.8);
  if (!date) p.missing.push('start');
  if (!time && date) p.warnings.push('No se encontró la hora del turno: revisala.');
  if (!person && a.patient) p.warnings.push(`No se reconoció al paciente ("${a.patient}"): elegí para quién es.`);
  return p;
}

export function buildProposalsFromText(text: string, ctx: InterpretContext): Proposal[] {
  // Un mensaje de turno (como los que mandan por WhatsApp los centros médicos) es UN solo evento, no un renglón por cosa.
  const appt = parseAppointment(text);
  if (appt) return [appointmentProposal(text, appt, ctx)];
  const proposals: Proposal[] = [];
  const now = ctx.now;
  const groupId = uuid();
  for (const seg of segment(text)) {
    if (seg.startsWith('__LISTA__')) {
      proposals.push(base('compra', 'crear', seg.replace('__LISTA__\n', ''), { items: parseShoppingItems(seg), listId: undefined }, 0.6, groupId));
      continue;
    }
    const dates = extractDates(seg, now);
    const times = extractTimes(seg);
    const rec = extractRecurrence(seg);
    const amountsStrict = extractAmounts(seg);
    const people = findPeople(seg, ctx.profiles, ctx.currentProfileId);
    const cls = classify(seg, dates.some((d) => d.date || d.ambiguity), times.some((t) => t.time), amountsStrict.length > 0);
    const amounts = cls.kind === 'pago' || cls.kind === 'gasto' ? extractAmounts(seg, { bareNumbers: true }) : amountsStrict;
    const f = fold(seg);
    const spans: Span[] = [...dates, ...times, ...amounts, ...(rec ? [rec.span] : [])];
    const ambiguities: Ambiguity[] = [];
    const warnings: string[] = [];
    const missing: string[] = [];

    const dateHit = dates.find((d) => d.date || d.ambiguity);
    if (dates.filter((d) => d.date).length > 1 && new Set(dates.map((d) => d.date)).size > 1) {
      ambiguities.push({ field: 'date', message: 'Hay más de una fecha en el texto. ¿Cuál corresponde?', options: dates.filter((d) => d.date).map((d) => ({ label: `${d.raw.trim()} → ${d.date}`, value: d.date })) });
    } else if (dateHit?.ambiguity) ambiguities.push(dateHit.ambiguity);
    const date = dateHit?.date && !dateHit.ambiguity ? dateHit.date : undefined;
    if (dateHit?.vague && dateHit.date) warnings.push(`"${dateHit.raw}" se interpretó como ${dateHit.date}.`);
    const timeHit = times.find((t) => t.time);
    if (timeHit?.ambiguity) ambiguities.push(timeHit.ambiguity);
    const time = timeHit && !timeHit.ambiguity ? timeHit.time : undefined;
    const partOfDay = times.find((t) => t.partOfDay)?.partOfDay;

    let amount: number | undefined;
    let currency = 'ARS';
    const distinct = [...new Map(amounts.map((a) => [`${a.currency}${a.amount}`, a])).values()];
    if (distinct.length > 1) {
      ambiguities.push({ field: 'amount', message: 'Se encontraron varios importes. ¿Cuál es el correcto?', options: distinct.map((a) => ({ label: `${a.currency} ${a.amount.toLocaleString('es-AR')}`, value: { amount: a.amount, currency: a.currency } })) });
    } else if (distinct.length === 1) {
      amount = distinct[0].amount; currency = distinct[0].currency;
      if (distinct[0].assumedCurrency) warnings.push(`Moneda asumida: ${currency} (no se indicó). Revisala.`);
    }

    // Personas / responsable
    let responsible = people.responsibleId;
    if (!responsible && people.ids.length === 1) responsible = people.ids[0];
    if (people.vagueSomeone && !people.explicitResponsible) {
      responsible = undefined;
      ambiguities.push({ field: 'responsible', message: 'Dice "alguien": ¿quién se encarga?', options: ctx.profiles.filter((p) => p.active).map((p) => ({ label: p.name, value: p.id })) });
    } else if (!people.explicitResponsible && people.ids.length > 1 && (cls.kind === 'tarea' || cls.kind === 'reparacion')) {
      ambiguities.push({ field: 'responsible', message: 'Se mencionan varias personas. ¿Quién es responsable?', options: people.ids.map((id) => ({ label: ctx.profiles.find((p) => p.id === id)?.name ?? id, value: id })) });
      responsible = undefined;
    }
    if (!responsible && !people.vagueSomeone && !['compra', 'nota', 'consulta', 'otro', 'evento'].includes(cls.kind) && ctx.currentProfileId && ctx.profiles.find((x) => x.id === ctx.currentProfileId)?.role !== 'family') {
      responsible = ctx.currentProfileId;
      warnings.push('Responsable sugerido: el perfil actual (no se mencionó a nadie).');
    }

    const title = stripLeadingSubject(cleanTitle(seg, spans), ctx, responsible);
    const concept = cleanConcept(title);
    const sourceText = seg;
    let p: Proposal;
    switch (cls.kind) {
      case 'evento': {
        const start = date ? (time ? `${date}T${time}` : date) : undefined;
        const end = date && timeHit?.endTime ? `${date}T${timeHit.endTime}` : undefined;
        if (!date && !ambiguities.some((a) => a.field === 'date')) missing.push('start');
        if (date && !time && !ambiguities.some((a) => a.field === 'time')) {
          if (partOfDay) ambiguities.push({ field: 'time', message: `Dice "a la ${partOfDay}" sin hora exacta. ¿A qué hora?`, options: (partOfDay === 'manana' ? ['09:00', '10:00', '11:00'] : partOfDay === 'tarde' ? ['15:00', '17:00', '18:00'] : ['20:00', '21:00']).map((t) => ({ label: t, value: t })).concat([{ label: 'Todo el día', value: 'allday' }]) });
          else warnings.push('Sin hora: se guardará como evento de todo el día.');
        }
        p = base('evento', cls.intent, sourceText, {
          title, start, end, allDay: !!date && !time, category: pickCategory(f, EVENT_CATEGORY, 'otros'), participantIds: people.ids,
          ownerId: eventOwner(people, ctx), reminders: cls.intent === 'recordatorio' ? [60] : [], recurrence: rec?.rule ?? null, location: extractLocation(seg),
          description: '', syncCalendar: false,
        }, cls.ruleScore, groupId);
        break;
      }
      case 'tarea':
        p = base('tarea', cls.intent, sourceText, {
          title, dueDate: date, dueTime: time, assigneeId: responsible, collaboratorIds: people.ids.filter((id) => id !== responsible),
          category: pickCategory(f, TASK_CATEGORY, 'otras'), priority: /\b(urgente|ya mismo|cuanto antes|importante)\b/.test(f) ? 'alta' : 'media',
          recurrence: rec?.rule ?? null, description: '',
        }, cls.ruleScore, groupId);
        if (rec && !date) {
          const t0 = toISODate(now);
          p.fields.dueDate = occurrencesBetween(rec.rule, t0, t0, addDays(t0, 400), 1)[0] ?? t0;
        }
        break;
      case 'compra': {
        const items = parseShoppingItems(seg);
        p = base('compra', cls.intent, sourceText, { items, buyerId: people.explicitResponsible ? responsible : undefined }, cls.ruleScore, groupId);
        break;
      }
      case 'pago':
        p = base('pago', cls.intent, sourceText, {
          concept: concept || 'Pago', amount, currency, dueDate: date, category: pickCategory(f, PAYMENT_CATEGORY, 'otros'), provider: guessProvider(f),
          responsibleId: responsible, recurrence: rec?.rule ?? null,
        }, cls.ruleScore, groupId);
        if (!date && !ambiguities.some((a) => a.field === 'date') && !rec) missing.push('dueDate');
        if (amount === undefined && !ambiguities.some((a) => a.field === 'amount')) warnings.push('Sin importe: podés completarlo ahora o más tarde.');
        break;
      case 'gasto':
        p = base('gasto', cls.intent, sourceText, {
          concept: concept || 'Gasto', amount, currency, date: date ?? toISODate(now), category: pickCategory(f, EXPENSE_CATEGORY, 'otros'),
          responsibleId: responsible, extraordinary: /\b(extraordinario|imprevisto|excepcional)\b/.test(f),
        }, cls.ruleScore, groupId);
        if (!date) warnings.push('Sin fecha: se usará la de hoy.');
        if (amount === undefined && !ambiguities.some((a) => a.field === 'amount')) missing.push('amount');
        break;
      case 'reparacion':
        p = base('reparacion', cls.intent, sourceText, {
          title, description: seg, assetId: matchAsset(f, ctx), createTask: true, taskAssigneeId: responsible, taskDueDate: date,
        }, cls.ruleScore, groupId);
        break;
      case 'mantenimiento':
        p = base('mantenimiento', cls.intent, sourceText, {
          title, category: pickCategory(f, MAINT_CATEGORY, 'preventivo'), recurrence: rec?.rule ?? null, assigneeId: responsible,
          assetId: matchAsset(f, ctx), startDate: date,
        }, cls.ruleScore, groupId);
        if (!rec) { missing.push('recurrence'); warnings.push('No se indicó la frecuencia. La app no impone frecuencias técnicas: definila vos.'); }
        break;
      case 'consulta':
        p = base('consulta', 'consulta', sourceText, { title: seg.trim(), body: seg }, cls.ruleScore, groupId);
        p.include = false;
        warnings.push('Parece una pregunta: no se creará nada salvo que cambies el tipo.');
        break;
      case 'nota':
        p = base('nota', cls.intent, sourceText, { title: cleanTitle(seg, []) || 'Nota', body: seg, personIds: people.ids }, cls.ruleScore, groupId);
        if (cls.intent === 'idea') warnings.push(`Parece una idea${cls.close ? ` (podría ser ${cls.close})` : ''}: se propone guardarla como nota.`);
        break;
      default:
        p = base('otro', 'informacion', sourceText, { title: cleanTitle(seg, []) || seg.slice(0, 60), body: seg }, null, groupId);
        p.include = false;
        warnings.push('No se detectó una acción. Podés elegir un tipo o guardarlo como nota.');
    }
    if (cls.close && !['consulta', 'nota', 'otro'].includes(p.kind)) {
      ambiguities.push({ field: 'kind', message: `¿Es ${labelOf(p.kind)} o ${labelOf(cls.close)}?`, options: [{ label: labelOf(p.kind), value: p.kind }, { label: labelOf(cls.close), value: cls.close }] });
    }
    p.ambiguities = ambiguities;
    p.warnings = [...p.warnings, ...warnings];
    p.missing = [...new Set([...p.missing, ...missing])];
    proposals.push(p);
  }
  return proposals;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "Papá tiene que cortar el pasto" → título "Cortar el pasto" (Papá queda como responsable). */
function stripLeadingSubject(title: string, ctx: InterpretContext, responsible?: string): string {
  let t = title.replace(/^(alguien|alguno|cualquiera)\s+/i, '');
  const p = ctx.profiles.find((x) => x.id === responsible);
  if (p) {
    for (const n of [p.name, ...(p.aliases ?? [])]) {
      const re = new RegExp(`^${escapeRe(n)}\\s+(?:se encarga de\\s+|debe\\s+|va a\\s+)?`, 'i');
      if (re.test(t)) { t = t.replace(re, ''); break; }
    }
  }
  return capitalize(t.trim());
}

/** Concepto de pago/gasto sin verbos de pago: "Vence la luz" → "Luz", "Pagué el gas" → "Gas". */
function cleanConcept(title: string): string {
  const t = title
    .replace(/^(vencen?|vencimiento( de)?|vto\.?|pagar|pago( de)?|pagu[eé]|pagamos|gast[eé]|gastamos|compr[eé]|compramos|abonamos|abon[eé]|transfer[ií])\s+/i, '')
    .replace(/^(el|la|los|las|en el|en la|en|de|del)\s+/i, '')
    .replace(/\s+(vence|vencimiento)$/i, '');
  return capitalize(t.trim());
}

/** Responsable de un evento: el indicado explícitamente, o un adulto mencionado, o el perfil actual si es adulto. */
function eventOwner(people: ReturnType<typeof findPeople>, ctx: InterpretContext): string | undefined {
  if (people.explicitResponsible && people.responsibleId) return people.responsibleId;
  const adult = people.ids.find((id) => ctx.profiles.find((p) => p.id === id)?.role === 'adult');
  if (adult) return adult;
  const cur = ctx.profiles.find((p) => p.id === ctx.currentProfileId);
  return cur?.role === 'adult' ? cur.id : people.ids[0];
}

function labelOf(k: ProposalKind) {
  return { evento: 'un evento', tarea: 'una tarea', compra: 'una compra', pago: 'un pago a vencer', gasto: 'un gasto ya realizado', documento: 'un documento', reparacion: 'una reparación', mantenimiento: 'un mantenimiento', nota: 'una nota', consulta: 'una consulta', otro: 'otra cosa' }[k];
}

function extractLocation(seg: string): string | undefined {
  const m = /\b(?:en (?:el|la|lo de)|en)\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ0-9][\wáéíóúñ]+){0,3})/.exec(seg);
  return m ? m[1] : undefined;
}

function guessProvider(f: string): string | undefined {
  const m = /\b(edenor|edesur|edelap|metrogas|naturgy|camuzzi|aysa|absa|telecentro|fibertel|movistar|personal|claro|flow|directv|osde|swiss medical|galeno|medife|omint|arba|agip|visa|mastercard|amex)\b/.exec(f);
  return m ? m[1].replace(/\b\w/g, (c) => c.toUpperCase()) : undefined;
}

function matchAsset(f: string, ctx: InterpretContext): string | undefined {
  for (const a of ctx.existing.assets) {
    const n = fold(a.name);
    if (n.length > 2 && f.includes(n)) return a.id;
  }
  return undefined;
}

export function base(kind: ProposalKind, intent: Proposal['intent'], sourceText: string, fields: Record<string, any>, ruleScore: number | null, groupId?: string): Proposal {
  return { id: uuid(), kind, intent, sourceText, fields, missing: [], ambiguities: [], warnings: [], duplicates: [], relations: [], ruleScore, include: true, processor: 'reglas', groupId };
}

/** Texto extraído de una factura/boleta (PDF u OCR): se lee como un único pago en lugar de frases sueltas. */
export function looksLikeBill(text: string): boolean {
  const f = fold(text);
  return /\b(factura|liquidacion|boleta|resumen de cuenta|aviso de deuda|cupon de pago)\b/.test(f) && /\b(vencimiento|vence|vto|total)\b/.test(f);
}

export function billProposal(text: string, ctx: InterpretContext): Proposal {
  const f = fold(text);
  const dates = extractDates(text, ctx.now).filter((d) => d.date);
  const vIdx = f.search(/venc|vto/);
  const due = (vIdx >= 0 ? dates.find((d) => d.start > vIdx) : undefined)?.date ?? dates.map((d) => d.date!).sort().pop();
  const amounts = extractAmounts(text, { bareNumbers: true });
  const tIdx = f.search(/total|importe a pagar|a pagar/);
  const amt = (tIdx >= 0 ? amounts.find((a) => a.start > tIdx) : undefined) ?? [...amounts].sort((a, b) => b.amount - a.amount)[0];
  const provider = guessProvider(f);
  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 2)?.slice(0, 60) ?? 'Factura';
  const p = base('pago', 'crear', text.slice(0, 400), {
    concept: provider ?? cleanTitle(firstLine, []), amount: amt?.amount, currency: amt?.currency ?? 'ARS', dueDate: due,
    category: pickCategory(f, PAYMENT_CATEGORY, 'otros'), provider, responsibleId: ctx.currentProfileId, recurrence: null,
  }, 0.7);
  p.warnings.push('Datos leídos de una factura: verificá el importe y el vencimiento antes de confirmar.');
  if (amounts.length > 1 && tIdx < 0) p.warnings.push('Había varios importes; se eligió el mayor.');
  return p;
}

export function docCategoryFromText(text: string): string | null {
  const f = fold(text);
  for (const [re, c] of DOC_CATEGORY) if (re.test(f)) return c;
  return null;
}
