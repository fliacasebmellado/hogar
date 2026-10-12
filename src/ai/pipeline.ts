// Flujo obligatorio: Captura → Interpretación → Revisión → Confirmación → Guardado → Sincronización.
// - La captura (con su archivo original) se guarda ANTES de interpretar: nada se pierde si algo falla.
// - La interpretación solo produce propuestas; ningún registro se crea sin confirmación explícita.
// - Al confirmar se guarda todo en una transacción y se registra la decisión tomada sobre cada propuesta.
import type { Repo } from '../db/repo';
import type { Attachment, Capture, CaptureDecision, CaptureKind, EntityName, ID } from '../domain/types';
import type { AISettings, ExistingIndex, InterpretContext, Proposal } from './types';
import { DEFAULT_AI_SETTINGS } from './types';
import { buildProposalsFromText, base, billProposal, docCategoryFromText, looksLikeBill } from './rules';
import { blockingIssues, finalizeProposal } from './finalize';
import { llmInterpret } from './llm';
import { storeFile, getLocalFile } from '../services/files';
import { captureFolder } from '../services/folders';
import { relocateDocumentFile } from '../services/documents';
import { createTask } from '../services/tasks';
import { createPayment, createExpense, confirmPayment } from '../services/money';
import { addItem, DEFAULT_LIST_ID } from '../services/shopping';
import { createRepair, createMaintenance } from '../services/house';
import { SENSITIVE_DOC_CATEGORIES } from '../domain/catalog';
import { nowISO, today } from '../domain/dates';

export interface NewCaptureInput { kind: CaptureKind; text?: string; files?: { blob: Blob; name: string }[]; by?: ID; sourceRef?: string; transcript?: string }

export async function createCapture(repo: Repo, input: NewCaptureInput): Promise<Capture> {
  if (input.sourceRef) {
    const prev = (await repo.list('captures')).find((c) => c.sourceRef === input.sourceRef && c.status !== 'cancelada');
    if (prev) return prev; // misma respuesta de formulario / correo / evento externo ya capturado
  }
  const attachmentIds: ID[] = [];
  for (const f of input.files ?? []) {
    const folder = captureFolder(f.blob.type);
    const { attachment } = await storeFile(repo, f.blob, f.name, folder, input.by);
    attachmentIds.push(attachment.id);
  }
  const text = [input.text?.trim(), input.transcript ? `[Transcripción] ${input.transcript.trim()}` : ''].filter(Boolean).join('\n');
  return repo.create('captures', {
    kind: input.kind, text, attachmentIds, status: 'pendiente', proposals: [], decisions: [], createdBy: input.by, sourceRef: input.sourceRef,
  }, { by: input.by, origin: 'asistente' });
}

export async function buildExistingIndex(repo: Repo): Promise<ExistingIndex> {
  const [tasks, events, items, payments, expenses, docs, repairs, assets] = await Promise.all([
    repo.list('tasks'), repo.list('events'), repo.list('shoppingItems'), repo.list('payments'), repo.list('expenses'),
    repo.list('documents'), repo.list('repairs'), repo.list('assets'),
  ]);
  return {
    tasks: tasks.filter((t) => !t.isSeries).map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, status: t.status })),
    events: events.map((e) => ({ id: e.id, title: e.title, start: e.start })),
    shoppingItems: items.filter((i) => !i.mergedInto).map((i) => ({ id: i.id, name: i.name, status: i.status, listId: i.listId })),
    payments: payments.filter((p) => !p.isSeries).map((p) => ({ id: p.id, concept: p.concept, dueDate: p.dueDate, status: p.status, amount: p.amount, provider: p.provider })),
    expenses: expenses.map((e) => ({ id: e.id, concept: e.concept, date: e.date, amount: e.amount })),
    documents: docs.map((d) => ({ id: d.id, name: d.name, date: d.date })),
    repairs: repairs.map((r) => ({ id: r.id, title: r.title, status: r.status })),
    assets: assets.map((a) => ({ id: a.id, name: a.name })),
  };
}

export async function buildContext(repo: Repo, currentProfileId?: string, now = new Date()): Promise<InterpretContext> {
  const profiles = await repo.list('profiles');
  return {
    now, currentProfileId,
    profiles: profiles.map((p) => ({ id: p.id, name: p.name, role: p.role, aliases: p.aliases ?? [], active: p.active })),
    existing: await buildExistingIndex(repo),
  };
}

