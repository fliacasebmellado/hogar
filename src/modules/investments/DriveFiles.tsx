// Archivos de la carpeta de Drive de una inversión (planillas, documentos, PDF…), leídos en vivo desde Google.
// Las planillas de Google (p. ej. un plan de pagos) se pueden ver y editar dentro de la app o abrir en Google Sheets.
import { useEffect, useState } from 'react';
import { ExternalLink, FileSpreadsheet, FileText, Image as ImageIcon, File, RefreshCw, Eye } from 'lucide-react';
import { useApp } from '../../app/context';
import type { Investment } from '../../domain/types';
import { HttpTransport } from '../../sync/transport';
import { api, type DriveFileInfo } from '../../integrations/google';
import { Sheet } from '../../ui/Sheet';
import { formatDate } from '../../domain/dates';

const GSHEET = 'application/vnd.google-apps.spreadsheet';
const GDOC = 'application/vnd.google-apps.document';

/** Dirección para ver/editar dentro de la app (vista sin menús de Google). */
export function embedUrl(f: DriveFileInfo): string | null {
  if (f.mimeType === GSHEET) return `https://docs.google.com/spreadsheets/d/${f.id}/edit?rm=minimal`;
  if (f.mimeType === GDOC) return `https://docs.google.com/document/d/${f.id}/edit?rm=minimal`;
  if (f.mimeType === 'application/pdf' || f.mimeType.startsWith('image/')) return `https://drive.google.com/file/d/${f.id}/preview`;
  return null;
}
const iconFor = (m: string) => (m === GSHEET ? FileSpreadsheet : m === GDOC || m === 'application/pdf' ? FileText : m.startsWith('image/') ? ImageIcon : File);
const kindLabel = (m: string) => (m === GSHEET ? 'Planilla de Google' : m === GDOC ? 'Documento de Google' : m === 'application/pdf' ? 'PDF' : m.startsWith('image/') ? 'Imagen' : 'Archivo');

export function DriveFiles({ inv, onlySheets }: { inv: Investment; onlySheets?: boolean }) {
  const { backend, online } = useApp();
  const [files, setFiles] = useState<DriveFileInfo[] | null>(null);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<DriveFileInfo | null>(null);
  const load = async () => {
    if (!backend || !online) return;
    setError('');
    try { setFiles((await api.investmentFiles(new HttpTransport(backend.url, backend.token), inv.id)).files); }
    catch (e: any) { setError(e?.message ?? 'No se pudo leer la carpeta de Drive.'); }
  };
  useEffect(() => { load(); }, [inv.id, backend?.url, online]);

  if (!backend) return onlySheets ? null : <p className="muted small">Conectá la app con Google para ver los archivos de la carpeta de Drive.</p>;
  if (!online) return onlySheets ? null : <p className="muted small">Sin conexión: los archivos de Drive se ven cuando vuelve internet.</p>;
  const list = (files ?? []).filter((f) => !onlySheets || f.mimeType === GSHEET);
  if (onlySheets && files && !list.length) return null;
  return (
    <div className="drive-files">
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="eyebrow" style={{ flex: 1 }}>{onlySheets ? 'Planillas de esta inversión' : 'En su carpeta de Drive'}</span>
        <button className="icon-btn" onClick={load} aria-label="Actualizar archivos de Drive"><RefreshCw size={16} /></button>
      </div>
      {error && <p className="error-inline">{error}</p>}
      {files === null && !error && <p className="muted small">Leyendo la carpeta…</p>}
      {files && !list.length && <p className="muted small">La carpeta está vacía.</p>}
      {list.length > 0 && (
        <div className="card"><ul className="list">
          {list.map((f) => {
            const I = iconFor(f.mimeType);
            const embed = embedUrl(f);
            return (
              <li key={f.id} className="item" style={{ cursor: 'default' }}>
                <I size={22} className="muted" aria-hidden="true" />
                <div className="item-main">
                  <div className="item-title">{f.name}</div>
                  <div className="item-sub">{kindLabel(f.mimeType)}{f.path ? ` · ${f.path}` : ''}{f.updatedAt ? ` · modificado ${formatDate(f.updatedAt.slice(0, 10), { year: true })}` : ''}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {embed && <button className="btn btn-sm" onClick={() => setViewing(f)} aria-label={`Ver ${f.name} en la app`}><Eye size={14} /> Ver</button>}
                  <a className="btn btn-sm btn-primary" href={f.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${f.name} en Google`}><ExternalLink size={14} /> {f.mimeType === GSHEET ? 'Editar' : 'Abrir'}</a>
                </div>
              </li>
            );
          })}
        </ul></div>
      )}
      <Sheet open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name ?? ''} wide
        footer={viewing ? <a className="btn btn-primary" href={viewing.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Abrir en {viewing.mimeType === GSHEET ? 'Google Sheets' : 'Google'}</a> : undefined}>
        {viewing && (
          <div className="stack-sm">
            <iframe className="drive-embed" src={embedUrl(viewing)!} title={viewing.name} allow="clipboard-write" />
            <p className="tiny muted">Para editar acá tenés que tener abierta en este navegador una cuenta de Google con acceso al archivo. Si no carga, usá "Abrir en Google Sheets": en el celular se abre la app de Sheets.</p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
