// @vitest-environment node
// Pruebas del asistente: interpretación local, revisión obligatoria, ambigüedades, duplicados y procesadores.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Repo } from '../src/db/repo';
import { ensureSeed } from '../src/services/seed';
import { buildContext, cancelCapture, changeKind, confirmCapture, createCapture, interpretText, processCapture, resolveAmbiguity } from '../src/ai/pipeline';
import { blockingIssues, finalizeProposal } from '../src/ai/finalize';
import { mapLLMItems } from '../src/ai/llm';
import { DEFAULT_AI_SETTINGS, type AISettings, type Proposal } from '../src/ai/types';
import { createPayment } from '../src/services/money';
import { uuid } from '../src/domain/ids';

const NOW = new Date(2026, 9, 11, 10, 0); // domingo 11/10/2026 10:00
const MAMA = 'profile-mama';
let repo: Repo;
beforeEach(async () => {
  repo = await Repo.open('ai-' + uuid());
  await ensureSeed(repo);
});
const interpret = async (text: string, settings: AISettings = DEFAULT_AI_SETTINGS) => (await interpretText(text, await buildContext(repo, MAMA, NOW), settings)).proposals;
const counts = async () => ({ tasks: (await repo.list('tasks')).length, events: (await repo.list('events')).length, payments: (await repo.list('payments')).length, expenses: (await repo.list('expenses')).length, items: (await repo.list('shoppingItems')).length });
const ZERO = { tasks: 0, events: 0, payments: 0, expenses: 0, items: 0 };

describe('Interpretación de texto', () => {
  it('interpreta una nota de texto: evento con fecha, hora, categoría y participantes', async () => {
    const [p] = await interpret('Mañana a las 18 hay reunión de padres en el colegio de Hijo');
    expect(p.kind).toBe('evento');
    expect(p.fields.start).toBe('2026-10-12T18:00');
    expect(p.fields.category).toBe('colegio');
    expect(p.fields.participantIds).toEqual(['profile-hijo']);
    expect(p.fields.ownerId).toBe(MAMA); // un adulto como responsable, no el chico
    expect(blockingIssues(p)).toEqual([]);
  });

  it('separa varias acciones de una misma entrada en propuestas independientes', async () => {
    const ps = await interpret('Mañana a las 18 reunión de padres. Hay que comprar leche, pan y 2 kg de papas. El 20 vence la luz $45.000');
    expect(ps.map((p) => p.kind)).toEqual(['evento', 'compra', 'pago']);
    expect(ps[1].fields.items.map((i: any) => i.name)).toEqual(['Leche', 'Pan', 'Papas']);
    expect(ps[1].fields.items[2]).toMatchObject({ quantity: 2, unit: 'kg' });
    expect(ps[2].fields).toMatchObject({ concept: 'Luz', amount: 45000, currency: 'ARS', dueDate: '2026-10-20', category: 'servicios' });
    expect(new Set(ps.map((p) => p.groupId)).size).toBe(1);
  });

  it('diferencia consultas, ideas y órdenes', async () => {
    const [q] = await interpret('¿Cuándo es el acto de Hija?');
    expect(q.kind).toBe('consulta');
    expect(q.include).toBe(false);
    const [idea] = await interpret('Estaría bueno pintar el living');
    expect(idea.intent).toBe('idea');
    expect(idea.kind).toBe('nota');
    const [order] = await interpret('Papá tiene que cortar el pasto el sábado');
    expect(order).toMatchObject({ kind: 'tarea', intent: 'crear' });
    expect(order.fields).toMatchObject({ title: 'Cortar el pasto', assigneeId: 'profile-papa', dueDate: '2026-10-17', category: 'patio' });
  });

  it('detecta campos faltantes', async () => {
    const [ev] = await interpret('Reunión con la maestra de Hija');
    expect(ev.kind).toBe('evento');
    expect(ev.missing).toContain('start');
    const [gasto] = await interpret('Pagué el gas');
    expect(gasto.kind).toBe('gasto');
    expect(gasto.missing).toContain('amount');
    const [m] = await interpret('Hacer el service del aire acondicionado');
    expect(m.kind).toBe('mantenimiento');
    expect(m.missing).toContain('recurrence'); // no se inventan frecuencias técnicas
  });

  it('presenta ambigüedades y no permite confirmar hasta aclararlas', async () => {
    const [turno] = await interpret('Turno con la pediatra para Hija el 15/10 a las 5');
    expect(turno.ambiguities[0].message).toContain('17:00');
    expect(blockingIssues(turno).length).toBeGreaterThan(0);
    const fixed = resolveAmbiguity(turno, 0, '17:00');
    expect(fixed.fields.start).toBe('2026-10-15T17:00');
    expect(blockingIssues(fixed)).toEqual([]);

    const [cumple] = await interpret('Cumple de la abuela la semana que viene');
    expect(cumple.ambiguities[0].options!.length).toBe(7);
    const [alguien] = await interpret('Alguien tiene que buscar a Hija en natación el martes a las 19');
    expect(alguien.ambiguities.some((a) => a.field === 'responsible')).toBe(true);
    expect(alguien.fields.assigneeId).toBeUndefined();
    const [doble] = await interpret('Pagamos la cuota del club 15000 y la de inglés 20000');
    expect(doble.ambiguities.some((a) => a.field === 'amount')).toBe(true);
  });

  it('permite editar una propuesta (cambiar el tipo conserva los datos y recalcula faltantes)', async () => {
    const [t] = await interpret('Llevar el auto al mecánico el jueves');
    expect(t.kind).toBe('tarea');
    const ev = finalizeProposal(changeKind(t, 'evento'), (await buildContext(repo, MAMA, NOW)).existing);
    expect(ev.kind).toBe('evento');
    expect(ev.fields.title).toBe(t.fields.title);
    expect(ev.fields.start).toBe('2026-10-15');
    const edited = finalizeProposal({ ...ev, fields: { ...ev.fields, title: '' } }, (await buildContext(repo, MAMA, NOW)).existing);
    expect(edited.missing).toContain('title');
  });

  it('funciona con la interpretación automática desactivada (modo manual)', async () => {
    const ps = await interpret('Mañana reunión a las 18', { ...DEFAULT_AI_SETTINGS, mode: 'manual' });
    expect(ps).toHaveLength(1);
    expect(ps[0].kind).toBe('nota');
    expect(ps[0].processor).toBe('manual');
    expect(ps[0].fields.body).toBe('Mañana reunión a las 18');
  });
});

