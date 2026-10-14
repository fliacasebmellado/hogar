import { useEffect, useMemo, useState } from 'react';
import { Plus, Lock, ImagePlus, X } from 'lucide-react';
import { isPhotoAvatar, photoToAvatar } from '../../services/avatarPhoto';
import { useApp, useLive } from '../../app/context';
import type { CalendarEvent, DocumentRecord, Profile, Task } from '../../domain/types';
import { Avatar, Banner, Empty, StatusChip } from '../../ui/components';
import { Sheet } from '../../ui/Sheet';
import { Checkbox, SelectField, TextField, NumberField, DateField } from '../../ui/fields';
import { PROFILE_COLORS } from '../../domain/catalog';
import { hashPin, canSeeDocument } from '../../domain/permissions';
import { addDays, relativeDay, today } from '../../domain/dates';
import { expandEvents } from '../../services/events';
import { DEFAULT_HOME_BLOCKS } from '../../services/seed';
import { HOME_BLOCK_LABEL } from '../home/Home';

export default function Family() {
  const { profiles, profile, can } = useApp();
  const [selected, setSelected] = useState<string>(profile?.id ?? '');
  const [editing, setEditing] = useState<Profile | null | undefined>(undefined);
  const visibleProfiles = profiles.filter((p) => p.active || can('profiles.manage'));
  const sel = profiles.find((p) => p.id === selected) ?? profile;
  return (
    <div>
      <div className="chips-toggle" role="tablist" aria-label="Integrantes" style={{ marginBottom: 12 }}>
        {visibleProfiles.map((p) => (
          <button key={p.id} role="tab" aria-selected={sel?.id === p.id} aria-pressed={sel?.id === p.id} onClick={() => setSelected(p.id)}>
            <Avatar profile={p} size={22} /> {p.name}{!p.active ? ' (inactivo)' : ''}
          </button>
        ))}
        {can('profiles.manage') && <button onClick={() => setEditing(null)}><Plus size={16} /> Agregar</button>}
      </div>
      {sel && <ProfileDetail p={sel} onEdit={() => setEditing(sel)} />}
      <ProfileSheet open={editing !== undefined} profile={editing ?? null} onClose={() => setEditing(undefined)} />
    </div>
  );
}

function ProfileDetail({ p, onEdit }: { p: Profile; onEdit: () => void }) {
  const { can, profile, permissions } = useApp();
  const data = useLive(async (r) => {
    const [events, tasks, docs] = await Promise.all([r.list('events'), r.list('tasks'), r.list('documents')]);
    return { events, tasks, docs };
  }, [], { events: [] as CalendarEvent[], tasks: [] as Task[], docs: [] as DocumentRecord[] });
  const all = p.role === 'family'; // el perfil Familia reúne lo de todos
  const agenda = useMemo(() => expandEvents(data.events.filter((e) => all || e.participantIds?.includes(p.id) || e.ownerId === p.id), today(), addDays(today(), 14)), [data.events, p.id]);
  const myTasks = data.tasks.filter((t) => !t.isSeries && t.status !== 'completada' && (all || t.assigneeId === p.id || t.collaboratorIds?.includes(p.id))).sort((a, b) => ((a.dueDate ?? '9') < (b.dueDate ?? '9') ? -1 : 1));
  const done7 = data.tasks.filter((t) => (all ? !!t.completedBy : t.completedBy === p.id) && (t.completedAt ?? '') >= addDays(today(), -7)).length;
  const docs = data.docs.filter((d) => d.personId === p.id && canSeeDocument(profile, d, permissions));
  const canEdit = can('profiles.manage') || profile?.id === p.id;
  return (
    <div className="stack">
      <div className="card card-pad row">
        <Avatar profile={p} large />
        <div style={{ flex: 1 }}>
          <h2>{p.name}</h2>
          <p className="muted small">{p.role === 'adult' ? 'Adulto' : p.role === 'family' ? 'Todos juntos: agenda y tareas de toda la familia' : 'Chico/a'}{p.prefs?.simpleMode ? ' · vista simple' : ''}{p.pinHash ? ' · con PIN' : ''}</p>
        </div>
        {canEdit && <button className="btn btn-sm" onClick={onEdit}>Editar</button>}
      </div>
      <div className="stat-row">
        <div className="stat"><div className="n">{myTasks.length}</div><div className="l">Tareas abiertas</div></div>
        <div className="stat"><div className="n">{myTasks.filter((t) => t.dueDate && t.dueDate < today()).length}</div><div className="l">Atrasadas</div></div>
        <div className="stat"><div className="n">{done7}</div><div className="l">Hechas en 7 días</div></div>
      </div>
      <section>
        <div className="section-head"><h2>Agenda personal (14 días)</h2></div>
        {agenda.length ? <div className="card"><ul className="list">{agenda.slice(0, 10).map((i, n) => (
          <li key={n}><a className="item" href={`#/agenda?id=${i.event.id}`}><span className="time-col">{relativeDay(i.date)}</span><div className="item-main"><div className="item-title">{i.event.title}</div><div className="item-sub">{i.event.allDay ? 'Todo el día' : i.start.slice(11, 16)}</div></div></a></li>
        ))}</ul></div> : <p className="muted small">Sin eventos próximos.</p>}
      </section>
      <section>
        <div className="section-head"><h2>Tareas y responsabilidades</h2></div>
        {myTasks.length ? <div className="card"><ul className="list">{myTasks.slice(0, 12).map((t) => (
          <li key={t.id}><a className="item" href={`#/tareas?id=${t.id}`}><div className="item-main"><div className="item-title">{t.title}</div><div className="item-sub">{t.dueDate ? relativeDay(t.dueDate) : 'Sin fecha'}{t.seriesId ? ' · recurrente' : ''}</div></div>{t.dueDate && t.dueDate < today() && <StatusChip tone="alert">Atrasada</StatusChip>}</a></li>
        ))}</ul></div> : <p className="muted small">No tiene tareas abiertas.</p>}
      </section>
      <section>
        <div className="section-head"><h2>Información autorizada</h2></div>
        {docs.length ? <div className="card"><ul className="list">{docs.map((d) => <li key={d.id}><a className="item" href={`#/documentos?id=${d.id}`}><div className="item-main"><div className="item-title">{d.name}</div><div className="item-sub">{d.category}</div></div>{d.visibility !== 'familia' && <Lock size={14} aria-label="Restringido" />}</a></li>)}</ul></div>
          : <p className="muted small">No hay documentos visibles vinculados a {p.name}.</p>}
      </section>
    </div>
  );
}

