// Búsqueda acotada en Gmail: la persona escribe la consulta y elige qué mensajes importar (máximo 20 por búsqueda).
import { useState } from 'react';
import { Search } from 'lucide-react';
import { useApp } from '../../app/context';
import { Sheet } from '../../ui/Sheet';
import { Banner } from '../../ui/components';
import type { Transport } from '../../sync/transport';
import { api, importGmailMessages, type GmailSummary } from '../../integrations/google';
import { Checkbox } from '../../ui/fields';

export function GmailImportSheet({ open, onClose, transport, onImported }: { open: boolean; onClose: () => void; transport: Transport; onImported: () => void }) {
  const { repo, profile, run, toast } = useApp();
  const [q, setQ] = useState('factura OR vencimiento newer_than:30d');
  const [results, setResults] = useState<GmailSummary[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [withAtt, setWithAtt] = useState(true);
  const search = async () => {
    setBusy(true);
    const r = await run(() => api.gmailSearch(transport, q, 15));
    setBusy(false);
    if (r) { setResults(r); setSel([]); }
  };
  const doImport = async () => {
    setBusy(true);
    const ids = await run(() => importGmailMessages(repo, transport, sel, profile?.id, withAtt));
    setBusy(false);
    if (ids) { toast(`${ids.length} correo(s) listos para revisar.`, { tone: 'ok' }); onImported(); onClose(); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Importar desde Gmail" wide
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!sel.length || busy} onClick={doImport}>Importar {sel.length || ''} para revisar</button></>}>
      <div className="stack">
        <Banner tone="info">Solo lectura: la app no envía, borra ni marca correos. Se leen únicamente los mensajes que elijas.</Banner>
        <form className="row" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <input className="input" aria-label="Búsqueda en Gmail" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" disabled={busy}><Search size={16} /> Buscar</button>
        </form>
        <p className="muted tiny">Usá la sintaxis de Gmail: from:edenor, subject:factura, newer_than:7d, has:attachment.</p>
        <Checkbox label="Traer adjuntos PDF o imagen (máx. 3 por correo)" checked={withAtt} onChange={setWithAtt} />
        {results && (results.length === 0 ? <p className="muted">Sin resultados.</p> : (
          <div className="card"><ul className="list">
            {results.map((m) => (
              <li key={m.id}>
                <label className="item" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={sel.includes(m.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, m.id] : s.filter((x) => x !== m.id)))} style={{ width: 20, height: 20 }} />
                  <div className="item-main"><div className="item-title">{m.subject || '(sin asunto)'}</div><div className="item-sub"><span>{m.from}</span><span>{m.date.slice(0, 10)}</span>{m.attachments > 0 && <span>{m.attachments} adjunto(s)</span>}</div><div className="tiny muted truncate">{m.snippet}</div></div>
                </label>
              </li>
            ))}
          </ul></div>
        ))}
      </div>
    </Sheet>
  );
}
