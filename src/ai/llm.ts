// Interpretación opcional con un modelo de lenguaje LOCAL compatible con la API de OpenAI (por ejemplo Ollama en la
// computadora de la casa). No usa claves privadas ni servicios pagos. Si falla, se usan las reglas locales.
// Sus resultados pasan por las mismas validaciones, ambigüedades y revisión obligatoria que las reglas.
import type { InterpretContext, Proposal, ProposalKind } from './types';
import { base } from './rules';
import { isValidISODate, isValidISODateTime, toISODate } from '../domain/dates';

const KINDS: ProposalKind[] = ['evento', 'tarea', 'compra', 'pago', 'gasto', 'reparacion', 'mantenimiento', 'nota', 'consulta'];

export function buildPrompt(text: string, ctx: InterpretContext) {
  const people = ctx.profiles.map((p) => `${p.id}=${p.name}`).join(', ');
  return `Hoy es ${toISODate(ctx.now)}. Integrantes: ${people}.
Separá el texto en acciones independientes y devolvé SOLO JSON: {"items":[{"kind":"evento|tarea|compra|pago|gasto|reparacion|mantenimiento|nota|consulta","text":"fragmento original","title":"","date":"YYYY-MM-DD o null","time":"HH:mm o null","amount":número o null,"currency":"ARS|USD","people":["id"],"responsible":"id o null","products":[{"name":"","quantity":null,"unit":null}],"questions":["dato ambiguo a preguntar"]}]}
No inventes fechas, importes ni personas: si no están, usá null y agregá una pregunta. Diferenciá ideas y consultas de órdenes.
Texto:
"""${text.slice(0, 6000)}"""`;
}

export async function llmInterpret(text: string, ctx: InterpretContext, cfg: { endpoint: string; model: string }, timeoutMs = 60000): Promise<Proposal[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: buildPrompt(text, ctx) }] }),
    });
    if (!res.ok) throw new Error(`El modelo local respondió ${res.status}`);
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? '';
    return mapLLMItems(JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)), ctx);
  } finally {
    clearTimeout(timer);
  }
}

export function mapLLMItems(parsed: any, ctx: InterpretContext): Proposal[] {
  const items: any[] = Array.isArray(parsed?.items) ? parsed.items : [];
  const valid = (id: any) => ctx.profiles.some((p) => p.id === id);
  return items.filter((it) => KINDS.includes(it.kind)).map((it) => {
    const date = isValidISODate(it.date) ? it.date : undefined;
    const time = typeof it.time === 'string' && /^\d{2}:\d{2}$/.test(it.time) ? it.time : undefined;
    const amount = typeof it.amount === 'number' && it.amount > 0 ? it.amount : undefined;
    const people = (it.people ?? []).filter(valid);
    const resp = valid(it.responsible) ? it.responsible : undefined;
    const title = String(it.title || it.text || '').slice(0, 120);
    const kind = it.kind as ProposalKind;
    const fields: Record<string, any> =
      kind === 'evento' ? { title, start: date ? (time ? `${date}T${time}` : date) : undefined, allDay: !!date && !time, category: 'otros', participantIds: people, ownerId: resp, reminders: [], recurrence: null }
      : kind === 'tarea' ? { title, dueDate: date, dueTime: time, assigneeId: resp, collaboratorIds: people.filter((p: string) => p !== resp), category: 'otras', priority: 'media', recurrence: null }
      : kind === 'compra' ? { items: (it.products ?? []).map((p: any) => ({ name: String(p.name ?? ''), quantity: typeof p.quantity === 'number' ? p.quantity : undefined, unit: p.unit ?? undefined, category: 'supermercado', include: true })) }
      : kind === 'pago' ? { concept: title, amount, currency: it.currency === 'USD' ? 'USD' : 'ARS', dueDate: date, category: 'otros', responsibleId: resp, recurrence: null }
      : kind === 'gasto' ? { concept: title, amount, currency: it.currency === 'USD' ? 'USD' : 'ARS', date: date ?? toISODate(ctx.now), category: 'otros', responsibleId: resp, extraordinary: false }
      : kind === 'reparacion' ? { title, description: it.text, createTask: true, taskAssigneeId: resp }
      : kind === 'mantenimiento' ? { title, category: 'preventivo', recurrence: null, assigneeId: resp }
      : { title, body: it.text };
    const p = base(kind, kind === 'consulta' ? 'consulta' : 'crear', String(it.text ?? title), fields, null);
    p.processor = 'modelo local';
    p.ambiguities = (it.questions ?? []).filter((q: any) => typeof q === 'string' && q.trim()).map((q: string) => ({ field: 'llm', message: q }));
    if (kind === 'consulta') p.include = false;
    if (kind === 'evento' && fields.start && !(isValidISODate(fields.start) || isValidISODateTime(fields.start))) fields.start = undefined;
    return p;
  });
}
