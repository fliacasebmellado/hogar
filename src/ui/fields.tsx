// Campos de formulario accesibles (label asociado, errores anunciados) y selectores reutilizables.
import { useId, type ReactNode } from 'react';
import type { Profile, Recurrence } from '../domain/types';
import type { Category } from '../domain/catalog';
import { Avatar } from './components';
import { WEEKDAYS_ES } from '../domain/dates';

interface BaseProps { label: string; hint?: string; error?: string; required?: boolean }

export function Field(p: BaseProps & { children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{p.label}{p.required && <span aria-hidden="true"> *</span>}</label>
      {p.children(id)}
      {p.hint && <span className="hint">{p.hint}</span>}
      {p.error && <span className="error" role="alert">{p.error}</span>}
    </div>
  );
}

export function TextField(p: BaseProps & { value?: string; onChange: (v: string) => void; type?: string; placeholder?: string; autoFocus?: boolean; inputMode?: any; name?: string; autoComplete?: string }) {
  return (
    <Field {...p}>{(id) => (
      <input id={id} name={p.name} className="input" type={p.type ?? 'text'} value={p.value ?? ''} placeholder={p.placeholder} autoFocus={p.autoFocus}
        inputMode={p.inputMode} required={p.required} aria-invalid={!!p.error} autoComplete={p.autoComplete ?? 'off'} onChange={(e) => p.onChange(e.target.value)} />
    )}</Field>
  );
}

export function TextArea(p: BaseProps & { value?: string; onChange: (v: string) => void; placeholder?: string; rows?: number; autoFocus?: boolean }) {
  return (
    <Field {...p}>{(id) => (
      <textarea id={id} className="input" rows={p.rows ?? 3} value={p.value ?? ''} placeholder={p.placeholder} autoFocus={p.autoFocus}
        aria-invalid={!!p.error} onChange={(e) => p.onChange(e.target.value)} />
    )}</Field>
  );
}

export function NumberField(p: BaseProps & { value?: number; onChange: (v: number | undefined) => void; step?: string; placeholder?: string }) {
  return (
    <Field {...p}>{(id) => (
      <input id={id} className="input" type="number" inputMode="decimal" step={p.step ?? 'any'} min="0" value={p.value ?? ''} placeholder={p.placeholder}
        aria-invalid={!!p.error} onChange={(e) => p.onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
    )}</Field>
  );
}

export function SelectField<T extends string>(p: BaseProps & { value?: T | ''; onChange: (v: T) => void; options: { value: T | ''; label: string }[] }) {
  return (
    <Field {...p}>{(id) => (
      <select id={id} className="input" value={p.value ?? ''} aria-invalid={!!p.error} onChange={(e) => p.onChange(e.target.value as T)}>
        {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )}</Field>
  );
}

export function DateField(p: BaseProps & { value?: string; onChange: (v: string | undefined) => void }) {
  return (
    <Field {...p}>{(id) => (
      <input id={id} className="input" type="date" value={p.value ?? ''} aria-invalid={!!p.error} onChange={(e) => p.onChange(e.target.value || undefined)} />
    )}</Field>
  );
}
export function TimeField(p: BaseProps & { value?: string; onChange: (v: string | undefined) => void }) {
  return (
    <Field {...p}>{(id) => (
      <input id={id} className="input" type="time" value={p.value ?? ''} onChange={(e) => p.onChange(e.target.value || undefined)} />
    )}</Field>
  );
}

export function Checkbox(p: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="checkbox-row">
      <input type="checkbox" checked={p.checked} onChange={(e) => p.onChange(e.target.checked)} />
      <span>{p.label}{p.hint && <span className="muted small"> — {p.hint}</span>}</span>
    </label>
  );
}

export function CategorySelect(p: { label?: string; value?: string; onChange: (v: string) => void; categories: Category[]; required?: boolean; error?: string }) {
  return <SelectField label={p.label ?? 'Categoría'} value={p.value ?? ''} onChange={p.onChange} required={p.required} error={p.error}
    options={[{ value: '', label: 'Elegir…' }, ...p.categories.map((c) => ({ value: c.id, label: c.label }))]} />;
}

export function PersonSelect(p: { label: string; value?: string; onChange: (v: string | undefined) => void; profiles: Profile[]; allowEmpty?: boolean; hint?: string }) {
  return <SelectField label={p.label} hint={p.hint} value={p.value ?? ''} onChange={(v) => p.onChange(v || undefined)}
    options={[...(p.allowEmpty !== false ? [{ value: '', label: 'Sin asignar' }] : []), ...p.profiles.filter((x) => x.active || x.id === p.value).map((x) => ({ value: x.id, label: x.name }))]} />;
}

/** Selección múltiple de integrantes con chips táctiles. */
export function PeoplePicker(p: { label: string; value: string[]; onChange: (v: string[]) => void; profiles: Profile[] }) {
  const id = useId();
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <span id={id} className="field-label">{p.label}</span>
      <div className="chips-toggle">
        {p.profiles.filter((x) => x.active && x.role !== 'family').map((x) => {
          const on = p.value.includes(x.id);
          return (
            <button key={x.id} type="button" aria-pressed={on} onClick={() => p.onChange(on ? p.value.filter((v) => v !== x.id) : [...p.value, x.id])}>
              <Avatar profile={x} size={20} /> {x.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RecurrenceField(p: { value?: Recurrence | null; onChange: (v: Recurrence | null) => void; label?: string; hint?: string }) {
  const r = p.value;
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{p.label ?? 'Repetición'}</label>
      <div className="form-row">
        <select id={id} className="input" value={r?.freq ?? ''} onChange={(e) => p.onChange(e.target.value ? { freq: e.target.value as Recurrence['freq'], interval: r?.interval ?? 1 } : null)}>
          <option value="">No se repite</option>
          <option value="daily">Diaria</option>
          <option value="weekly">Semanal</option>
          <option value="monthly">Mensual</option>
          <option value="yearly">Anual</option>
        </select>
        {r && (
          <label className="row small" style={{ gap: 6 }}>
            <span>Cada</span>
            <input className="input" style={{ width: 70 }} type="number" min={1} max={365} value={r.interval} aria-label="Intervalo"
              onChange={(e) => p.onChange({ ...r, interval: Math.max(1, Number(e.target.value) || 1) })} />
            <span>{{ daily: 'día(s)', weekly: 'semana(s)', monthly: 'mes(es)', yearly: 'año(s)' }[r.freq]}</span>
          </label>
        )}
      </div>
      {r?.freq === 'weekly' && (
        <div className="chips-toggle" role="group" aria-label="Días de la semana">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const on = r.byWeekday?.includes(d) ?? false;
            return <button key={d} type="button" aria-pressed={on} onClick={() => p.onChange({ ...r, byWeekday: on ? r.byWeekday!.filter((x) => x !== d) : [...(r.byWeekday ?? []), d] })}>{WEEKDAYS_ES[d].slice(0, 3)}</button>;
          })}
        </div>
      )}
      {r && (
        <div className="form-row">
          <input className="input" type="date" aria-label="Repetir hasta" value={r.until ?? ''} onChange={(e) => p.onChange({ ...r, until: e.target.value || undefined })} />
          <span className="hint" style={{ alignSelf: 'center' }}>Hasta (opcional)</span>
        </div>
      )}
      {p.hint && <span className="hint">{p.hint}</span>}
    </div>
  );
}
