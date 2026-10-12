import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Repeat, CheckSquare } from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import type { Task } from '../../domain/types';
import { filterTasks, completeTask, reopenTask, type TaskFilter } from '../../services/tasks';
import { Avatar, CategoryChip, CheckButton, ChipFilter, Empty, PersonFilter, StatusChip, SyncMark } from '../../ui/components';
import { categoryIcon } from '../../ui/theme';
import { relativeDay, today } from '../../domain/dates';
import { TaskSheet } from './TaskSheet';
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from '../../domain/catalog';

export function TaskRow({ t, onOpen }: { t: Task; onOpen: (t: Task) => void }) {
  const { repo, profile, profiles, categories, run, backend } = useApp();
  const done = t.status === 'completada';
  const overdue = !done && t.dueDate && t.dueDate < today();
  const assignee = profiles.find((p) => p.id === t.assigneeId);
  return (
    <li>
      <div className={`item${done ? ' done' : ''}`}>
        <CheckButton on={done} label={done ? `Reabrir ${t.title}` : `Completar ${t.title}`}
          onClick={() => run<unknown>(() => (done ? reopenTask(repo, t.id, profile?.id) : completeTask(repo, t.id, profile?.id)), done ? 'Reabierta' : 'Completada')} />
        <span className="cat-ico" aria-hidden="true">{categoryIcon('tasks', t.category)}</span>
        <button type="button" className="item-main item-main-btn" onClick={() => onOpen(t)}>
          <div className="item-title">{t.title}</div>
          <div className="item-sub">
            {t.dueDate && <span style={overdue ? { color: 'var(--alert-fg)', fontWeight: 600 } : undefined}>{overdue ? 'Atrasada · ' : ''}{relativeDay(t.dueDate)}{t.dueTime ? ` ${t.dueTime}` : ''}</span>}
            <CategoryChip id={t.category} categories={categories('tasks')} />
            {t.priority === 'alta' && <StatusChip tone="warn">Prioridad alta</StatusChip>}
            {t.status === 'bloqueada' && <StatusChip tone="alert">Bloqueada</StatusChip>}
            {t.status === 'en_curso' && <StatusChip tone="info">En curso</StatusChip>}
            {t.seriesId && <span title="Recurrente"><Repeat size={13} aria-label="Recurrente" /></span>}
            <SyncMark state={t._sync} configured={!!backend} />
          </div>
        </button>
        {assignee && <Avatar profile={assignee} />}
      </div>
    </li>
  );
}

export default function Tasks() {
  const { profile, profiles, categories } = useApp();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<'abiertas' | 'atrasadas' | 'completada' | ''>('abiertas');
  const [person, setPerson] = useState<string>(profile && profile.role !== 'family' ? profile.id : '');
  const [cat, setCat] = useState('');
  const [prio, setPrio] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<Task | null | undefined>(undefined);
  const tasks = useLive((r) => r.list('tasks'), [], [] as Task[]);

  useEffect(() => {
    const id = params.get('id');
    if (id && tasks.length) { const t = tasks.find((x) => x.id === id); if (t) setEditing(t); }
    if (params.get('nueva')) setEditing(null);
  }, [params, tasks.length]);

  const filter: TaskFilter = { assigneeId: person || undefined, category: cat || undefined, priority: prio || undefined, from: from || undefined, to: to || undefined, text: text || undefined,
    status: status === 'atrasadas' ? 'abiertas' : status || undefined, overdue: status === 'atrasadas' };
  const list = useMemo(() => filterTasks(tasks, filter), [tasks, JSON.stringify(filter)]);
  const groups = useMemo(() => {
    const t0 = today();
    const g: { label: string; items: Task[] }[] = [
      { label: 'Atrasadas', items: list.filter((t) => t.status !== 'completada' && t.dueDate && t.dueDate < t0) },
      { label: 'Hoy', items: list.filter((t) => t.status !== 'completada' && t.dueDate === t0) },
      { label: 'Próximas', items: list.filter((t) => t.status !== 'completada' && t.dueDate && t.dueDate > t0) },
      { label: 'Sin fecha', items: list.filter((t) => t.status !== 'completada' && !t.dueDate) },
      { label: 'Completadas', items: list.filter((t) => t.status === 'completada').sort((a, b) => ((b.completedAt ?? '') > (a.completedAt ?? '') ? 1 : -1)).slice(0, 50) },
    ];
    return g.filter((x) => x.items.length);
  }, [list]);

  const open = (t: Task) => { setEditing(t); };
  const close = () => { setEditing(undefined); if (params.get('id') || params.get('nueva')) setParams({}, { replace: true }); };

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="searchbox" style={{ flex: 1 }}>
          <input className="input" placeholder="Buscar tareas" aria-label="Buscar tareas" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={() => setEditing(null)}><Plus size={18} /> Nueva</button>
      </div>
      <div className="stack-sm" style={{ marginBottom: 12 }}>
        <ChipFilter label="Estado" value={status} onChange={(v) => setStatus(v as any)} options={[{ value: 'abiertas', label: 'Abiertas' }, { value: 'atrasadas', label: 'Atrasadas' }, { value: 'completada', label: 'Completadas' }]} />
        <PersonFilter label="Tareas de" value={person} onChange={setPerson} profiles={profiles} />
        <details className="more">
          <summary>Más filtros</summary>
          <div className="form" style={{ marginTop: 6 }}>
            <ChipFilter label="Categoría" value={cat} onChange={setCat} options={categories('tasks').map((c) => ({ value: c.id, label: c.label }))} />
            <ChipFilter label="Prioridad" value={prio} onChange={setPrio} options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))} />
            <div className="form-row">
              <label className="field"><span className="field-label">Desde</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="field"><span className="field-label">Hasta</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </div>
          </div>
        </details>
      </div>
      {groups.length === 0 && <div className="card"><Empty icon={<CheckSquare size={36} />} title={tasks.length ? 'No hay tareas con estos filtros.' : 'Todavía no hay tareas.'} action={<button className="btn" onClick={() => setEditing(null)}>Crear tarea</button>} /></div>}
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <div className="section-head"><h2 style={g.label === 'Atrasadas' ? { color: 'var(--alert-fg)' } : undefined}>{g.label} <span className="count">{g.items.length}</span></h2></div>
          <div className="card"><ul className="list">{g.items.map((t) => <TaskRow key={t.id} t={t} onOpen={open} />)}</ul></div>
        </section>
      ))}
      <p className="muted tiny" style={{ marginTop: 14 }}>Estados: {Object.values(TASK_STATUS_LABEL).join(', ')}.</p>
      <TaskSheet open={editing !== undefined} task={editing ?? null} onClose={close} />
    </div>
  );
}