describe('Revisión obligatoria antes de guardar', () => {
  it('interpretar NO guarda registros; confirmar sí, y queda el historial de la decisión', async () => {
    const c = await createCapture(repo, { kind: 'texto', text: 'Mañana a las 18 reunión de padres. Hay que comprar leche. Turno dentista el 15/10 a las 5', by: MAMA });
    const processed = await processCapture(repo, c.id, { currentProfileId: MAMA, now: NOW });
    expect(processed.status).toBe('en_revision');
    expect(await counts()).toEqual(ZERO);
    await expect(confirmCapture(repo, c.id, processed.proposals, MAMA)).rejects.toThrow('Revisá antes de confirmar');
    expect(await counts()).toEqual(ZERO); // nada guardado a medias
    const props = processed.proposals.map((p) => (p.ambiguities.length ? resolveAmbiguity(p, 0, '17:00') : p));
    const saved = await confirmCapture(repo, c.id, props, MAMA);
    expect(saved.map((s) => s.entity).sort()).toEqual(['events', 'events', 'shoppingItems']);
    const done = await repo.get('captures', c.id);
    expect(done!.status).toBe('procesada');
    expect(done!.decisions.every((d) => d.action === 'creado')).toBe(true);
    expect(done!.text).toContain('reunión de padres'); // se conserva el original
    expect((await repo.list('events')).every((e) => e.origin === 'asistente')).toBe(true);
    await expect(confirmCapture(repo, c.id, props, MAMA)).rejects.toThrow('ya fue procesada');
  });

  it('cancelar no guarda nada y conserva el original', async () => {
    const c = await createCapture(repo, { kind: 'imagen', text: 'Comprar yerba', files: [{ blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), name: 'captura.png' }], by: MAMA });
    await processCapture(repo, c.id, { currentProfileId: MAMA, now: NOW, settings: { ...DEFAULT_AI_SETTINGS, ocr: false } });
    await cancelCapture(repo, c.id, MAMA);
    expect(await counts()).toEqual(ZERO);
    const after = await repo.get('captures', c.id);
    expect(after!.status).toBe('cancelada');
    expect(after!.decisions.every((d) => d.action === 'descartado')).toBe(true);
    expect(await repo.db.files.get(c.attachmentIds[0])).toBeTruthy();
  });

  it('se pueden desmarcar propuestas: solo se guarda lo elegido y lo descartado queda registrado', async () => {
    const c = await createCapture(repo, { kind: 'texto', text: 'Comprar pan. Llamar al plomero el lunes', by: MAMA });
    const p = await processCapture(repo, c.id, { currentProfileId: MAMA, now: NOW });
    const chosen = p.proposals.map((x, i) => ({ ...x, include: i === 0 }));
    await confirmCapture(repo, c.id, chosen, MAMA);
    expect((await counts()).items).toBe(1);
    expect((await counts()).tasks).toBe(0);
    expect((await repo.get('captures', c.id))!.decisions.map((d) => d.action)).toEqual(['creado', 'descartado']);
  });

  it('detecta posibles duplicados y exige decidir: vincular, actualizar o crear', async () => {
    await repo.create('events', { title: 'Reunión de padres', start: '2026-10-12T18:00', allDay: false, category: 'colegio', participantIds: [], reminders: [], rsvp: 'pendiente', syncCalendar: false, attachmentIds: [] });
    const c = await createCapture(repo, { kind: 'texto', text: 'Mañana a las 18 reunión de padres en el colegio', by: MAMA });
    const p = await processCapture(repo, c.id, { currentProfileId: MAMA, now: NOW });
    const ev = p.proposals[0];
    expect(ev.duplicates).toHaveLength(1);
    expect(blockingIssues(ev).join(' ')).toContain('duplicado');
    await confirmCapture(repo, c.id, [{ ...ev, duplicateChoice: 'vincular', duplicateTargetId: ev.duplicates[0].id }], MAMA);
    expect((await repo.list('events'))).toHaveLength(1);
    expect((await repo.get('captures', c.id))!.decisions[0].action).toBe('vinculado');
  });

  it('un gasto que corresponde a un pago pendiente lo confirma sin duplicar', async () => {
    const pay = await createPayment(repo, { concept: 'Luz', provider: 'Edenor', category: 'servicios', dueDate: '2026-10-20' });
    const c = await createCapture(repo, { kind: 'texto', text: 'Pagué la luz $45.000', by: MAMA });
    const p = await processCapture(repo, c.id, { currentProfileId: MAMA, now: NOW });
    const g = p.proposals[0];
    expect(g.kind).toBe('gasto');
    expect(g.relations[0]).toMatchObject({ entity: 'payments', id: pay.id, kind: 'marcar_pagado' });
    await confirmCapture(repo, c.id, [{ ...g, fields: { ...g.fields, markPaymentId: pay.id } }], MAMA);
    expect((await repo.get('payments', pay.id))!.status).toBe('pagado');
    expect(await repo.list('expenses')).toHaveLength(1);
  });

  it('lo importado de Gmail pasa por la misma interpretación y revisión', async () => {
    const c = await createCapture(repo, { kind: 'gmail', sourceRef: 'gmail:abc', text: 'Correo: Factura Edenor\nDe: facturas@edenor.com\n\nSu factura vence el 20/10 por $45.000', by: MAMA });
    const p = await processCapture(repo, c.id, { currentProfileId: MAMA, now: NOW });
    expect(p.proposals.some((x) => x.kind === 'pago' && x.fields.amount === 45000 && x.fields.dueDate === '2026-10-20')).toBe(true);
    expect(await counts()).toEqual(ZERO);
  });
});

