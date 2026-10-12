import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, FileText, Lock, ExternalLink, Download, ScanText } from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import type { Attachment, DocumentRecord } from '../../domain/types';
import { CategoryChip, ChipFilter, Empty, StatusChip, Banner } from '../../ui/components';
import { Sheet, ConfirmSheet } from '../../ui/Sheet';
import { CategorySelect, DateField, PersonSelect, SelectField, TextArea, TextField } from '../../ui/fields';
import { FilePickButton, HistoryList, iconFor, useOpenAttachment } from '../../ui/records';
import { addDocument, extractPdfText, relocateDocumentFile, searchDocuments } from '../../services/documents';
import { folderLabel } from '../../services/folders';
import { humanSize } from '../../services/files';
import { SENSITIVE_DOC_CATEGORIES, VISIBILITY_LABEL, ENTITY_LABEL } from '../../domain/catalog';
import { formatDate, today } from '../../domain/dates';
import { ocrImage } from '../../ai/processors';

export default function Documents() {
  const { profile, profiles, categories, permissions } = useApp();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState('');
  const [cat, setCat] = useState('');
  const [person, setPerson] = useState('');
  const [editing, setEditing] = useState<DocumentRecord | null | undefined>(undefined);
  const docs = useLive((r) => r.list('documents'), [], [] as DocumentRecord[]);
  useEffect(() => { const id = params.get('id'); if (id && docs.length) { const d = docs.find((x) => x.id === id); if (d) setEditing(d); } }, [params, docs.length]);
  const list = useMemo(() => searchDocuments(docs, profile, { text, category: cat || undefined, personId: person || undefined }, permissions), [docs, profile, text, cat, person, permissions]);
  const hidden = docs.filter((d) => !d.deleted).length - searchDocuments(docs, profile, {}, permissions).length;
  const close = () => { setEditing(undefined); if (params.get('id')) setParams({}, { replace: true }); };
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="input" placeholder="Buscar por nombre, etiqueta o texto" aria-label="Buscar documentos" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-primary" onClick={() => setEditing(null)}><Plus size={18} /> Cargar</button>
      </div>
      <div className="stack-sm" style={{ marginBottom: 10 }}>
        <ChipFilter label="Categoría" value={cat} onChange={setCat} options={categories('documents').map((c) => ({ value: c.id, label: c.label }))} />
        <ChipFilter label="Persona" value={person} onChange={setPerson} options={profiles.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }))} />
      </div>
      {hidden > 0 && <p className="muted small" style={{ marginBottom: 8 }}><Lock size={12} /> {hidden} documento(s) privado(s) no se muestran para el perfil {profile?.name}.</p>}
      {list.length === 0 ? <div className="card"><Empty icon={<FileText size={36} />} title={docs.length ? 'No hay documentos con estos filtros.' : 'Todavía no hay documentos. Cargá facturas, garantías, manuales, documentación del colegio…'} /></div> : (
        <div className="card"><ul className="list">
          {list.map((d) => (
            <li key={d.id}>
              <button className="item" onClick={() => setEditing(d)}>
                <FileText size={20} className="muted" />
                <div className="item-main">
                  <div className="item-title">{d.name}</div>
                  <div className="item-sub">
                    <CategoryChip id={d.category} categories={categories('documents')} />
                    {d.date && <span>{formatDate(d.date, { year: true })}</span>}
                    {d.personId && <span>{profiles.find((p) => p.id === d.personId)?.name}</span>}
                    {(d.tags ?? []).slice(0, 3).map((t) => <span key={t} className="chip chip-outline">{t}</span>)}
                  </div>
                </div>
                {d.visibility !== 'familia' && <span title={VISIBILITY_LABEL[d.visibility]}><Lock size={14} aria-label={VISIBILITY_LABEL[d.visibility]} /></span>}
              </button>
            </li>
          ))}
        </ul></div>
      )}
      <DocumentSheet open={editing !== undefined} doc={editing ?? null} onClose={close} />
    </div>
  );
}

