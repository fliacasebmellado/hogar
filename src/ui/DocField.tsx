// Campo para vincular un documento existente o cargar uno nuevo (factura, manual, garantía…).
// El documento es la fuente de verdad: los registros solo guardan su id (no se duplican archivos).
import { useApp, useLive } from '../app/context';
import { FilePickButton, useOpenAttachment } from './records';
import { addDocument } from '../services/documents';
import { canSeeDocument } from '../domain/permissions';
import type { DocumentRecord, EntityName } from '../domain/types';

export function DocField({ docId, onChange, label = 'Comprobante', category = 'comprobantes', related }: { docId?: string; onChange: (id?: string) => void; label?: string; category?: string; related?: { type: EntityName; id?: string } }) {
  const { repo, profile, run, permissions } = useApp();
  const doc = useLive((r) => (docId ? r.get('documents', docId) : undefined), [docId], undefined);
  const docs = useLive((r) => r.list('documents'), [], [] as DocumentRecord[]);
  const open = useOpenAttachment();
  const candidates = docs.filter((d) => d.category === category && canSeeDocument(profile, d, permissions)).slice(-30);
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {doc ? (
        <div className="row small">
          <button type="button" className="link-btn truncate" onClick={() => doc.attachmentId && open(doc.attachmentId)}>{doc.name}</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(undefined)}>Quitar</button>
        </div>
      ) : (
        <div className="row-wrap">
          <FilePickButton multiple={false} label="Cargar archivo" accept="image/*,application/pdf" onFiles={async ([f]) => {
            const d = await run(() => addDocument(repo, { name: f.name.replace(/\.[^.]+$/, ''), category, file: f, fileName: f.name, relatedType: related?.type, relatedId: related?.id }, profile?.id), 'Documento guardado');
            if (d) onChange(d.id);
          }} />
          {candidates.length > 0 && (
            <select className="input" style={{ flex: 1, minWidth: 160 }} aria-label={`Elegir ${label.toLowerCase()} existente`} value="" onChange={(e) => e.target.value && onChange(e.target.value)}>
              <option value="">o elegir uno existente…</option>
              {candidates.map((d) => <option key={d.id} value={d.id}>{d.name}{d.date ? ` (${d.date})` : ''}</option>)}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