describe('Capturas, documentos y audio', () => {
  it('procesa una captura de pantalla con OCR y propone los productos de la lista', async () => {
    const c = await createCapture(repo, { kind: 'imagen', files: [{ blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), name: 'lista.png' }], by: MAMA });
    const ocr = vi.fn(async () => 'Leche\nYerba\nDetergente\nPapel higiénico');
    const p = await processCapture(repo, c.id, { currentProfileId: MAMA, now: NOW, extractors: { ocr } });
    expect(ocr).toHaveBeenCalledOnce();
    expect(p.processor).toContain('OCR');
    const compra = p.proposals.find((x) => x.kind === 'compra')!;
    expect(compra.fields.items.map((i: any) => [i.name, i.category])).toEqual([['Leche', 'supermercado'], ['Yerba', 'supermercado'], ['Detergente', 'limpieza'], ['Papel higiénico', 'higiene']]);
  });

  it('con la lectura de imágenes desactivada no afirma haberla leído', async () => {
    const c = await createCapture(repo, { kind: 'imagen', files: [{ blob: new Blob([new Uint8Array([1])], { type: 'image/png' }), name: 'x.png' }], by: MAMA });
    const ocr = vi.fn(async () => 'no debería llamarse');
    const p = await processCapture(repo, c.id, { now: NOW, settings: { ...DEFAULT_AI_SETTINGS, ocr: false }, extractors: { ocr } });
    expect(ocr).not.toHaveBeenCalled();
    expect(p.processor).not.toContain('OCR');
    expect(p.extractedText).toBeUndefined();
  });

  it('un PDF se propone como documento (conservando el original) y su texto genera el pago', async () => {
    const c = await createCapture(repo, { kind: 'documento', files: [{ blob: new Blob([new TextEncoder().encode('%PDF')], { type: 'application/pdf' }), name: 'factura-agua.pdf' }], by: MAMA });
    const p = await processCapture(repo, c.id, { now: NOW, currentProfileId: MAMA, extractors: { pdf: async () => 'AySA Factura. Vencimiento 25/10/2026. Total a pagar $ 18.250,50' } });
    const doc = p.proposals.find((x) => x.kind === 'documento')!;
    expect(doc.fields).toMatchObject({ category: 'facturas', visibility: 'adultos', attachmentId: c.attachmentIds[0] });
    const pago = p.proposals.find((x) => x.kind === 'pago')!;
    expect(pago.fields).toMatchObject({ amount: 18250.5, dueDate: '2026-10-25' });
    const saved = await confirmCapture(repo, c.id, p.proposals, MAMA);
    expect(saved.map((s) => s.entity).sort()).toEqual(['documents', 'payments']);
    const d = (await repo.list('documents'))[0];
    expect(d.attachmentId).toBe(c.attachmentIds[0]);
    expect(d.extractedText).toContain('18.250,50');
  });

  it('una imagen que no se puede clasificar con certeza pregunta la categoría', async () => {
    const c = await createCapture(repo, { kind: 'documento', files: [{ blob: new Blob([new Uint8Array([9])], { type: 'image/jpeg' }), name: 'IMG_2026.jpg' }], by: MAMA });
    const p = await processCapture(repo, c.id, { now: NOW, extractors: { ocr: async () => '' } });
    const doc = p.proposals.find((x) => x.kind === 'documento')!;
    expect(doc.ambiguities[0].field).toBe('category');
    expect(blockingIssues(doc).length).toBeGreaterThan(0);
  });

  it('procesa un audio compatible con transcripción local y conserva el archivo original', async () => {
    const audio = new Blob([new Uint8Array([79, 103, 103, 83])], { type: 'audio/ogg' });
    const c = await createCapture(repo, { kind: 'audio', files: [{ blob: audio, name: 'PTT-20261011.opus' }], by: MAMA });
    const transcribe = vi.fn(async () => 'el jueves a las 20 cena en lo de la abuela');
    const p = await processCapture(repo, c.id, { now: NOW, currentProfileId: MAMA, settings: { ...DEFAULT_AI_SETTINGS, whisper: true }, extractors: { transcribe } });
    expect(transcribe).toHaveBeenCalledOnce();
    expect(p.processor).toContain('Whisper');
    expect(p.proposals[0]).toMatchObject({ kind: 'evento' });
    expect(p.proposals[0].fields.start).toBe('2026-10-15T20:00');
    const att = await repo.get('attachments', c.attachmentIds[0]);
    expect(att).toMatchObject({ mimeType: 'audio/ogg', folder: 'app/Audios' });
  });

  it('un audio sin transcripción se guarda y avisa; con dictado del navegador se interpreta el texto', async () => {
    const c = await createCapture(repo, { kind: 'audio', files: [{ blob: new Blob([new Uint8Array([1])], { type: 'audio/mp4' }), name: 'nota.m4a' }], by: MAMA });
    const p = await processCapture(repo, c.id, { now: NOW });
    expect(p.proposals).toHaveLength(1);
    expect(p.proposals[0].warnings.join(' ')).toContain('No hay texto interpretado');
    const v = await createCapture(repo, { kind: 'voz', transcript: 'hay que comprar pilas', files: [{ blob: new Blob([new Uint8Array([2])], { type: 'audio/webm' }), name: 'voz.webm' }], by: MAMA });
    const pv = await processCapture(repo, v.id, { now: NOW });
    expect(pv.proposals[0].kind).toBe('compra');
    expect(pv.proposals[0].fields.items[0].name).toBe('Pilas');
  });

  it.skipIf(!process.env.REAL_OCR)('OCR real (Tesseract.js) sobre una imagen de lista', async () => {
    const { ocrImage } = await import('../src/ai/processors');
    const png = readFileSync(path.join(__dirname, 'fixtures/lista-compras.png'));
    const text = await ocrImage(png as any); // en Node, Tesseract recibe un Buffer; en el navegador, un Blob
    expect(text.toLowerCase()).toContain('leche');
    expect(text.toLowerCase()).toContain('detergente');
  }, 180_000);
});