export function DocumentSheet({ open, doc, onClose }: { open: boolean; doc: DocumentRecord | null; onClose: () => void }) {
  const { repo, profile, profiles, categories, run, backend, sync, ai, can } = useApp();
  const [d, setD] = useState<Partial<DocumentRecord>>({});
  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState('');
  const [errs, setErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [del, setDel] = useState(false);
  const att = useLive(async (r) => (doc?.attachmentId ? { a: await r.get('attachments', doc.attachmentId), local: !!(await r.db.files.get(doc.attachmentId)) } : null), [doc?.attachmentId], null as null | { a?: Attachment; local: boolean });
  const open_ = useOpenAttachment();
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setD(doc ? { ...doc } : { name: '', category: 'otros', date: today(), visibility: 'familia', tags: [], ownerId: profile?.id });
    setTags((doc?.tags ?? []).join(', ')); setFile(null); setErrs([]); setBusy('');
  }, [open, doc?.id]);
  useEffect(() => {
    let url: string | null = null;
    (async () => {
      if (!doc?.attachmentId || !att?.local || !att.a?.mimeType.startsWith('image/')) { setPreview(null); return; }
      const blob = (await repo.db.files.get(doc.attachmentId))?.blob;
      if (blob) { url = URL.createObjectURL(blob); setPreview(url); }
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [doc?.attachmentId, att?.local]);

  const setCategory = (c: string) => setD((x) => ({ ...x, category: c, visibility: x.visibility === 'personal' ? 'personal' : SENSITIVE_DOC_CATEGORIES.includes(c) ? 'adultos' : x.visibility }));
  const save = async () => {
    const e: string[] = [];
    if (!d.name?.trim()) e.push('Falta el nombre.');
    if (!doc && !file) e.push('Elegí el archivo original.');
    setErrs(e);
    if (e.length) return;
    const data = { ...d, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) } as any;
    delete data.id; delete data.version; delete data.createdAt; delete data.updatedAt; delete data.rev; delete data._sync;
    const ok = await run(async () => {
      if (!doc) return addDocument(repo, { ...data, file: file!, fileName: file!.name }, profile?.id);
      const r = await repo.update('documents', doc.id, data, { by: profile?.id });
      await relocateDocumentFile(repo, doc.id, profile?.id); // si cambió la persona o la categoría, el archivo cambia de carpeta en Drive
      return r;
    }, doc ? 'Documento actualizado' : 'Documento guardado (archivo original conservado)');
    if (ok) onClose();
  };
  const extract = async () => {
    if (!doc?.attachmentId) return;
    const blob = (await repo.db.files.get(doc.attachmentId))?.blob;
    if (!blob) { run(async () => { throw new Error('Descargá primero el archivo a este dispositivo.'); }); return; }
    const txt = await run(async () => {
      if (blob.type === 'application/pdf') { setBusy('Extrayendo texto del PDF…'); return extractPdfText(blob); }
      if (blob.type.startsWith('image/')) { if (!ai.ocr) throw new Error('La lectura de imágenes (OCR) está desactivada en Ajustes → Asistente.'); return ocrImage(blob, setBusy); }
      throw new Error('Solo se puede extraer texto de PDF o imágenes.');
    });
    setBusy('');
    if (txt !== undefined) {
      if (!txt.trim()) { run(async () => { throw new Error('No se encontró texto legible. El documento quedó igual.'); }); return; }
      await run(() => repo.update('documents', doc.id, { extractedText: txt.slice(0, 20000) }, { by: profile?.id }), 'Texto extraído para búsquedas');
      setD((x) => ({ ...x, extractedText: txt.slice(0, 20000) }));
    }
  };
  const canPrivate = can('documents.private');
  return (
    <>
      <Sheet open={open} onClose={onClose} title={doc ? 'Documento' : 'Cargar documento'} wide
        footer={<>{doc && <button className="btn btn-danger" onClick={() => setDel(true)}>Eliminar</button>}<span className="spacer" /><button className="btn btn-primary" onClick={save}>{doc ? 'Guardar' : 'Guardar documento'}</button></>}>
        <div className="form">
          {errs.length > 0 && <div className="banner banner-alert" role="alert">{errs.join(' ')}</div>}
          {!doc && (
            <div className="field">
              <span className="field-label">Archivo original *</span>
              <div className="row-wrap">
                <FilePickButton multiple={false} label={file ? 'Cambiar archivo' : 'Elegir archivo'} accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt" onFiles={([f]) => { setFile(f); if (!d.name) setD((x) => ({ ...x, name: f.name.replace(/\.[^.]+$/, '') })); }} />
                <FilePickButton multiple={false} label="Sacar foto" accept="image/*" capture="environment" onFiles={([f]) => { setFile(f); if (!d.name) setD((x) => ({ ...x, name: `Foto ${today()}` })); }} />
              </div>
              {file && <span className="hint">{file.name} · {humanSize(file.size)}</span>}
            </div>
          )}
          {doc && att?.a && (
            <div className="card card-pad stack-sm">
              {preview && <img src={preview} alt={`Vista previa de ${doc.name}`} className="doc-preview" />}
              <div className="row-wrap small">
                {(() => { const I = iconFor(att.a.mimeType); return <I size={18} />; })()}
                <span className="strong">{att.a.name}</span><span className="muted">{humanSize(att.a.size)}</span>
                <StatusChip tone={att.local ? 'ok' : 'neutral'}>{att.local ? 'En este dispositivo' : 'Solo en Drive'}</StatusChip>
                {backend && <StatusChip tone={att.a.uploadStatus === 'uploaded' ? 'ok' : att.a.uploadStatus === 'error' ? 'alert' : 'warn'}>{att.a.uploadStatus === 'uploaded' ? 'En Drive' : att.a.uploadStatus === 'error' ? 'Error al subir' : 'Pendiente de subir'}</StatusChip>}
              </div>
              <div className="row-wrap">
                <button className="btn btn-sm" onClick={() => open_(att.a!.id)}>Abrir original</button>
                {att.a.driveUrl && <a className="btn btn-sm" href={att.a.driveUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Ver en Drive</a>}
                {!att.local && att.a.driveFileId && backend && <button className="btn btn-sm" onClick={() => run(() => sync.downloadFile(att.a!), 'Disponible sin conexión')}><Download size={14} /> Guardar sin conexión</button>}
                {att.local && (att.a.mimeType === 'application/pdf' || att.a.mimeType.startsWith('image/')) && <button className="btn btn-sm" onClick={extract} disabled={!!busy}><ScanText size={14} /> {busy || 'Extraer texto'}</button>}
              </div>
              <p className="tiny muted">Carpeta en Drive: <strong>{folderLabel(att.a.folder)}</strong>{att.a.driveFileId ? '' : ' (se sube al sincronizar)'}</p>
            </div>
          )}
          <TextField label="Nombre" required value={d.name} onChange={(v) => setD({ ...d, name: v })} />
          <div className="form-row">
            <CategorySelect value={d.category} onChange={setCategory} categories={categories('documents')} required />
            <DateField label="Fecha" value={d.date} onChange={(v) => setD({ ...d, date: v })} />
          </div>
          <div className="form-row">
            <DateField label="Vence (DNI, pasaporte, credencial…)" value={d.expiresAt} onChange={(v) => setD({ ...d, expiresAt: v })} />
            <span className="hint" style={{ alignSelf: 'end' }}>Te avisamos 60 días antes.</span>
          </div>
          <div className="form-row">
            <PersonSelect label="Persona relacionada" value={d.personId} onChange={(v) => setD({ ...d, personId: v })} profiles={profiles} />
            <SelectField label="Quién puede verlo" value={d.visibility} onChange={(v) => setD({ ...d, visibility: v as any })}
              options={[{ value: 'familia', label: VISIBILITY_LABEL.familia }, ...(canPrivate ? [{ value: 'adultos' as const, label: VISIBILITY_LABEL.adultos }] : []), { value: 'personal', label: `${VISIBILITY_LABEL.personal} (${profiles.find((p) => p.id === (d.ownerId ?? profile?.id))?.name ?? ''})` }]} />
          </div>
          <TextField label="Etiquetas" value={tags} onChange={setTags} hint="Separadas por coma" />
          <TextArea label="Descripción" value={d.description} onChange={(v) => setD({ ...d, description: v })} rows={2} />
          {doc?.relatedType && <p className="small">Vinculado a: {ENTITY_LABEL[doc.relatedType] ?? doc.relatedType}</p>}
          {d.extractedText && <details className="more"><summary>Texto extraído (para búsqueda)</summary><p className="pre small muted" style={{ maxHeight: 200, overflow: 'auto' }}>{d.extractedText}</p></details>}
          <Banner tone="info">La visibilidad organiza qué ve cada perfil en la app. La protección real del archivo depende de los permisos de Google Drive de la cuenta familiar.</Banner>
          {doc && <details className="more"><summary>Historial</summary><HistoryList entity="documents" recordId={doc.id} /></details>}
        </div>
      </Sheet>
      <ConfirmSheet open={del} onClose={() => setDel(false)} title="Eliminar documento" danger confirmLabel="Eliminar" message={<p>Se marcará como eliminado en la app. El archivo en Google Drive no se borra automáticamente.</p>}
        onConfirm={() => { run(() => repo.remove('documents', doc!.id, { by: profile?.id }), 'Documento eliminado').then(onClose); }} />
    </>
  );
}
