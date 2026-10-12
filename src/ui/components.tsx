import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CloudOff, Info, Check } from 'lucide-react';
import type { Profile, SyncState } from '../domain/types';
import type { Category } from '../domain/catalog';
import { onColor } from './theme';

export function Avatar({ profile, size, large }: { profile?: Pick<Profile, 'name' | 'color' | 'avatar'>; size?: number; large?: boolean }) {
  if (!profile) return <span className="avatar" style={{ background: 'var(--surface-3)' }} aria-hidden="true">?</span>;
  const style: React.CSSProperties = { background: profile.color, color: onColor(profile.color) };
  if (size) Object.assign(style, { width: size, height: size, fontSize: size * 0.45, borderWidth: 0 });
  return <span className={`avatar${large ? ' avatar-lg' : ''}`} style={style} aria-hidden="true">{profile.avatar || profile.name.charAt(0)}</span>;
}

export function AvatarStack({ ids, profiles }: { ids: string[]; profiles: Profile[] }) {
  const ps = ids.map((id) => profiles.find((p) => p.id === id)).filter(Boolean) as Profile[];
  if (!ps.length) return null;
  return <span className="avatar-stack" aria-label={ps.map((p) => p.name).join(', ')}>{ps.slice(0, 4).map((p) => <Avatar key={p.id} profile={p} />)}</span>;
}

export function CategoryChip({ id, categories }: { id?: string; categories: Category[] }) {
  if (!id) return null;
  const c = categories.find((x) => x.id === id);
  return <span className="chip chip-cat" style={{ background: c?.color ?? 'var(--surface-3)' }}>{c?.label ?? id}</span>;
}

export function StatusChip({ tone, children }: { tone: 'ok' | 'warn' | 'alert' | 'info' | 'neutral'; children: ReactNode }) {
  return <span className={`chip ${tone === 'neutral' ? '' : `chip-${tone}`}`}>{children}</span>;
}

/** Indica si el registro aún no llegó a Google (no depende solo del color: incluye texto). */
export function SyncMark({ state, configured }: { state?: SyncState; configured: boolean }) {
  if (!configured || !state || state === 'synced') return null;
  if (state === 'conflict') return <span className="rec-sync" style={{ color: 'var(--alert-fg)' }}>· conflicto</span>;
  if (state === 'error') return <span className="rec-sync" style={{ color: 'var(--alert-fg)' }}>· error de sync</span>;
  return <span className="rec-sync" title="Guardado en este dispositivo; todavía no llegó a Google">· sin sincronizar</span>;
}

export function Banner({ tone, children, icon }: { tone: 'info' | 'warn' | 'alert' | 'ok'; children: ReactNode; icon?: ReactNode }) {
  const I = tone === 'ok' ? CheckCircle2 : tone === 'info' ? Info : tone === 'warn' ? AlertTriangle : CloudOff;
  return <div className={`banner banner-${tone}`} role={tone === 'alert' ? 'alert' : 'status'}>{icon ?? <I size={18} />}<div>{children}</div></div>;
}

export function Empty({ icon, title, action }: { icon?: ReactNode; title: string; action?: ReactNode }) {
  return <div className="empty">{icon}<p>{title}</p>{action}</div>;
}

export function SectionHead({ title, to, linkLabel, action }: { title: string; to?: string; linkLabel?: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {to ? <Link to={to}>{linkLabel ?? 'Ver todo'}</Link> : action}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; badge?: number }[]; label: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}{o.badge ? ` (${o.badge})` : ''}
        </button>
      ))}
    </div>
  );
}

export function ChipFilter<T extends string>({ value, onChange, options, label }: { value: T | ''; onChange: (v: T | '') => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div className="chips-toggle" role="group" aria-label={label}>
      <button type="button" aria-pressed={value === ''} onClick={() => onChange('')}>Todos</button>
      {options.map((o) => <button type="button" key={o.value} aria-pressed={value === o.value} onClick={() => onChange(value === o.value ? '' : o.value)}>{o.label}</button>)}
    </div>
  );
}

export function CheckButton({ on, onClick, label, square }: { on: boolean; onClick: () => void; label: string; square?: boolean }) {
  return (
    <button type="button" className={`check${on ? ' on' : ''}${square ? ' square' : ''}`} aria-pressed={on} aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {on && <Check size={16} strokeWidth={3} />}
    </button>
  );
}

export function PageActions({ children }: { children: ReactNode }) {
  return <div className="row-wrap" style={{ marginBottom: 12 }}>{children}</div>;
}

/** Filtro por integrante con avatares; "Todos" muestra lo de toda la familia junto. */
export function PersonFilter({ value, onChange, profiles, label = 'Ver de' }: { value: string; onChange: (v: string) => void; profiles: Profile[]; label?: string }) {
  const people = profiles.filter((p) => p.active && p.role !== 'family');
  return (
    <div className="chips-toggle" role="group" aria-label={label}>
      <button type="button" aria-pressed={value === ''} onClick={() => onChange('')}>👪 Todos</button>
      {people.map((p) => (
        <button type="button" key={p.id} aria-pressed={value === p.id} onClick={() => onChange(value === p.id ? '' : p.id)}>
          <Avatar profile={p} size={20} /> {p.name}
        </button>
      ))}
    </div>
  );
}

/** Fila de perfiles para cambiar rápido (en el encabezado de Inicio). */
export function ProfileStrip({ profiles, currentId, onPick }: { profiles: Profile[]; currentId?: string; onPick: (p: Profile) => void }) {
  return (
    <div className="pstrip" role="group" aria-label="Cambiar de perfil">
      {profiles.filter((p) => p.active).map((p) => (
        <button key={p.id} type="button" aria-pressed={p.id === currentId} onClick={() => onPick(p)} aria-label={`Ver como ${p.name}`}>
          <span className="ring"><Avatar profile={p} /></span>
          <span className="pname">{p.role === 'family' ? 'Todos' : p.name}</span>
        </button>
      ))}
    </div>
  );
}
