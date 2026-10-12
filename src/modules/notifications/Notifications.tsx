import { Link } from 'react-router-dom';
import { Bell, Check, X } from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import { buildNotifications, type AppNotification } from '../../services/notifications';
import { Empty, StatusChip } from '../../ui/components';
import type { NotificationState } from '../../domain/types';

export default function Notifications() {
  const { repo, profile, notifSettings, can, syncStatus, backend } = useApp();
  const data = useLive(async (r) => {
    const [events, tasks, payments, states, investments, investmentTaxes, investmentContracts, documents] = await Promise.all([r.list('events'), r.list('tasks'), r.list('payments'), r.db.notifState.toArray(), r.list('investments'), r.list('investmentTaxes'), r.list('investmentContracts'), r.list('documents')]);
    const list = buildNotifications({ events, tasks, payments, investments, investmentTaxes, investmentContracts, documents, profile, settings: notifSettings, financeVisible: can('finance.view'), sync: { pending: syncStatus?.pending ?? 0, errors: syncStatus?.errors ?? 0, conflicts: syncStatus?.conflicts ?? 0, configured: !!backend } });
    return { list, states };
  }, [profile?.id, notifSettings, syncStatus], { list: [] as AppNotification[], states: [] as NotificationState[] });
  const st = (k: string) => data.states.find((s) => s.key === k);
  const visible = data.list.filter((n) => !st(n.key)?.dismissed);
  const mark = (n: AppNotification, patch: Partial<NotificationState>) => repo.db.notifState.put({ key: n.key, read: st(n.key)?.read ?? false, dismissed: st(n.key)?.dismissed ?? false, notifiedAt: st(n.key)?.notifiedAt, ...patch });
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <p className="muted small" style={{ flex: 1 }}>Avisos de eventos próximos, vencimientos, tareas, mantenimiento y sincronización. Se configuran en Ajustes → Notificaciones.</p>
        {visible.some((n) => !st(n.key)?.read) && <button className="btn btn-sm" onClick={() => Promise.all(visible.map((n) => mark(n, { read: true })))}>Marcar todo como leído</button>}
      </div>
      {visible.length === 0 ? <div className="card"><Empty icon={<Bell size={34} />} title="No hay avisos." /></div> : (
        <div className="card"><ul className="list">
          {visible.map((n) => (
            <li key={n.key}>
              <div className="item" style={{ fontWeight: st(n.key)?.read ? 400 : 600 }}>
                <StatusChip tone={n.severity === 'alert' ? 'alert' : n.severity === 'warn' ? 'warn' : 'info'}>{n.kind}</StatusChip>
                <Link to={n.link} className="item-main" style={{ textDecoration: 'none' }} onClick={() => mark(n, { read: true })}>
                  <div className="item-title">{n.title}</div><div className="item-sub">{n.detail}</div>
                </Link>
                {!st(n.key)?.read && <button className="icon-btn" aria-label="Marcar como leído" onClick={() => mark(n, { read: true })}><Check size={16} /></button>}
                <button className="icon-btn" aria-label="Descartar aviso" onClick={() => mark(n, { dismissed: true })}><X size={16} /></button>
              </div>
            </li>
          ))}
        </ul></div>
      )}
    </div>
  );
}
