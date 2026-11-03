// Lectura con IA (Gemini, vía el backend de la familia): convierte su respuesta en propuestas para revisar.
// La clave nunca está en la app; si la IA no está activada o falla, se usan las reglas locales de siempre.
import type { InterpretContext, Proposal } from './types';
import { base, guessShopCategory } from './rules';

export interface VisionItem {
  type: 'evento' | 'tarea' | 'compra' | 'pago' | 'nota'; title: string; date?: string; time?: string; endTime?: string; location?: string;
  personIds?: string[]; personSure?: boolean; category?: string; notes?: string; amount?: number; currency?: string; products?: string[]; doubt?: string;
}
export interface VisionResult { items: VisionItem[]; summary?: string; model?: string }

const EVENT_CATS = ['colegio', 'actividades', 'turnos', 'salud', 'cumpleanos', 'tramites', 'reuniones', 'familia', 'otros'];
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s?: string) => !!s && /^\d{2}:\d{2}$/.test(s);

/** Achica una imagen (máx. 1600 px, JPEG) para mandarla: más rápido y dentro de los límites gratuitos. */
export async function imageForVision(blob: Blob, max = 1600): Promise<{ mime: string; base64: string }> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const url = c.toDataURL('image/jpeg', 0.85);
  return { mime: 'image/jpeg', base64: url.slice(url.indexOf(',') + 1) };
}

/** Un PDF se manda tal cual (Gemini lee PDF). Límite de 8 MB para no pasar los topes del backend. */
export async function pdfForVision(blob: Blob): Promise<{ mime: string; base64: string }> {
  if (blob.size > 8 * 1024 * 1024) throw new Error('El PDF es muy grande para la IA (máx. 8 MB).');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mime: 'application/pdf', base64: btoa(bin) };
}

export function visionContext(ctx: InterpretContext) {
  const cur = ctx.profiles.find((p) => p.id === ctx.currentProfileId);
  return {
    today: `${ctx.now.getFullYear()}-${String(ctx.now.getMonth() + 1).padStart(2, '0')}-${String(ctx.now.getDate()).padStart(2, '0')}`,
    currentProfileId: ctx.currentProfileId, currentName: cur?.name,
    profiles: ctx.profiles.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, role: p.role, aliases: p.aliases, school: p.school })),
  };
}

export function proposalsFromVision(res: VisionResult, ctx: InterpretContext, sourceText: string): Proposal[] {
  const valid = new Set(ctx.profiles.filter((p) => p.active && p.role !== 'family').map((p) => p.id));
  const who = ctx.profiles.filter((p) => p.active && p.role !== 'family').map((p) => ({ label: p.name, value: p.id }));
  const out: Proposal[] = [];
  for (const it of res.items ?? []) {
    const title = (it.title ?? '').trim();
    if (!title) continue;
    const people = (it.personIds ?? []).filter((id) => valid.has(id));
    const date = isDate(it.date) ? it.date : undefined;
    const time = isTime(it.time) ? it.time : undefined;
    const src = [title, it.date, it.time, it.location, it.notes].filter(Boolean).join(' · ') || sourceText.slice(0, 200);
    let p: Proposal;
    if (it.type === 'evento') {
      const category = EVENT_CATS.includes(it.category ?? '') ? it.category! : 'otros';
      p = base('evento', 'crear', src, {
        title, start: date ? (time ? `${date}T${time}` : date) : undefined, end: date && time && isTime(it.endTime) ? `${date}T${it.endTime}` : undefined,
        allDay: !!date && !time, category, participantIds: people, ownerId: people[0] ?? ctx.currentProfileId,
        reminders: category === 'turnos' || category === 'cumpleanos' || category === 'colegio' ? [24 * 60, 60] : [60], recurrence: null,
        location: it.location || undefined, description: it.notes ?? '', syncCalendar: false,
      }, 0.9);
      if (!date) p.missing.push('start');
      // De quién es: se pregunta si la IA no está segura, o si un turno es de otra persona distinta de quien lo carga.
      const otherThanCurrent = people.length === 1 && people[0] !== ctx.currentProfileId;
      if (!it.personSure || !people.length || (category === 'turnos' && otherThanCurrent)) {
        p.ambiguities.push({ field: 'participants', message: category === 'turnos' ? '¿De quién es este turno?' : '¿Para quién es?', options: who });
      }
    } else if (it.type === 'tarea') {
      p = base('tarea', 'crear', src, { title, dueDate: date, dueTime: time, assigneeId: people[0] ?? ctx.currentProfileId, collaboratorIds: people.slice(1), category: 'otras', priority: 'media', recurrence: null, description: it.notes ?? '' }, 0.85);
    } else if (it.type === 'compra') {
      const products = (it.products?.length ? it.products : [title]).map((n) => n.trim()).filter(Boolean);
      p = base('compra', 'crear', src, { items: products.map((name) => ({ name, include: true, category: guessShopCategory(name) })), listId: undefined }, 0.85);
    } else if (it.type === 'pago') {
      p = base('pago', 'crear', src, { concept: title, amount: it.amount, currency: it.currency || 'ARS', dueDate: date, category: 'otros', responsibleId: ctx.currentProfileId, recurrence: null }, 0.8);
      if (it.amount == null) p.missing.push('amount');
    } else {
      p = base('nota', 'informacion', src, { title, body: it.notes ?? '', personIds: people }, 0.7);
    }
    if (it.doubt) p.warnings.push(it.doubt);
    p.processor = `IA (${res.model ?? 'Gemini'})`;
    out.push(p);
  }
  return out;
}