function ProfileSheet({ open, profile: target, onClose }: { open: boolean; profile: Profile | null; onClose: () => void }) {
  const { repo, profile, profiles, run, can } = useApp();
  const [d, setD] = useState<Partial<Profile>>({});
  const [pin, setPin] = useState('');
  const [aliases, setAliases] = useState('');
  useEffect(() => {
    if (!open) return;
    const base: Partial<Profile> = target ? { ...target } : { name: '', role: 'adult', color: PROFILE_COLORS[profiles.length % PROFILE_COLORS.length], avatar: '', active: true, aliases: [], prefs: { homeBlocks: DEFAULT_HOME_BLOCKS, simpleMode: false, notifyLeadMinutes: 60 } };
    setD(base); setPin(''); setAliases((base.aliases ?? []).join(', '));
  }, [open, target?.id]);
  const manage = can('profiles.manage');
  const prefs = d.prefs ?? {};
  const setPrefs = (p: Partial<NonNullable<Profile['prefs']>>) => setD({ ...d, prefs: { ...prefs, ...p } });
  const blocks = prefs.homeBlocks ?? DEFAULT_HOME_BLOCKS;
  const save = async () => {
    const { id, version, createdAt, updatedAt, rev, _sync, ...data } = d as any;
    data.aliases = aliases.split(',').map((s: string) => s.trim()).filter(Boolean);
    if (!isPhotoAvatar(data.avatar)) data.avatar = (data.avatar || data.name?.charAt(0) || '?').slice(0, 2);
    if (pin) data.pinHash = await hashPin(pin, target?.id ?? 'nuevo');
    const ok = await run(async () => {
      if (target) return repo.update('profiles', target.id, data, { by: profile?.id });
      const created = await repo.create('profiles', data, { by: profile?.id });
      if (pin) await repo.update('profiles', created.id, { pinHash: await hashPin(pin, created.id) }, { by: profile?.id, skipHistory: true });
      return created;
    }, target ? 'Perfil actualizado' : 'Perfil agregado');
    if (ok) onClose();
  };
  const move = (k: string, dir: -1 | 1) => {
    const arr = [...blocks]; const i = arr.indexOf(k); const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setPrefs({ homeBlocks: arr });
  };
  return (
    <Sheet open={open} onClose={onClose} title={target ? `Editar perfil de ${target.name}` : 'Nuevo integrante'}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <div className="form">
        <TextField label="Nombre" required value={d.name} onChange={(v) => setD({ ...d, name: v })} />
        <div className="field">
          <span className="field-label">Foto o inicial</span>
          <div className="avatar-edit">
            <Avatar profile={{ name: d.name || '?', color: d.color || '#c3bdaf', avatar: d.avatar ?? '' }} size={72} />
            <div className="row-wrap">
              <label className="btn btn-sm"><ImagePlus size={16} /> {isPhotoAvatar(d.avatar) ? 'Cambiar foto' : 'Subir foto'}
                <input type="file" accept="image/*" className="sr-only" onChange={async (e) => {
                  const f = e.target.files?.[0]; e.target.value = '';
                  if (f) await run(async () => setD({ ...d, avatar: await photoToAvatar(f, d.role === 'family') }), 'Foto lista: tocá Guardar');
                }} />
              </label>
              {isPhotoAvatar(d.avatar) && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setD({ ...d, avatar: d.name?.charAt(0) ?? '' })}><X size={16} /> Quitar foto</button>}
            </div>
          </div>
          <span className="hint">La foto se guarda en la planilla privada de la familia y se ve en todos los dispositivos conectados.</span>
        </div>
        <div className="form-row">
          {!isPhotoAvatar(d.avatar) && <TextField label="Inicial o emoji" value={d.avatar} onChange={(v) => setD({ ...d, avatar: v })} />}
          {manage && <SelectField label="Tipo de perfil" value={d.role} onChange={(v) => setD({ ...d, role: v as any })} options={[{ value: 'adult', label: 'Adulto' }, { value: 'child', label: 'Chico/a' }, { value: 'family', label: 'Familia (todos juntos)' }]} />}
        </div>
        <div className="field" role="group" aria-label="Color identificador">
          <span className="field-label">Color</span>
          <div className="chips-toggle">{PROFILE_COLORS.map((c) => <button key={c} type="button" aria-pressed={d.color === c} aria-label={`Color ${c}`} onClick={() => setD({ ...d, color: c })} style={{ background: c, width: 36 }} />)}</div>
        </div>
        <TextField label="Otros nombres (para el asistente)" value={aliases} onChange={setAliases} hint="Separados por coma. Ej.: papi, un apodo" />
        <DateField label="Cumpleaños (opcional)" value={d.birthDate} onChange={(v) => setD({ ...d, birthDate: v })} />
        <h3>Visualización</h3>
        <Checkbox label="Vista simple (recomendada para chicos)" checked={!!prefs.simpleMode} onChange={(v) => setPrefs({ simpleMode: v })} />
        <NumberField label="Aviso de eventos (minutos antes)" value={prefs.notifyLeadMinutes} onChange={(v) => setPrefs({ notifyLeadMinutes: v })} />
        <div className="field">
          <span className="field-label">Bloques de Inicio (orden y visibilidad)</span>
          {DEFAULT_HOME_BLOCKS.map((k) => {
            const on = blocks.includes(k);
            return (
              <div key={k} className="row small">
                <Checkbox label={HOME_BLOCK_LABEL[k] ?? k} checked={on} onChange={(v) => setPrefs({ homeBlocks: v ? [...blocks, k] : blocks.filter((x) => x !== k) })} />
                <span className="spacer" />
                {on && <><button type="button" className="btn btn-sm btn-ghost" aria-label={`Subir ${HOME_BLOCK_LABEL[k]}`} onClick={() => move(k, -1)}>↑</button><button type="button" className="btn btn-sm btn-ghost" aria-label={`Bajar ${HOME_BLOCK_LABEL[k]}`} onClick={() => move(k, 1)}>↓</button></>}
              </div>
            );
          })}
        </div>
        {(d.role === 'adult') && (
          <>
            <TextField label={d.pinHash ? 'Cambiar PIN (opcional)' : 'PIN para entrar a este perfil (opcional)'} type="password" inputMode="numeric" value={pin} onChange={setPin} hint="Disuade a los chicos de entrar a un perfil adulto. No es una contraseña segura." />
            {d.pinHash && <button type="button" className="btn btn-sm" onClick={() => setD({ ...d, pinHash: undefined })}>Quitar PIN</button>}
          </>
        )}
        {manage && target && target.id !== profile?.id && <Checkbox label="Perfil activo" checked={d.active !== false} onChange={(v) => setD({ ...d, active: v })} hint="Desactivar conserva su historial" />}
        <Banner tone="info">El modo familiar comparte una sola cuenta: el perfil organiza la vista y sugiere responsables, pero no es una identidad autenticada.</Banner>
      </div>
    </Sheet>
  );
}

export { Empty };