describe('Modelo local opcional', () => {
  it('mapea la respuesta del modelo sin aceptar fechas o personas inválidas', async () => {
    const ctx = await buildContext(repo, MAMA, NOW);
    const ps: Proposal[] = mapLLMItems({ items: [
      { kind: 'evento', text: 'cena el jueves', title: 'Cena familiar', date: '2026-10-15', time: '21:00', people: ['profile-papa', 'inventado'] },
      { kind: 'pago', text: 'pagar luz', title: 'Luz', date: '2026-02-31', amount: -5, questions: ['¿Cuánto es?'] },
      { kind: 'hackear', text: 'x' },
    ] }, ctx);
    expect(ps).toHaveLength(2);
    expect(ps[0].fields.start).toBe('2026-10-15T21:00');
    expect(ps[0].fields.participantIds).toEqual(['profile-papa']);
    expect(ps[1].fields.dueDate).toBeUndefined();
    expect(ps[1].fields.amount).toBeUndefined();
    expect(ps[1].ambiguities[0].message).toBe('¿Cuánto es?');
  });
  it('si el modelo local no responde, usa las reglas locales y lo informa', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await interpretText('Hay que comprar yerba', await buildContext(repo, MAMA, NOW), { ...DEFAULT_AI_SETTINGS, llm: { enabled: true, endpoint: 'http://localhost:11434/v1/chat/completions', model: 'x' } });
    expect(r.processor).toBe('reglas locales');
    expect(r.notes[0]).toContain('no respondió');
    expect(r.proposals[0].kind).toBe('compra');
    spy.mockRestore();
  });
});

describe('dictado por voz: sin palabras repetidas', () => {
  it('Chrome en Android manda la frase acumulada varias veces: queda una sola vez', async () => {
    const { mergeSpeechResults } = await import('../src/ai/processors');
    expect(mergeSpeechResults([
      { transcript: 'comprar', isFinal: true }, { transcript: 'comprar banana', isFinal: true }, { transcript: 'comprar banana', isFinal: true },
    ]).final).toBe('comprar banana');
    expect(mergeSpeechResults([{ transcript: 'comprar', isFinal: true }, { transcript: 'comprar banana', isFinal: false }])).toEqual({ final: 'comprar', interim: 'banana' });
  });
  it('en computadora (frases separadas) se juntan en orden', async () => {
    const { mergeSpeechResults } = await import('../src/ai/processors');
    expect(mergeSpeechResults([{ transcript: 'comprar banana', isFinal: true }, { transcript: ' y leche', isFinal: true }]).final).toBe('comprar banana y leche');
  });
});
