import { useState } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import type { Conflict, OutboxOp, SyncLogEntry } from '../../domain/types';
import { Banner, StatusChip } from '../../ui/components';
import { ConfirmSheet } from '../../ui/Sheet';
import { ENTITY_LABEL } from '../../domain/catalog';
import { formatDateTimeHuman } from '../../domain/dates';

const titleOf = (r: any) => r?.title ?? r?.name ?? r?.concept ?? r?.key ?? r?.entity ?? r?.id ?? '';

export function SyncPanel() {
  const { sync, syncStatus: s, backend, run, online, profile } = useApp();
  const ops = useLive((r) => r.db.outbox.orderBy('createdAt').toArray(), [], [] as OutboxOp[]);
  const conflicts = useLive((r) => r.db.conflicts.filter((c) => !c.resolved).toArray(), [], [] as Conflict[]);
  const log = useLive((r) => r.db.syncLog.orderBy('id').reverse().limit(60).toArray(), [], [] as SyncLogEntry[]);
  const [resync, setResync] = useState(false);
  const visibleOps = ops.filter((o) => o.entity !== 'history');
  return (
    <div className="stack">
      {!backend && <Banner tone="warn">Google no está conectado: los cambios quedan solo en este dispositivo ({ops.length} operación(es) en cola para cuando conectes).</Banner>}
      <div className="card card-pad stack-sm">
        <dl className="kv">
          <dt>Conexión</dt><dd>{online ? 'En línea' : 'Sin conexión'}</dd>
          <dt>Última sincronización</dt><dd>{formatDateTimeHuman(s?.lastSyncAt)}</dd>
          <dt>Resultado</dt><dd>{s?.lastResult ? `${s.lastResult.status} · ↓${s.lastResult.pulled} ↑${s.lastResult.pushed}${s.lastResult.duplicates ? ` · ${s.lastResult.duplicates} reintento(s) sin duplicar` : ''}${s.lastResult.autoMerged ? ` · ${s.lastResult.autoMerged} fusión(es) automática(s)` : ''}` : '—'}</dd>
          <dt>Pendientes</dt><dd>{s?.pending ?? 0} (incluye historial de cambios)</dd>
          <dt>Errores</dt><dd>{s?.errors ?? 0}</dd>
          <dt>Conflictos</dt><dd>{s?.conflicts ?? 0}</dd>
        </dl>
        {s?.lastResult?.errors?.length ? <Banner tone="alert">{s.lastResult.errors.slice(0, 3).join(' · ')}</Banner> : null}
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={!backend || !online || s?.running} onClick={() => sync.syncNow()}><RefreshCw size={16} className={s?.running ? 'spin' : ''} /> Sincronizar ahora</button>
          <button className="btn" disabled={!backend || !s?.errors} onClick={() => sync.retryErrors()}><RotateCcw size={16} /> Reintentar errores</button>
          <button className="btn btn-ghost" disabled={!backend || !online} onClick={() => setResync(true)}>Resincronización completa</button>
        </div>
      </div>

      {conflicts.length > 0 && (
        <section className="stack-sm">
          <h3>Conflictos ({conflicts.length})</h3>
          <p className="small muted">Estos registros cambiaron en este dispositivo y también en otro. No se sobrescribió nada: elegí qué versión conservar.</p>
          {conflicts.map((c) => <ConflictCard key={c.id} c={c} onResolve={(choice) => run(() => sync.resolveConflict(c.id, choice, profile?.id), 'Conflicto resuelto')} />)}
        </section>
      )}

      <section>
        <h3 style={{ marginBottom: 8 }}>Operaciones pendientes ({visibleOps.length})</h3>
        {visibleOps.length === 0 ? <p className="muted small">No hay cambios pendientes de enviar.</p> : (
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="simple">
              <thead><tr><th>Registro</th><th>Estado</th><th>Intentos</th><th>Detalle</th><th /></tr></thead>
              <tbody>
                {visibleOps.slice(0, 100).map((o) => (
                  <tr key={o.opId}>
                    <td>{ENTITY_LABEL[o.entity] ?? o.entity}: {String(titleOf(o.payload)).slice(0, 40)}{o.payload?.deleted ? ' (eliminación)' : ''}</td>
                    <td><StatusChip tone={o.status === 'error' ? 'alert' : o.status === 'conflict' ? 'warn' : 'neutral'}>{o.status}</StatusChip></td>
                    <td>{o.attempts}</td>
                    <td className="small">{o.lastError ?? ''}</td>
                    <td>{o.status === 'error' && o.attempts >= 3 && <button className="btn btn-sm btn-ghost" onClick={() => run(() => sync.discardOp(o.opId), 'Operación descartada (el dato sigue en este dispositivo)')}>Descartar</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 style={{ marginBottom: 8 }}>Registro de sincronización</h3>
        <div className="card card-pad small" style={{ maxHeight: 300, overflow: 'auto' }}>
          {log.length === 0 ? <p className="muted">Sin actividad todavía.</p> : log.map((l) => (
            <div key={l.id} style={{ marginBottom: 6 }}>
              <span className="muted">{formatDateTimeHuman(l.at)}</span> · <span style={{ color: l.level === 'error' ? 'var(--alert-fg)' : l.level === 'warn' ? 'var(--warn-fg)' : undefined }}>{l.message}</span>
              {l.detail && <div className="tiny muted">{l.detail}</div>}
            </div>
          ))}
        </div>
        <p className="tiny muted" style={{ marginTop: 6 }}>El registro no guarda el contenido de capturas ni documentos.</p>
      </section>
      <ConfirmSheet open={resync} onClose={() => setResync(false)} title="Resincronización completa" confirmLabel="Resincronizar"
        message={<p>Se vuelven a descargar todos los datos desde Google. Los cambios de este dispositivo que todavía no se enviaron se conservan y se envían después.</p>}
        onConfirm={() => run(() => sync.fullResync(), 'Resincronización completada')} />
    </div>
  );
}

function ConflictCard({ c, onResolve }: { c: Conflict; onResolve: (choice: 'local' | 'server' | { merged: any }) => void }) {
  const [pick, setPick] = useState<Record<string, 'local' | 'server'>>({});
  const fmt = (v: any) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v));
  const merged = () => Object.fromEntries(c.fields.map((f) => [f, (pick[f] ?? 'local') === 'local' ? c.local[f] : c.server[f]]));
  return (
    <div className="card card-pad stack-sm">
      <div className="row"><strong style={{ flex: 1 }}>{ENTITY_LABEL[c.entity]}: {titleOf(c.local)}</strong><span className="tiny muted">{formatDateTimeHuman(c.detectedAt)}</span></div>
      <div style={{ overflowX: 'auto' }}>
        <table className="simple">
          <thead><tr><th>Campo</th><th>Este dispositivo</th><th>Otro dispositivo (Google)</th></tr></thead>
          <tbody>{c.fields.map((f) => (
            <tr key={f}>
              <td>{f}</td>
              <td><label className="row"><input type="radio" name={`${c.id}-${f}`} checked={(pick[f] ?? 'local') === 'local'} onChange={() => setPick({ ...pick, [f]: 'local' })} /> {fmt(c.local[f])}</label></td>
              <td><label className="row"><input type="radio" name={`${c.id}-${f}`} checked={pick[f] === 'server'} onChange={() => setPick({ ...pick, [f]: 'server' })} /> {fmt(c.server[f])}</label></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="row-wrap">
        <button className="btn btn-sm" onClick={() => onResolve('local')}>Mantener la de este dispositivo</button>
        <button className="btn btn-sm" onClick={() => onResolve('server')}>Usar la del otro dispositivo</button>
        <button className="btn btn-sm btn-primary" onClick={() => onResolve({ merged: merged() })}>Combinar lo elegido</button>
      </div>
    </div>
  );
}
