// Piezas compartidas por los módulos: historial de cambios, adjuntos y selección de archivos.
import { useRef, useState } from 'react';
import { Paperclip, Download, ExternalLink, FileText, Image as ImageIcon, Music, Trash2 } from 'lucide-react';
import { useApp, useLive } from '../app/context';
import type { EntityName, ID } from '../domain/types';
import { formatDateTimeHuman } from '../domain/dates';
import { humanSize, storeFile, type DriveFolder } from '../services/files';

const FIELD_NAMES: Record<string, string> = {
  title: 'Título', status: 'Estado', dueDate: 'Fecha', assigneeId: 'Responsable', priority: 'Prioridad', category: 'Categoría', amount: 'Importe',
  start: 'Inicio', end: 'Fin', location: 'Lugar', concept: 'Concepto', paidDate: 'Fecha de pago', name: 'Nombre', quantity: 'Cantidad',
  deleted: 'Eliminado', notes: 'Notas', description: 'Descripción', recurrence: 'Repetición', visibility: 'Visibilidad', cost: 'Costo',
};
const ACTION: Record<string, string> = { crear: 'Creado', editar: 'Editado', eliminar: 'Eliminado', restaurar: 'Restaurado', completar: 'Completado', conflicto: 'Conflicto resuelto', sync: 'Sincronizado' };

function short(v: any): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'object') return Array.isArray(v) ? `${v.length} elemento(s)` : 'modificado';
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

export function HistoryList({ entity, recordId }: { entity: EntityName; recordId: ID }) {
  const { profiles } = useApp();
  const rows = useLive((repo) => repo.db.entity('history').where('recordId').equals(recordId).filter((h) => h.entity === entity).toArray(), [entity, recordId], []);
  if (!rows.length) return <p className="muted small">Sin cambios registrados.</p>;
  return (
    <ul className="list stack-sm small">
      {rows.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30).map((h) => (
        <li key={h.id}>
          <span className="strong">{ACTION[h.action] ?? h.action}</span>
          <span className="muted"> · {formatDateTimeHuman(h.at)}{h.by ? ` · ${profiles.find((p) => p.id === h.by)?.name ?? ''}` : ''}</span>
          {h.changes && Object.keys(h.changes).length > 0 && (
            <div className="muted tiny">
              {Object.entries(h.changes).filter(([k]) => FIELD_NAMES[k] || k === 'resolucion').slice(0, 5).map(([k, [a, b]]) => (
                <div key={k}>{FIELD_NAMES[k] ?? k}: {short(a)} → {short(b)}</div>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function FilePickButton({ onFiles, accept, label, capture, multiple = true }: { onFiles: (f: File[]) => void; accept?: string; label: string; capture?: 'environment' | 'user'; multiple?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => ref.current?.click()}><Paperclip size={16} /> {label}</button>
      <input ref={ref} type="file" hidden accept={accept} multiple={multiple} capture={capture} onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) onFiles(fs); }} />
    </>
  );
}

export function iconFor(mime: string) { return mime.startsWith('image/') ? ImageIcon : mime.startsWith('audio/') ? Music : FileText; }

export function useOpenAttachment() {
  const { repo, sync, backend, run, toast } = useApp();
  return async (id: ID) => {
    const att = await repo.get('attachments', id);
    if (!att) return;
    let blob = (await repo.db.files.get(id))?.blob;
    if (!blob) {
      if (att.driveUrl && !backend) { window.open(att.driveUrl, '_blank', 'noopener'); return; }
      if (!backend || !navigator.onLine) { toast('Este archivo no está guardado en este dispositivo y no hay conexión con Google.', { tone: 'error' }); return; }
      blob = await run(() => sync.downloadFile(att));
      if (!blob) return;
    }
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
}

/** Lista de adjuntos con estado (en el dispositivo / en Drive) y acciones. */
export function AttachmentList({ ids, onChange, folder = 'documentos/Familia', editable = true }: { ids: ID[]; onChange?: (ids: ID[]) => void; folder?: DriveFolder; editable?: boolean }) {
  const { repo, profile, run, backend, sync } = useApp();
  const atts = useLive(async (r) => Promise.all(ids.map(async (id) => ({ att: await r.get('attachments', id), local: !!(await r.db.files.get(id)) }))), [ids.join(',')], []);
  const open = useOpenAttachment();
  const [busy, setBusy] = useState(false);
  const add = async (files: File[]) => {
    setBusy(true);
    const added: ID[] = [];
    for (const f of files) {
      const res = await run(() => storeFile(repo, f, f.name, folder, profile?.id));
      if (res) added.push(res.attachment.id);
    }
    setBusy(false);
    if (added.length) onChange?.([...ids, ...added.filter((a) => !ids.includes(a))]);
  };
  return (
    <div className="stack-sm">
      {atts.filter((x) => x.att).map(({ att, local }) => {
        const I = iconFor(att!.mimeType);
        return (
          <div key={att!.id} className="row small">
            <I size={18} className="muted" />
            <button type="button" className="link-btn truncate" style={{ textAlign: 'left', flex: 1 }} onClick={() => open(att!.id)}>{att!.name}</button>
            <span className="muted tiny">{humanSize(att!.size)} · {local ? 'en el dispositivo' : 'solo en Drive'}{att!.uploadStatus === 'uploaded' ? ' · en Drive' : backend ? ' · pendiente de subir' : ''}</span>
            {!local && att!.driveFileId && backend && <button type="button" className="icon-btn" aria-label="Guardar para usar sin conexión" onClick={() => run(() => sync.downloadFile(att!), 'Disponible sin conexión')}><Download size={16} /></button>}
            {att!.driveUrl && <a className="icon-btn" href={att!.driveUrl} target="_blank" rel="noopener noreferrer" aria-label="Abrir en Google Drive"><ExternalLink size={16} /></a>}
            {editable && onChange && <button type="button" className="icon-btn" aria-label={`Quitar ${att!.name}`} onClick={() => onChange(ids.filter((x) => x !== att!.id))}><Trash2 size={16} /></button>}
          </div>
        );
      })}
      {editable && onChange && <FilePickButton onFiles={add} label={busy ? 'Guardando…' : 'Adjuntar archivo'} accept="image/*,application/pdf,audio/*,.ogg,.opus,.m4a,.doc,.docx,.xls,.xlsx,.txt" />}
    </div>
  );
}