/** Interpreta un texto. En modo manual (IA deshabilitada) no hay clasificación: se ofrece una propuesta para completar. */
export async function interpretText(text: string, ctx: InterpretContext, settings: AISettings = DEFAULT_AI_SETTINGS): Promise<{ proposals: Proposal[]; processor: string; notes: string[] }> {
  const notes: string[] = [];
  let proposals: Proposal[] = [];
  let processor = 'reglas locales';
  if (!text.trim()) return { proposals: [], processor: 'ninguno', notes: ['No hay texto para interpretar.'] };
  if (settings.mode === 'manual') {
    const p = base('nota', 'informacion', text, { title: text.split('\n')[0].slice(0, 80), body: text, personIds: [] }, null);
    p.processor = 'manual';
    p.warnings.push('Interpretación automática desactivada: elegí el tipo y completá los datos.');
    return { proposals: [finalizeProposal(p, ctx.existing)], processor: 'manual', notes };
  }
  if (settings.llm.enabled) {
    try {
      proposals = await llmInterpret(text, ctx, settings.llm);
      processor = `modelo local (${settings.llm.model})`;
    } catch (e: any) {
      notes.push(`El modelo local no respondió (${e.message}). Se usaron las reglas locales.`);
    }
  }
  if (!proposals.length) proposals = buildProposalsFromText(text, ctx);
  return { proposals: proposals.map((p) => finalizeProposal(p, ctx.existing)), processor, notes };
}

export interface Extractors {
  ocr?: (blob: Blob) => Promise<string>;
  pdf?: (blob: Blob) => Promise<string>;
  transcribe?: (blob: Blob) => Promise<string>;
  onProgress?: (msg: string) => void;
}

