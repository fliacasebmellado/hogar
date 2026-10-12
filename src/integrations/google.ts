// Cliente de las acciones del backend Apps Script e importaciones que pasan por la revisión del asistente.
import type { Repo } from '../db/repo';
import type { Transport } from '../sync/transport';
import { createCapture } from '../ai/pipeline';
import { base } from '../ai/rules';
import { finalizeProposal } from '../ai/finalize';
import { buildExistingIndex } from '../ai/pipeline';
import { base64ToBlob } from '../services/files';
import type { ID } from '../domain/types';
import { nowISO } from '../domain/dates';

export interface BackendStatus {
  schemaVersion: number; spreadsheetUrl: string; rootFolderUrl: string; rev: number; restoreEpoch: string;
  sheets: { ok: boolean; created: string[]; extended: string[]; incompatible: string[] };
  books?: Record<string, { title: string; url: string }>; folders?: Record<string, { name: string; url: string }>;
  lastBackup: BackupInfo | null; triggers: string[]; gmailEnabled: boolean; calendarId: string; calendarAuto: boolean; owner: string;
}
export interface BackupInfo { fileId: string; name: string; createdAt: string; kind: string; records: number; valid: boolean; note: string }
export interface GmailSummary { id: string; threadId: string; subject: string; from: string; date: string; snippet: string; attachments: number }
export interface CalendarReport {
  created: { id: string; title: string }[]; updatedInGoogle: { id: string; title: string }[];
  updatedFromGoogle: { id: string; title: string; changes: Record<string, [string, string]> }[];
  conflicts: { id: string; title: string; google: Record<string, string>; googleUpdated: string }[]; deletedInGoogle: { id: string; title: string }[];
  deletedFromApp: { id: string; title: string }[]; external: ExternalEvent[]; errors: { id: string; title: string; error: string }[];
}
export interface ExternalEvent { googleEventId: string; title: string; location: string; description: string; allDay: boolean; start: string; end: string }

export const api = {
  ping: (t: Transport) => t.call<{ pong: boolean; schemaVersion: number; time: string }>('ping'),
  setup: (t: Transport) => t.call<{ spreadsheetUrl: string; rootFolderUrl: string; sheets: BackendStatus['sheets'] }>('setup'),
  status: (t: Transport) => t.call<BackendStatus>('status'),
  runBackup: (t: Transport) => t.call<BackupInfo & { problems: string[] }>('runBackup'),
  listBackups: (t: Transport) => t.call<BackupInfo[]>('listBackups'),
  getBackup: (t: Transport, fileId: string) => t.call<any>('getBackup', { fileId }),
  restoreBackup: (t: Transport, fileId: string) => t.call<{ restored: number; preRestoreBackup: string }>('restoreBackup', { fileId }),
  calendarSync: (t: Transport) => t.call<CalendarReport>('calendarSync'),
  calendarList: (t: Transport) => t.call<{ id: string; name: string }[]>('calendarList'),
  setOption: (t: Transport, key: string, value: string | null) => t.call('setOption', { key, value }),
  gmailSearch: (t: Transport, query: string, max = 10) => t.call<GmailSummary[]>('gmailSearch', { query, max }),
  gmailGet: (t: Transport, id: string) => t.call<{ id: string; subject: string; from: string; date: string; body: string; attachments: { index: number; name: string; mimeType: string; size: number }[] }>('gmailGet', { id }),
  gmailAttachment: (t: Transport, id: string, index: number) => t.call<{ name: string; mimeType: string; base64: string }>('gmailAttachment', { id, index }),
  formsPending: (t: Transport) => t.call<{ key: string; form: string; submittedAt: string; answers: Record<string, string> }[]>('formsPending'),
  formsAck: (t: Transport, keys: string[]) => t.call<{ acknowledged: number }>('formsAck', { keys }),
};

/** Importa SOLO los correos elegidos por la persona; cada uno se convierte en una captura para revisar. */
export async function importGmailMessages(repo: Repo, t: Transport, ids: string[], by?: ID, withAttachments = true): Promise<ID[]> {
  const out: ID[] = [];
  for (const id of ids) {
    const m = await api.gmailGet(t, id);
    const files: { blob: Blob; name: string }[] = [];
    if (withAttachments) {
      for (const a of m.attachments.filter((x) => /^(application\/pdf|image\/)/.test(x.mimeType) && x.size < 10 * 1024 * 1024).slice(0, 3)) {
        const att = await api.gmailAttachment(t, id, a.index);
        files.push({ blob: base64ToBlob(att.base64, att.mimeType), name: att.name });
      }
    }
    const c = await createCapture(repo, {
      kind: 'gmail', by, sourceRef: `gmail:${id}`, files,
      text: `Correo: ${m.subject}\nDe: ${m.from}\nFecha: ${m.date.slice(0, 10)}\n\n${m.body.slice(0, 8000)}`,
    });
    out.push(c.id);
  }
  return out;
}

/** Trae respuestas nuevas de formularios vinculados a la planilla y las deja como capturas para revisar. */
export async function importFormResponses(repo: Repo, t: Transport, by?: ID): Promise<number> {
  const pending = await api.formsPending(t);
  const done: string[] = [];
  for (const r of pending) {
    const text = [`Formulario: ${r.form}`, `Enviado: ${r.submittedAt.slice(0, 16).replace('T', ' ')}`, ...Object.entries(r.answers).map(([k, v]) => `${k}: ${v}`)].join('\n');
    await createCapture(repo, { kind: 'forms', text, by, sourceRef: `forms:${r.key}` });
    done.push(r.key);
  }
  if (done.length) await api.formsAck(t, done); // se marca como importado solo después de guardarlo localmente
  return done.length;
}

/** Eventos de Google Calendar que no creó la app: se proponen (no se importan automáticamente). */
export async function proposeExternalEvents(repo: Repo, events: ExternalEvent[], by?: ID): Promise<number> {
  const existing = await buildExistingIndex(repo);
  const captures = await repo.list('captures');
  const linked = new Set((await repo.list('events')).map((e) => e.googleEventId).filter(Boolean));
  let n = 0;
  for (const ev of events) {
    const ref = `gcal:${ev.googleEventId}`;
    if (linked.has(ev.googleEventId) || captures.some((c) => c.sourceRef === ref)) continue;
    const p = base('evento', 'informacion', `${ev.title} · ${ev.start.replace('T', ' ')}${ev.location ? ` · ${ev.location}` : ''}`, {
      title: ev.title, start: ev.allDay ? ev.start.slice(0, 10) : ev.start, end: ev.end || undefined, allDay: ev.allDay, location: ev.location,
      description: ev.description, category: 'otros', participantIds: [], reminders: [], recurrence: null, syncCalendar: false, googleEventId: ev.googleEventId,
    }, null);
    p.processor = 'Google Calendar';
    p.warnings.push('Evento existente en Google Calendar. Si lo importás, queda en la agenda de la app (no se duplica en Google).');
    await repo.create('captures', {
      kind: 'calendar', text: p.sourceText, attachmentIds: [], status: 'en_revision', proposals: [finalizeProposal(p, existing)], decisions: [],
      sourceRef: ref, createdBy: by, processor: 'Google Calendar', processedAt: nowISO(),
    }, { by, origin: 'google_calendar' });
    n++;
  }
  return n;
}
