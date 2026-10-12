import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, RefreshCw, Unplug, Copy } from 'lucide-react';
import { useApp } from '../../app/context';
import { HttpTransport } from '../../sync/transport';
import { api, proposeExternalEvents, type BackendStatus, type CalendarReport } from '../../integrations/google';
import { Banner, StatusChip } from '../../ui/components';
import { Checkbox, TextField } from '../../ui/fields';
import { ConfirmSheet } from '../../ui/Sheet';
import { FAMILY_BACKEND_URL } from '../../services/seed';
import { formatDateTimeHuman, nowISO } from '../../domain/dates';

export function IntegrationsPanel() {
  const { backend, setBackend, run, toast, sync, repo, profile } = useApp();
  const [url, setUrl] = useState(backend?.url ?? FAMILY_BACKEND_URL);
  const [token, setToken] = useState(backend?.token ?? '');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [report, setReport] = useState<CalendarReport | null>(null);
  const [busy, setBusy] = useState('');
  const [disconnect, setDisconnect] = useState(false);
  const t = backend ? new HttpTransport(backend.url, backend.token) : null;

  useEffect(() => { setUrl(backend?.url ?? FAMILY_BACKEND_URL); setToken(backend?.token ?? ''); if (backend) refresh(); }, [backend?.url]);
  const refresh = async () => { if (!t) return; setBusy('Consultando estado…'); const s = await run(() => api.status(t)); setBusy(''); if (s) setStatus(s); };

  const connect = async () => {
    const u = url.trim(), k = token.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u)) { toast('La URL debe ser la de la aplicación web de Apps Script y terminar en /exec.', { tone: 'error' }); return; }
    if (k.length < 20) { toast('El token familiar parece incompleto.', { tone: 'error' }); return; }
    setBusy('Probando conexión…');
    const tt = new HttpTransport(u, k);
    const pong = await run(() => api.ping(tt));
    if (!pong) { setBusy(''); return; }
    setBusy('Inicializando hojas y carpetas…');
    const setup = await run(() => api.setup(tt));
    setBusy('');
    if (!setup) return;
    if (!setup.sheets.ok) { toast('Las hojas tienen encabezados incompatibles. Revisá el estado antes de sincronizar.', { tone: 'error' }); }
    await setBackend({ url: u, token: k });
    toast('Google conectado. Sincronizando…', { tone: 'ok' });
  };

  const applyCode = () => {
    try {
      const obj = JSON.parse(atob(code.trim()));
      if (obj.url && obj.token) { setUrl(obj.url); setToken(obj.token); toast('Código leído. Tocá "Conectar".', { tone: 'ok' }); }
    } catch { toast('El código no es válido.', { tone: 'error' }); }
  };

  const calendarSync = async () => {
    if (!t) return;
    setBusy('Sincronizando primero los cambios locales…');
    await sync.syncNow();
    setBusy('Sincronizando Google Calendar…');
    const r = await run(() => api.calendarSync(t));
    setBusy('');
    if (!r) return;
    setReport(r);
    await sync.syncNow();
  };

  const resolveCalConflict = async (c: CalendarReport['conflicts'][number], keep: 'app' | 'google') => {
    const patch: any = keep === 'google' ? { ...c.google, googleUpdated: c.googleUpdated } : { googleUpdated: c.googleUpdated };
    await run(() => repo.update('events', c.id, patch, { by: profile?.id }), keep === 'google' ? 'Se usó la versión de Google' : 'Se mantendrá la versión de la app');
    setReport((r) => (r ? { ...r, conflicts: r.conflicts.filter((x) => x.id !== c.id) } : r));
  };

  return (
    <div className="stack">
      <Banner tone="info">
        Hogar usa un backend gratuito de Google Apps Script en la cuenta de Google de la familia para guardar los datos en Google Sheets y los archivos en Drive.
        Nunca se pide ni se guarda la contraseña de Gmail. La guía paso a paso está en <code>docs/GOOGLE_SETUP.md</code>.
      </Banner>
      {!backend ? (
        <div className="card card-pad form">
          <h3>Conectar con Google</h3>
          <TextField label="URL de la aplicación web (termina en /exec)" value={url} onChange={setUrl} placeholder="https://script.google.com/macros/s/…/exec" />
          <TextField label="Token familiar" type="password" value={token} onChange={setToken} hint="Lo genera la función generarToken() del script. Tratá este valor como una contraseña." />
          <button className="btn btn-primary" onClick={connect} disabled={!!busy}>{busy || 'Conectar e inicializar'}</button>
          <details className="more"><summary>Tengo un código de otro dispositivo</summary>
            <div className="form" style={{ marginTop: 8 }}>
              <TextField label="Código de vinculación" value={code} onChange={setCode} />
              <button className="btn" onClick={applyCode}>Usar código</button>
            </div>
          </details>
          <p className="muted small">Mientras no conectes Google, todo funciona igual pero los datos quedan solo en este dispositivo. Hacé copias con "Exportar" en Copias de seguridad.</p>
        </div>
      ) : (
        <>
          <div className="card card-pad stack-sm">
            <div className="row"><CheckCircle2 size={18} color="var(--ok-fg)" /><h3 style={{ flex: 1 }}>Conectado</h3><button className="btn btn-sm" onClick={refresh} disabled={!!busy}><RefreshCw size={14} /> Estado</button></div>
            {busy && <p className="small muted" role="status">{busy}</p>}
            {status && (
              <dl className="kv">
                <dt>Cuenta</dt><dd>{status.owner}</dd>
                <dt>Planillas</dt><dd className="stack-sm">{Object.values(status.books ?? { app: { title: 'Hogar — datos', url: status.spreadsheetUrl } }).map((b) => <div key={b.url}><a href={b.url} target="_blank" rel="noopener noreferrer">{b.title} <ExternalLink size={12} /></a></div>)}</dd>
                {status.folders && <><dt>Carpetas</dt><dd className="stack-sm">{Object.values(status.folders).map((f) => <div key={f.url}><a href={f.url} target="_blank" rel="noopener noreferrer">📁 {f.name} <ExternalLink size={12} /></a></div>)}</dd></>}
                <dt>Carpeta</dt><dd><a href={status.rootFolderUrl} target="_blank" rel="noopener noreferrer">Hogar App en Drive <ExternalLink size={12} /></a></dd>
                <dt>Hojas</dt><dd>{status.sheets.ok ? <StatusChip tone="ok">Encabezados válidos</StatusChip> : <StatusChip tone="alert">Incompatibles</StatusChip>}{status.sheets.incompatible.map((x) => <div key={x} className="small" style={{ color: 'var(--alert-fg)' }}>{x}</div>)}</dd>
                <dt>Revisión</dt><dd>{status.rev}</dd>
                <dt>Última copia</dt><dd>{status.lastBackup ? `${formatDateTimeHuman(status.lastBackup.createdAt)} ${status.lastBackup.valid ? '(válida)' : '(inválida)'}` : 'Todavía ninguna'}</dd>
                <dt>Tareas automáticas</dt><dd>{status.triggers.length ? status.triggers.join(', ') : 'sin activadores (ejecutá inicializar())'}</dd>
              </dl>
            )}
            <div className="row-wrap">
              <button className="btn btn-sm" onClick={() => run(() => api.setup(t!), 'Hojas y carpetas verificadas').then(refresh)}>Verificar / reparar hojas</button>
              <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(btoa(JSON.stringify(backend))); toast('Código copiado. Pegalo en el otro dispositivo (Ajustes → Google). Es secreto.', { tone: 'ok' }); }}><Copy size={14} /> Código para otro dispositivo</button>
              <button className="btn btn-sm btn-danger" onClick={() => setDisconnect(true)}><Unplug size={14} /> Desconectar este dispositivo</button>
            </div>
          </div>

          <div className="card card-pad stack-sm">
            <h3>Google Calendar</h3>
            <p className="small muted">Se sincronizan solo los eventos marcados "Sincronizar con Google Calendar". Los cambios hechos en Google se aplican si la app no cambió; si cambiaron ambos, se te pregunta. Los eventos que no creó la app se proponen para importar con revisión.</p>
            <div className="row-wrap">
              <button className="btn" onClick={calendarSync} disabled={!!busy}>Sincronizar calendario ahora</button>
            </div>
            {status && <Checkbox label="Sincronizar automáticamente cada hora (desde el servidor)" checked={status.calendarAuto} onChange={(v) => run(() => api.setOption(t!, 'CALENDAR_AUTO', v ? 'true' : null)).then(refresh)} />}
            {report && <CalendarReportView report={report} onConflict={resolveCalConflict} onImportExternal={async () => { const n = await run(() => proposeExternalEvents(repo, report.external, profile?.id)); if (n !== undefined) toast(n ? `${n} evento(s) de Google listos para revisar en el Asistente.` : 'Ya estaban propuestos o importados.', { tone: 'ok' }); }}
              onDeletedInGoogle={async (id, action) => { await run<unknown>(() => (action === 'borrar' ? repo.remove('events', id, { by: profile?.id }) : repo.update('events', id, { googleEventId: '', googleUpdated: '', calendarSyncedAt: '' } as any, { by: profile?.id })), action === 'borrar' ? 'Evento eliminado en la app' : 'Se volverá a crear en Google'); setReport((r) => (r ? { ...r, deletedInGoogle: r.deletedInGoogle.filter((x) => x.id !== id) } : r)); }} />}
          </div>

          <div className="card card-pad stack-sm">
            <h3>Gmail (opcional, solo lectura)</h3>
            <p className="small muted">Permite buscar correos puntuales (facturas, vencimientos) e importarlos al asistente para revisar. No se lee todo el correo ni se envía, borra o modifica nada.</p>
            {status && <Checkbox label="Habilitar búsqueda en Gmail" checked={status.gmailEnabled} onChange={(v) => run(() => api.setOption(t!, 'GMAIL_ENABLED', v ? 'true' : null), v ? 'Gmail habilitado' : 'Gmail deshabilitado').then(refresh)} />}
            <p className="tiny muted">Para quitar el permiso por completo: borrá Gmail.gs y el permiso gmail.readonly del proyecto y volvé a implementar (ver guía).</p>
          </div>

          <div className="card card-pad stack-sm">
            <h3>Google Forms</h3>
            <p className="small muted">Vinculá un formulario a la planilla "Hogar — datos" (Respuestas → Vincular a hoja de cálculo). Las respuestas nuevas se importan desde el Asistente → "Respuestas de formularios" y pasan por revisión. Cada respuesta se importa una sola vez.</p>
          </div>
          <div className="card card-pad stack-sm">
            <h3>Revocar acceso</h3>
            <p className="small muted">Para revocar todo: en la cuenta de Google → Seguridad → Apps de terceros con acceso, quitá "Hogar backend"; o rotá el token con generarToken() para invalidar todos los dispositivos.</p>
          </div>
        </>
      )}
      <ConfirmSheet open={disconnect} onClose={() => setDisconnect(false)} title="Desconectar este dispositivo" danger confirmLabel="Desconectar"
        message={<p>Este dispositivo dejará de sincronizar. Los datos locales se conservan. Los cambios pendientes no enviados quedarán solo acá hasta que vuelvas a conectar.</p>}
        onConfirm={() => { setBackend(null).then(() => { setStatus(null); repo.db.setKV('lastDisconnect', nowISO()); }); }} />
    </div>
  );
}