/** Extrae texto de los adjuntos (si los procesadores están habilitados), interpreta y deja la captura "en revisión". */
export async function processCapture(repo: Repo, captureId: ID, opts: { settings?: AISettings; extractors?: Extractors; currentProfileId?: string; now?: Date } = {}): Promise<Capture> {
  const settings = opts.settings ?? DEFAULT_AI_SETTINGS;
  const ex = opts.extractors ?? {};
  const capture = await repo.get('captures', captureId);
  if (!capture) throw new Error('Captura inexistente');
  const notes: string[] = [];
  const extracted: string[] = [];
  const attachments: Attachment[] = [];
  const procs = new Set<string>();
  for (const id of capture.attachmentIds) {
    const att = await repo.get('attachments', id);
    if (!att) continue;
    attachments.push(att);
    const blob = await getLocalFile(repo, id);
    if (!blob) { notes.push(`"${att.name}" no está disponible en este dispositivo.`); continue; }
    try {
      if (att.mimeType.startsWith('image/')) {
        if (settings.mode !== 'manual' && settings.ocr && ex.ocr) {
          ex.onProgress?.(`Leyendo texto de ${att.name}…`);
          const t = await ex.ocr(blob);
          if (t.trim()) { extracted.push(t); procs.add('OCR local (Tesseract)'); } else notes.push(`No se encontró texto legible en "${att.name}".`);
        } else notes.push(`La imagen "${att.name}" se guardó, pero no se leyó su texto (lectura de imágenes desactivada).`);
      } else if (att.mimeType === 'application/pdf') {
        if (settings.mode !== 'manual' && settings.pdfText && ex.pdf) {
          const t = await ex.pdf(blob);
          if (t.trim()) { extracted.push(t); procs.add('texto de PDF (pdf.js)'); } else notes.push(`"${att.name}" no tiene texto seleccionable (puede ser un escaneo).`);
        } else notes.push(`El PDF "${att.name}" se guardó sin extraer su texto.`);
      } else if (att.mimeType.startsWith('audio/')) {
        if (settings.mode !== 'manual' && settings.whisper && ex.transcribe) {
          const t = await ex.transcribe(blob);
          if (t.trim()) { extracted.push(t); procs.add('transcripción local (Whisper)'); } else notes.push(`No se obtuvo texto del audio "${att.name}".`);
        } else if (!capture.text?.includes('[Transcripción]')) notes.push(`El audio "${att.name}" se guardó sin transcribir. Escribí lo que dice para interpretarlo.`);
      } else if (att.mimeType === 'text/plain') {
        extracted.push(await blob.text());
      }
    } catch (e: any) {
      notes.push(`No se pudo procesar "${att.name}": ${e.message ?? e}. El archivo original quedó guardado.`);
    }
  }
  const fullText = [capture.text ?? '', ...extracted].filter(Boolean).join('\n');
  const ctx = await buildContext(repo, opts.currentProfileId, opts.now);
  // Las facturas leídas de archivos se interpretan como un único pago; el resto del texto, por fragmentos.
  const bills = settings.mode === 'manual' ? [] : extracted.filter(looksLikeBill);
  const rest = [capture.text ?? '', ...extracted.filter((t) => !bills.includes(t))].filter(Boolean).join('\n');
  const result = rest.trim() ? await interpretText(rest, ctx, settings) : { proposals: [], processor: 'reglas locales', notes: [] as string[] };
  notes.push(...result.notes);
  const proposals = [...result.proposals, ...bills.map((b) => finalizeProposal(billProposal(b, ctx), ctx.existing))];

  // Archivos que conviene guardar como documento (PDF siempre; imágenes solo si parecen documentos).
  for (const att of attachments) {
    if (att.mimeType.startsWith('audio/')) continue;
    const isPdf = att.mimeType === 'application/pdf' || /\.(docx?|xlsx?)$/i.test(att.name);
    const cat = docCategoryFromText(`${att.name} ${extracted.join(' ')}`);
    if (!isPdf && !cat && capture.kind !== 'documento') continue;
    const p = base('documento', 'crear', att.name, {
      name: att.name.replace(/\.[a-z0-9]+$/i, ''), category: cat ?? undefined, date: today(), attachmentId: att.id,
      visibility: cat && SENSITIVE_DOC_CATEGORIES.includes(cat) ? 'adultos' : 'familia', tags: [], description: '',
    }, cat ? 0.6 : 0.2);
    p.include = isPdf || capture.kind === 'documento' || !!cat;
    if (!cat) p.ambiguities.push({ field: 'category', message: 'No se puede saber con certeza qué documento es. ¿Qué categoría corresponde?', options: [['identidad', 'Identidad (DNI, pasaporte)'], ['salud', 'Salud / obra social'], ['facturas', 'Factura'], ['comprobantes', 'Comprobante'], ['colegio', 'Colegio'], ['contratos', 'Contrato'], ['seguros', 'Seguro'], ['garantias', 'Garantía'], ['manuales', 'Manual'], ['vehiculos', 'Vehículo'], ['impuestos', 'Impuestos'], ['familia', 'Doc. familiar'], ['vivienda', 'Vivienda'], ['otros', 'Otro']].map(([value, label]) => ({ label, value })) });
    proposals.push(finalizeProposal(p, ctx.existing));
  }
  if (!proposals.length && !fullText.trim()) {
    const p = base('nota', 'informacion', '', { title: '', body: '' }, null);
    p.warnings.push('No hay texto interpretado. Escribí el contenido o elegí qué registro crear.');
    proposals.push(finalizeProposal(p, ctx.existing));
  }
  const processor = [result.processor, ...procs].join(' + ');
  return repo.update('captures', captureId, {
    status: 'en_revision', proposals, extractedText: extracted.join('\n---\n') || undefined, processor,
    decisions: [], ...(notes.length ? {} : {}),
  }, { skipHistory: true }).then(async (c) => {
    if (notes.length) await repo.db.setKV(`captureNotes:${captureId}`, notes);
    return c;
  });
}

export async function captureNotes(repo: Repo, captureId: ID): Promise<string[]> {
  return repo.db.getKV(`captureNotes:${captureId}`, []);
}

/** Guarda una edición de las propuestas (sin crear registros). */
export async function saveReview(repo: Repo, captureId: ID, proposals: Proposal[]) {
  return repo.update('captures', captureId, { proposals }, { skipHistory: true });
}

export async function cancelCapture(repo: Repo, captureId: ID, by?: ID) {
  const c = await repo.get('captures', captureId);
  if (!c) return;
  const decisions: CaptureDecision[] = c.proposals.map((p) => ({ proposalId: p.id, action: 'descartado', at: nowISO() }));
  await repo.update('captures', captureId, { status: 'cancelada', decisions, processedAt: nowISO() }, { by });
}

export interface SavedRecord { entity: EntityName; id: ID; title: string; action: CaptureDecision['action'] }

