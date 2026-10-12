import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Wrench, Home as HomeIcon, Phone } from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import type { Asset, Maintenance, Provider, Repair, Room, Task } from '../../domain/types';
import { CategoryChip, ChipFilter, Empty, Segmented, StatusChip, SyncMark } from '../../ui/components';
import { AssetSheet, MaintenanceSheet, ProviderSheet, RepairSheet, RoomSheet } from './HouseSheets';
import { REPAIR_STATUS_LABEL } from '../../domain/catalog';
import { describeRecurrence } from '../../domain/recurrence';
import { formatDate, relativeDay } from '../../domain/dates';
import { warrantyStatus } from '../../services/house';

type Tab = 'ambientes' | 'elementos' | 'reparaciones' | 'mantenimiento' | 'proveedores';

export default function House() {
  const { categories, backend, can } = useApp();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) ?? 'reparaciones');
  const [roomFilter, setRoomFilter] = useState('');
  const [repairFilter, setRepairFilter] = useState<'abiertas' | 'resuelta' | ''>('abiertas');
  const [sheet, setSheet] = useState<{ kind: Tab; rec: any } | null>(null);
  const rooms = useLive((r) => r.list('rooms'), [], [] as Room[]);
  const assets = useLive((r) => r.list('assets'), [], [] as Asset[]);
  const repairs = useLive((r) => r.list('repairs'), [], [] as Repair[]);
  const plans = useLive((r) => r.list('maintenance'), [], [] as Maintenance[]);
  const providers = useLive((r) => r.list('providers'), [], [] as Provider[]);
  const tasks = useLive((r) => r.list('tasks'), [], [] as Task[]);

  useEffect(() => {
    const rid = params.get('reparacion'), aid = params.get('elemento'), roomId = params.get('ambiente');
    if (rid && repairs.length) { const r = repairs.find((x) => x.id === rid); if (r) { setTab('reparaciones'); setSheet({ kind: 'reparaciones', rec: r }); } }
    if (aid && assets.length) { const a = assets.find((x) => x.id === aid); if (a) { setTab('elementos'); setSheet({ kind: 'elementos', rec: a }); } }
    if (roomId) { setTab('elementos'); setRoomFilter(roomId); }
  }, [params, repairs.length, assets.length]);
  const close = () => { setSheet(null); if (params.get('reparacion') || params.get('elemento')) setParams({ tab }, { replace: true }); };
  const roomName = (id?: string) => rooms.find((r) => r.id === id)?.name;
  const nextTask = (m: Maintenance) => tasks.filter((t) => t.seriesId === m.taskSeriesId && t.status !== 'completada').sort((a, b) => ((a.dueDate ?? '') < (b.dueDate ?? '') ? -1 : 1))[0];
  const editable = can('house.edit');
  const newLabel: Record<Tab, string> = { ambientes: 'Ambiente', elementos: 'Elemento', reparaciones: 'Reparación', mantenimiento: 'Mantenimiento', proveedores: 'Proveedor' };

  const openRepairs = repairs.filter((r) => (repairFilter === '' ? true : repairFilter === 'abiertas' ? r.status !== 'resuelta' : r.status === 'resuelta') && (!roomFilter || r.roomId === roomFilter));

  return (
    <div>
      <div className="tabs-scroll" style={{ marginBottom: 12 }}>
        <Segmented label="Secciones de la casa" value={tab} onChange={(t) => { setTab(t); setParams({ tab: t }, { replace: true }); }}
          options={[{ value: 'reparaciones', label: 'Reparaciones', badge: repairs.filter((r) => r.status !== 'resuelta').length }, { value: 'mantenimiento', label: 'Mantenimiento' }, { value: 'elementos', label: 'Elementos' }, { value: 'ambientes', label: 'Ambientes' }, { value: 'proveedores', label: 'Proveedores' }]} />
      </div>
      {editable && <div className="row" style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={() => setSheet({ kind: tab, rec: null })}><Plus size={18} /> {newLabel[tab]}</button></div>}
      {(tab === 'elementos' || tab === 'reparaciones') && rooms.length > 0 && (
        <div style={{ marginBottom: 10 }}><ChipFilter label="Ambiente" value={roomFilter} onChange={setRoomFilter} options={rooms.map((r) => ({ value: r.id, label: r.name }))} /></div>
      )}

      {tab === 'reparaciones' && (
        <>
          <div style={{ marginBottom: 10 }}><ChipFilter label="Estado" value={repairFilter} onChange={(v) => setRepairFilter(v as any)} options={[{ value: 'abiertas', label: 'Abiertas' }, { value: 'resuelta', label: 'Resueltas' }]} /></div>
          <List items={openRepairs} empty="No hay reparaciones en esta vista." render={(r: Repair) => (
            <button className="item" onClick={() => setSheet({ kind: 'reparaciones', rec: r })}>
              <div className="item-main">
                <div className="item-title">{r.title}</div>
                <div className="item-sub">
                  <span>{formatDate(r.reportedAt)}</span>
                  {roomName(r.roomId) && <span>{roomName(r.roomId)}</span>}
                  {r.assetId && <span>{assets.find((a) => a.id === r.assetId)?.name}</span>}
                  {r.taskId && <span>con tarea</span>}
                  {r.expenseId && <span>factura vinculada</span>}
                  <SyncMark state={r._sync} configured={!!backend} />
                </div>
              </div>
              <StatusChip tone={r.status === 'resuelta' ? 'ok' : r.status === 'en_curso' ? 'info' : 'warn'}>{REPAIR_STATUS_LABEL[r.status]}</StatusChip>
            </button>
          )} />
        </>
      )}
      {tab === 'mantenimiento' && (
        <List items={plans} empty="No hay planes de mantenimiento. Agregá los que quieras con la frecuencia que corresponda." render={(m: Maintenance) => {
          const nt = nextTask(m);
          return (
            <button className="item" onClick={() => setSheet({ kind: 'mantenimiento', rec: m })}>
              <div className="item-main">
                <div className="item-title">{m.title}</div>
                <div className="item-sub">
                  <span>{describeRecurrence(m.recurrence)}</span>
                  <CategoryChip id={m.category} categories={categories('maintenance')} />
                  {nt?.dueDate && <span>Próxima: {relativeDay(nt.dueDate)}</span>}
                  {!m.active && <StatusChip tone="neutral">Pausado</StatusChip>}
                </div>
              </div>
            </button>
          );
        }} />
      )}
      {tab === 'elementos' && (
        <List items={assets.filter((a) => !roomFilter || a.roomId === roomFilter)} empty="Todavía no hay elementos cargados (electrodomésticos, instalaciones, equipos…)." render={(a: Asset) => {
          const w = warrantyStatus(a.warrantyUntil);
          return (
            <button className="item" onClick={() => setSheet({ kind: 'elementos', rec: a })}>
              <div className="item-main">
                <div className="item-title">{a.name}</div>
                <div className="item-sub">
                  <CategoryChip id={a.category} categories={categories('assets')} />
                  {roomName(a.roomId) && <span>{roomName(a.roomId)}</span>}
                  {[a.brand, a.model].filter(Boolean).join(' ')}
                  {w === 'por_vencer' && <StatusChip tone="warn">Garantía por vencer</StatusChip>}
                  {w === 'vigente' && <StatusChip tone="ok">En garantía</StatusChip>}
                </div>
              </div>
            </button>
          );
        }} />
      )}
      {tab === 'ambientes' && (
        <List items={rooms} empty="Agregá los ambientes de la casa para organizar elementos y reparaciones." render={(r: Room) => (
          <button className="item" onClick={() => setSheet({ kind: 'ambientes', rec: r })}>
            <HomeIcon size={18} className="muted" />
            <div className="item-main">
              <div className="item-title">{r.name}</div>
              <div className="item-sub"><span>{assets.filter((a) => a.roomId === r.id).length} elemento(s)</span><span>{repairs.filter((x) => x.roomId === r.id && x.status !== 'resuelta').length} reparación(es) abierta(s)</span></div>
            </div>
          </button>
        )} />
      )}
      {tab === 'proveedores' && (
        <List items={providers} empty="Sin proveedores cargados." render={(p: Provider) => (
          <div className="item">
            <button type="button" className="item-main item-main-btn" onClick={() => setSheet({ kind: 'proveedores', rec: p })}><div className="item-title">{p.name}</div><div className="item-sub">{p.trade}{p.phone && <span>{p.phone}</span>}</div></button>
            {p.phone && <a className="icon-btn" href={`tel:${p.phone}`} aria-label={`Llamar a ${p.name}`}><Phone size={18} /></a>}
          </div>
        )} />
      )}
      <RoomSheet open={sheet?.kind === 'ambientes'} room={sheet?.rec} onClose={close} />
      <AssetSheet open={sheet?.kind === 'elementos'} asset={sheet?.rec} onClose={close} />
      <RepairSheet open={sheet?.kind === 'reparaciones'} repair={sheet?.rec} onClose={close} />
      <MaintenanceSheet open={sheet?.kind === 'mantenimiento'} plan={sheet?.rec} onClose={close} />
      <ProviderSheet open={sheet?.kind === 'proveedores'} provider={sheet?.rec} onClose={close} />
    </div>
  );
}

function List<T extends { id: string }>({ items, render, empty }: { items: T[]; render: (t: T) => React.ReactNode; empty: string }) {
  if (!items.length) return <div className="card"><Empty icon={<Wrench size={34} />} title={empty} /></div>;
  return <div className="card"><ul className="list">{items.map((i) => <li key={i.id}>{render(i)}</li>)}</ul></div>;
}