function CalendarReportView({ report: r, onConflict, onImportExternal, onDeletedInGoogle }: {
  report: CalendarReport; onConflict: (c: CalendarReport['conflicts'][number], keep: 'app' | 'google') => void; onImportExternal: () => void;
  onDeletedInGoogle: (id: string, action: 'borrar' | 'recrear') => void;
}) {
  return (
    <div className="stack-sm small" role="status">
      <p><strong>Resultado:</strong> {r.created.length} creado(s) en Google · {r.updatedInGoogle.length} actualizado(s) en Google · {r.updatedFromGoogle.length} actualizado(s) desde Google · {r.deletedFromApp.length} eliminado(s) en Google.</p>
      {r.updatedFromGoogle.map((u) => <div key={u.id}>Cambió en Google: <strong>{u.title}</strong> — {Object.entries(u.changes).map(([k, [a, b]]) => `${k}: "${a}" → "${b}"`).join('; ')}</div>)}
      {r.conflicts.map((c) => (
        <div key={c.id} className="banner banner-warn"><div>
          <strong>{c.title}</strong> cambió en la app y en Google. Google tiene: {Object.entries(c.google).map(([k, v]) => `${k}: ${v}`).join(', ')}.
          <div className="row-wrap" style={{ marginTop: 6 }}><button className="btn btn-sm" onClick={() => onConflict(c, 'google')}>Usar la de Google</button><button className="btn btn-sm" onClick={() => onConflict(c, 'app')}>Mantener la de la app</button></div>
        </div></div>
      ))}
      {r.deletedInGoogle.map((d) => (
        <div key={d.id} className="banner banner-warn"><div>
          <strong>{d.title}</strong> fue eliminado en Google Calendar.
          <div className="row-wrap" style={{ marginTop: 6 }}><button className="btn btn-sm" onClick={() => onDeletedInGoogle(d.id, 'borrar')}>Eliminarlo también en la app</button><button className="btn btn-sm" onClick={() => onDeletedInGoogle(d.id, 'recrear')}>Volver a crearlo en Google</button></div>
        </div></div>
      ))}
      {r.errors.map((e) => <div key={e.id} style={{ color: 'var(--alert-fg)' }}>Error con "{e.title}": {e.error}</div>)}
      {r.external.length > 0 && <div className="row"><span>{r.external.length} evento(s) de Google que no están en la app (próximos 60 días).</span><button className="btn btn-sm" onClick={onImportExternal}>Proponer para importar</button></div>}
    </div>
  );
}