/** Confirma y guarda las propuestas incluidas. Falla sin guardar NADA si alguna tiene datos faltantes o ambiguos. */
export async function confirmCapture(repo: Repo, captureId: ID, proposals: Proposal[], by?: ID): Promise<SavedRecord[]> {
  const capture = await repo.get('captures', captureId);
  if (!capture) throw new Error('Captura inexistente');
  if (capture.status === 'procesada') throw new Error('Esta captura ya fue procesada.');
  const problems = proposals.flatMap((p) => blockingIssues(p).map((i) => `${p.fields.title ?? p.fields.concept ?? p.fields.name ?? p.kind}: ${i}`));
  if (problems.length) throw new Error('Revisá antes de confirmar: ' + problems.join(' '));
  const saved: SavedRecord[] = [];
  const decisions: CaptureDecision[] = [];
  await repo.tx(async () => {
    for (const p of proposals) {
      if (!p.include) { decisions.push({ proposalId: p.id, action: 'descartado', at: nowISO() }); continue; }
      const out = await applyProposal(repo, p, capture, by);
      saved.push(...out);
      for (const s of out) decisions.push({ proposalId: p.id, action: s.action, entity: s.entity, recordId: s.id, at: nowISO() });
      if (!out.length) decisions.push({ proposalId: p.id, action: 'descartado', at: nowISO() });
    }
    await repo.update('captures', captureId, { status: 'procesada', proposals, decisions, processedAt: nowISO() }, { by });
  });
  return saved;
}

