import { useEffect, useState } from 'react';
import { Download, Upload, CloudUpload } from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import type { LocalBackup } from '../../domain/types';
import { Banner, StatusChip } from '../../ui/components';
import { ConfirmSheet } from '../../ui/Sheet';
import { Checkbox } from '../../ui/fields';
import { FilePickButton } from '../../ui/records';
import { downloadJSON, exportAll, restoreBackup, saveLocalBackup, validateBackup, type BackupFile, type BackupValidation } from '../../services/backup';
import { HttpTransport } from '../../sync/transport';
import { api, type BackupInfo } from '../../integrations/google';
import { formatDateTimeHuman, today } from '../../domain/dates';
import { humanSize } from '../../services/files';

export function BackupsPanel() {
  const { repo, run, toast, backend, profile, sync } = useApp();
  const [withFiles, setWithFiles] = useState(false);
  const [candidate, setCandidate] = useState<{ data: BackupFile; v: BackupValidation; source: string } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [driveBackups, setDriveBackups] = useState<BackupInfo[] | null>(null);
  const [serverRestore, setServerRestore] = useState<BackupInfo | null>(null);
  const [busy, setBusy] = useState('');
  const locals = useLive((r) => r.db.localBackups.orderBy('createdAt').reverse().toArray(), [], [] as LocalBackup[]);
  const t = backend ? new HttpTransport(backend.url, backend.token) : null;
  useEffect(() => { if (t) loadDrive(); }, [backend?.url]);
  const loadDrive = async () => { if (!t) return; const l = await run(() => api.listBackups(t)); if (l) setDriveBackups(l); };

  const doExport = async () => {
    setBusy('Preparando exportación…');
    const b = await run(() => exportAll(repo, { includeFiles: withFiles }));
    setBusy('');
    if (!b) return;
    const v = await validateBackup(b);
    if (!v.ok) { toast('La exportación no pasó la verificación: ' + v.errors.join(' '), { tone: 'error' }); return; }
    downloadJSON(b, `hogar-copia-${today()}${withFiles ? '-con-archivos' : ''}.json`);
    await repo.db.setKV('lastManualExport', new Date().toISOString());
    toast('Copia exportada y verificada.', { tone: 'ok' });
  };
  const pickFile = async ([f]: File[]) => {
    try {
      const data = JSON.parse(await f.text());
      setCandidate({ data, v: await validateBackup(data), source: f.name });
    } catch { toast('El archivo no es un JSON válido.', { tone: 'error' }); }
  };
  const doRestore = async () => {
    if (!candidate?.v.ok) return;
    const r = await run(() => restoreBackup(repo, candidate.data, profile?.id));
    if (r) { toast(`Restaurados ${r.restored} registros${r.files ? ` y ${r.files} archivos` : ''}. Se guardó una copia previa por seguridad.`, { tone: 'ok' }); setCandidate(null); }
  };
  const total = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);

  return (
    <div className="stack">
      <Banner tone="info">La sincronización no es una copia de seguridad: si algo se borra, se borra en todos los dispositivos. Por eso hay copias diarias en Drive (si Google está conectado), copias automáticas en este dispositivo y exportaciones manuales.</Banner>
      <div className="card card-pad stack-sm">
        <h3>Exportar todo (formato abierto JSON)</h3>
        <p className="small muted">Incluye todos los registros, relaciones, historial y metadatos, con una suma de verificación para detectar copias incompletas.</p>
        <Checkbox label="Incluir archivos guardados en este dispositivo" checked={withFiles} onChange={setWithFiles} hint="el archivo resultante puede ser grande" />
        <button className="btn btn-primary" onClick={doExport} disabled={!!busy}><Download size={16} /> {busy || 'Exportar copia'}</button>
      </div>
      <div className="card card-pad stack-sm">
        <h3>Restaurar desde un archivo</h3>
        <FilePickButton multiple={false} label="Elegir copia (.json)" accept="application/json,.json" onFiles={pickFile} />
        {candidate && (
          <div className="stack-sm">
            <p className="small">Archivo: {candidate.source} · creado {formatDateTimeHuman(candidate.data.createdAt)} · {total(candidate.v.counts)} registros.</p>
            {candidate.v.ok ? <Banner tone="ok">La copia es válida (cantidades y suma de verificación correctas).</Banner> : <Banner tone="alert">No se puede restaurar: {candidate.v.errors.join(' ')}</Banner>}
            <button className="btn" disabled={!candidate.v.ok} onClick={() => setConfirmRestore(true)}><Upload size={16} /> Restaurar estos datos</button>
          </div>
        )}
      </div>
      <div className="card card-pad stack-sm">
        <h3>Copias automáticas en este dispositivo</h3>
        <p className="small muted">Una por día y antes de cada restauración (se conservan las últimas 7).</p>
        <div className="row-wrap"><button className="btn btn-sm" onClick={() => run(() => saveLocalBackup(repo, 'Copia manual en el dispositivo'), 'Copia local guardada')}>Hacer copia local ahora</button></div>
        {locals.map((b) => (
          <div key={b.id} className="row small">
            <span style={{ flex: 1 }}>{formatDateTimeHuman(b.createdAt)} · {b.reason} · {humanSize(b.size)}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => downloadJSON(JSON.parse(b.data), `hogar-copia-local-${b.createdAt.slice(0, 10)}.json`)}>Descargar</button>
            <button className="btn btn-sm" onClick={async () => { const data = JSON.parse(b.data); setCandidate({ data, v: await validateBackup(data), source: `copia local ${formatDateTimeHuman(b.createdAt)}` }); }}>Usar</button>
          </div>
        ))}
      </div>
      {t && (
        <div className="card card-pad stack-sm">
          <h3>Copias en Google Drive</h3>
          <p className="small muted">El servidor hace una copia diaria (3 a. m.) en Hogar App/Backups, la relee y verifica antes de marcarla válida y conserva las últimas 30. Nunca reemplaza una copia válida por una incompleta.</p>
          <div className="row-wrap">
            <button className="btn btn-sm" onClick={async () => { setBusy('Creando copia en Drive…'); const r = await run(() => api.runBackup(t)); setBusy(''); if (r) { toast(r.valid ? `Copia creada y verificada (${r.records} registros).` : `La copia no pasó la verificación: ${r.problems.join(', ')}`, { tone: r.valid ? 'ok' : 'error' }); loadDrive(); } }}><CloudUpload size={16} /> Copia en Drive ahora</button>
            <button className="btn btn-sm btn-ghost" onClick={loadDrive}>Actualizar lista</button>
          </div>
          {driveBackups?.length === 0 && <p className="muted small">Todavía no hay copias en Drive.</p>}
          {driveBackups?.slice(0, 15).map((b) => (
            <div key={b.fileId} className="row small">
              <span style={{ flex: 1 }}>{formatDateTimeHuman(b.createdAt)} · {b.kind} · {b.records} registros</span>
              <StatusChip tone={b.valid ? 'ok' : 'alert'}>{b.valid ? 'válida' : 'inválida'}</StatusChip>
              {b.valid && <button className="btn btn-sm btn-ghost" onClick={async () => { const data = await run(() => api.getBackup(t, b.fileId)); if (data) setCandidate({ data, v: await validateBackup(data), source: b.name }); }}>Verificar / usar aquí</button>}
              {b.valid && <button className="btn btn-sm" onClick={() => setServerRestore(b)}>Restaurar en Google</button>}
            </div>
          ))}
        </div>
      )}
      <div className="card card-pad small stack-sm">
        <h3>Cómo comprobar que una restauración funciona</h3>
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          <li>Exportá una copia y abrila en "Restaurar desde un archivo": debe decir "La copia es válida".</li>
          <li>Para una prueba completa, usá otro navegador o perfil: restaurá la copia allí y verificá que aparezcan tareas, eventos y documentos.</li>
          <li>Las restauraciones guardan antes una copia del estado actual, así que se pueden deshacer.</li>
        </ol>
      </div>
      <ConfirmSheet open={confirmRestore} onClose={() => setConfirmRestore(false)} title="Restaurar datos" confirmLabel="Restaurar"
        message={<><p>Los registros de la copia reemplazarán a los que tengan el mismo identificador en este dispositivo. Los registros que no estén en la copia se conservan.</p><p>Antes se guarda una copia automática del estado actual.{backend ? ' Luego los datos restaurados se enviarán a Google.' : ''}</p></>}
        onConfirm={doRestore} />
      <ConfirmSheet open={!!serverRestore} onClose={() => setServerRestore(null)} title="Restaurar en Google" danger confirmLabel="Restaurar en Google"
        message={<><p>Se reemplaza el contenido de la planilla "Hogar — datos" por la copia del {serverRestore && formatDateTimeHuman(serverRestore.createdAt)}. Antes el servidor hace una copia "pre-restauración" del estado actual.</p><p>Todos los dispositivos volverán a descargar los datos en su próxima sincronización.</p></>}
        onConfirm={async () => { const r = await run(() => api.restoreBackup(t!, serverRestore!.fileId)); if (r) { toast(`Restaurados ${r.restored} registros en Google.`, { tone: 'ok' }); await sync.fullResync(); loadDrive(); } }} />
    </div>
  );
}