async function applyProposal(repo: Repo, p: Proposal, capture: Capture, by?: ID): Promise<SavedRecord[]> {
  const f = p.fields;
  const opts = { by, origin: 'asistente' as const };
  const nonDocAttachments = capture.attachmentIds.filter((id) => id !== f.attachmentId);
  const target = p.duplicateChoice && p.duplicateChoice !== 'nuevo' ? p.duplicateTargetId ?? p.duplicates[0]?.id : undefined;
  const linkTo = async (entity: EntityName, id: ID, title: string): Promise<SavedRecord[]> => {
    const rec: any = await repo.get(entity, id);
    if (rec && Array.isArray(rec.attachmentIds) && nonDocAttachments.length) {
      await repo.update(entity, id, { attachmentIds: [...new Set([...rec.attachmentIds, ...nonDocAttachments])] } as any, opts);
    }
    return [{ entity, id, title, action: 'vinculado' }];
  };
  switch (p.kind) {
    case 'evento': {
      const data = { title: f.title, start: f.start, end: f.end, allDay: !!f.allDay || (f.start && f.start.length === 10), location: f.location, participantIds: f.participantIds ?? [], ownerId: f.ownerId, category: f.category ?? 'otros', reminders: f.reminders ?? [], recurrence: f.recurrence ?? null, description: f.description || p.sourceText, rsvp: 'pendiente' as const, syncCalendar: !!f.syncCalendar };
      if (target && p.duplicateChoice === 'actualizar') { const r = await repo.update('events', target, data, opts); return [{ entity: 'events', id: r.id, title: r.title, action: 'actualizado' }]; }
      if (target) return linkTo('events', target, f.title);
      // Evento importado desde Google Calendar: queda vinculado al original sin reescribirlo en Google.
      const gcal = f.googleEventId ? { googleEventId: f.googleEventId, syncCalendar: true, googleUpdated: nowISO(), calendarSyncedAt: new Date(Date.now() + 60_000).toISOString() } : {};
      const r = await repo.create('events', { ...data, ...gcal, attachmentIds: nonDocAttachments }, f.googleEventId ? { ...opts, origin: 'google_calendar' } : opts);
      return [{ entity: 'events', id: r.id, title: r.title, action: 'creado' }];
    }
    case 'tarea': {
      const data = { title: f.title, description: f.description || p.sourceText, dueDate: f.dueDate, dueTime: f.dueTime, assigneeId: f.assigneeId, collaboratorIds: f.collaboratorIds ?? [], category: f.category ?? 'otras', priority: f.priority ?? 'media' };
      if (target && p.duplicateChoice === 'actualizar') { const r = await repo.update('tasks', target, data, opts); return [{ entity: 'tasks', id: r.id, title: r.title, action: 'actualizado' }]; }
      if (target) return linkTo('tasks', target, f.title);
      const r = await createTask(repo, { ...data, recurrence: f.recurrence ?? null, attachmentIds: nonDocAttachments }, opts);
      return [{ entity: 'tasks', id: r.id, title: r.title, action: 'creado' }];
    }
    case 'compra': {
      const out: SavedRecord[] = [];
      for (const it of (f.items ?? []).filter((i: any) => i.include && i.name?.trim())) {
        const res = await addItem(repo, { listId: f.listId ?? DEFAULT_LIST_ID, name: it.name, quantity: it.quantity, unit: it.unit, category: it.category ?? 'supermercado', buyerId: f.buyerId }, { by, allowDuplicate: !!it.confirmedDuplicate, origin: 'asistente' });
        if (res.item) out.push({ entity: 'shoppingItems', id: res.item.id, title: res.item.name, action: 'creado' });
        else if (res.duplicate) out.push({ entity: 'shoppingItems', id: res.duplicate.id, title: res.duplicate.name, action: 'vinculado' });
      }
      return out;
    }
    case 'pago': {
      const data = { concept: f.concept, amount: f.amount, currency: f.currency ?? 'ARS', dueDate: f.dueDate, category: f.category ?? 'otros', provider: f.provider, responsibleId: f.responsibleId, issueDate: f.issueDate, notes: p.sourceText };
      if (target && p.duplicateChoice === 'actualizar') { const r = await repo.update('payments', target, stripUndef(data), opts); return [{ entity: 'payments', id: r.id, title: r.concept, action: 'actualizado' }]; }
      if (target) return [{ entity: 'payments', id: target, title: f.concept, action: 'vinculado' }];
      const r = await createPayment(repo, { ...data, recurrence: f.recurrence ?? null, receiptDocId: f.receiptDocId }, opts);
      return [{ entity: 'payments', id: r.id, title: r.concept, action: 'creado' }];
    }
    case 'gasto': {
      if (f.markPaymentId) { // corresponde a un pago pendiente: se confirma ese pago (crea UN gasto vinculado, sin duplicar)
        const { expense, payment } = await confirmPayment(repo, f.markPaymentId, { paidDate: f.date, amount: f.amount, by });
        return [{ entity: 'payments', id: payment.id, title: payment.concept, action: 'actualizado' }, { entity: 'expenses', id: expense.id, title: expense.concept, action: 'creado' }];
      }
      if (target && p.duplicateChoice !== 'nuevo') return [{ entity: 'expenses', id: target, title: f.concept, action: 'vinculado' }];
      const r = await createExpense(repo, { concept: f.concept, amount: f.amount, currency: f.currency ?? 'ARS', date: f.date, category: f.category ?? 'otros', responsibleId: f.responsibleId, extraordinary: !!f.extraordinary, notes: p.sourceText }, opts);
      return [{ entity: 'expenses', id: r.id, title: r.concept, action: 'creado' }];
    }
    case 'documento': {
      if (target && p.duplicateChoice !== 'nuevo') return [{ entity: 'documents', id: target, title: f.name, action: 'vinculado' }];
      const att = f.attachmentId ? await repo.get('attachments', f.attachmentId) : undefined;
      const r = await repo.create('documents', { name: f.name, category: f.category, date: f.date, personId: f.personId, description: f.description, tags: f.tags ?? [], visibility: f.visibility ?? 'familia', ownerId: by, attachmentId: f.attachmentId, mimeType: att?.mimeType, expiresAt: f.expiresAt, driveUrl: att?.driveUrl, extractedText: capture.extractedText?.slice(0, 20000) }, opts);
      await relocateDocumentFile(repo, r.id, by); // de Hogar App/Capturas a Documentos/<persona>, Peques, Gastos…
      return [{ entity: 'documents', id: r.id, title: r.name, action: 'creado' }];
    }
    case 'reparacion': {
      if (target && p.duplicateChoice !== 'nuevo') return [{ entity: 'repairs', id: target, title: f.title, action: 'vinculado' }];
      const { repair, taskId } = await createRepair(repo, { title: f.title, description: f.description, assetId: f.assetId, roomId: f.roomId, createTask: f.createTask !== false, taskAssigneeId: f.taskAssigneeId, taskDueDate: f.taskDueDate }, by);
      const out: SavedRecord[] = [{ entity: 'repairs', id: repair.id, title: repair.title, action: 'creado' }];
      if (taskId) out.push({ entity: 'tasks', id: taskId, title: `Reparar: ${repair.title}`, action: 'creado' });
      return out;
    }
    case 'mantenimiento': {
      const m = await createMaintenance(repo, { title: f.title, category: f.category ?? 'preventivo', recurrence: f.recurrence, assigneeId: f.assigneeId, assetId: f.assetId, startDate: f.startDate, frequencySource: 'Definida por la familia' }, by);
      return [{ entity: 'maintenance', id: m.id, title: m.title, action: 'creado' }];
    }
    case 'nota': {
      const r = await repo.create('notes', { title: f.title, body: f.body ?? p.sourceText, personIds: f.personIds ?? [] }, opts);
      return [{ entity: 'notes', id: r.id, title: r.title, action: 'creado' }];
    }
    default:
      return [];
  }
}

function stripUndef<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>;
}

/** Aplica la respuesta a una ambigüedad (opción elegida) sobre los campos de la propuesta. */
export function resolveAmbiguity(p: Proposal, index: number, value: any): Proposal {
  const a = p.ambiguities[index];
  const fields = { ...p.fields };
  let kind = p.kind;
  if (a.field === 'date') {
    if (kind === 'evento') { const time = typeof fields.start === 'string' && fields.start.length > 10 ? fields.start.slice(10) : ''; fields.start = value + time; fields.allDay = !time; }
    else if (kind === 'pago' || kind === 'tarea') fields.dueDate = value;
    else if (kind === 'gasto') fields.date = value;
    else fields.date = value;
  } else if (a.field === 'time') {
    if (kind === 'evento') {
      const d = String(fields.start ?? '').slice(0, 10);
      if (value === 'allday') { fields.allDay = true; fields.start = d || undefined; }
      else { fields.allDay = false; fields.start = d ? `${d}T${value}` : undefined; }
    } else if (kind === 'tarea') fields.dueTime = value === 'allday' ? undefined : value;
  } else if (a.field === 'amount') { fields.amount = value.amount; fields.currency = value.currency; }
  else if (a.field === 'responsible') {
    if (kind === 'tarea') fields.assigneeId = value; else if (kind === 'evento') fields.ownerId = value;
    else if (kind === 'reparacion') fields.taskAssigneeId = value; else fields.responsibleId = value;
  } else if (a.field === 'kind') kind = value;
  else if (a.field === 'category') fields.category = value;
  const ambiguities = p.ambiguities.map((x, i) => (i === index ? { ...x, resolved: true } : x));
  return { ...p, kind, fields, ambiguities };
}

/** Cambia el tipo de una propuesta conservando lo que se pueda (título, fecha, importe). */
export function changeKind(p: Proposal, kind: Proposal['kind']): Proposal {
  const f = p.fields;
  const title = f.title ?? f.concept ?? f.name ?? p.sourceText.slice(0, 80);
  const date = (typeof f.start === 'string' ? f.start.slice(0, 10) : undefined) ?? f.dueDate ?? f.date;
  const fieldsByKind: Record<string, any> = {
    evento: { title, start: date, allDay: true, category: 'otros', participantIds: f.participantIds ?? [], ownerId: f.ownerId ?? f.assigneeId ?? f.responsibleId, reminders: [], recurrence: f.recurrence ?? null },
    tarea: { title, dueDate: date, assigneeId: f.assigneeId ?? f.ownerId ?? f.responsibleId, collaboratorIds: [], category: 'otras', priority: 'media', recurrence: f.recurrence ?? null },
    compra: { items: [{ name: title, include: true, category: 'supermercado' }] },
    pago: { concept: title, amount: f.amount, currency: f.currency ?? 'ARS', dueDate: date, category: 'otros', responsibleId: f.responsibleId ?? f.assigneeId },
    gasto: { concept: title, amount: f.amount, currency: f.currency ?? 'ARS', date: date ?? today(), category: 'otros', responsibleId: f.responsibleId },
    documento: { name: title, category: f.category, date, visibility: 'familia', tags: [], attachmentId: f.attachmentId },
    reparacion: { title, description: p.sourceText, createTask: true, taskAssigneeId: f.assigneeId },
    mantenimiento: { title, category: 'preventivo', recurrence: f.recurrence ?? null, assigneeId: f.assigneeId },
    nota: { title, body: p.sourceText, personIds: [] },
  };
  return { ...p, kind, include: kind !== 'consulta' && kind !== 'otro', fields: fieldsByKind[kind] ?? { title }, ambiguities: p.ambiguities.filter((a) => a.field !== 'kind'), duplicates: [], duplicateChoice: undefined };
}
