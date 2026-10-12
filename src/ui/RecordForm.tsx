// Formulario genérico a partir de una lista de campos (para registros simples como contratos o impuestos).
import { DateField, NumberField, SelectField, TextArea, TextField } from './fields';

export interface FieldDef {
  key: string; label: string; type: 'text' | 'number' | 'date' | 'select' | 'textarea'; options?: { value: string; label: string }[];
  required?: boolean; hint?: string; list?: string[]; half?: boolean;
}

export function RecordForm({ fields, value, onChange, errors }: { fields: FieldDef[]; value: Record<string, any>; onChange: (v: Record<string, any>) => void; errors?: string[] }) {
  const set = (k: string, v: any) => onChange({ ...value, [k]: v });
  const rows: FieldDef[][] = [];
  for (const f of fields) {
    const last = rows[rows.length - 1];
    if (f.half && last && last.length === 1 && last[0].half) last.push(f); else rows.push([f]);
  }
  const render = (f: FieldDef) => {
    if (f.type === 'number') return <NumberField key={f.key} label={f.label} required={f.required} hint={f.hint} value={value[f.key]} onChange={(v) => set(f.key, v)} />;
    if (f.type === 'date') return <DateField key={f.key} label={f.label} required={f.required} hint={f.hint} value={value[f.key]} onChange={(v) => set(f.key, v)} />;
    if (f.type === 'select') return <SelectField key={f.key} label={f.label} required={f.required} hint={f.hint} value={value[f.key] ?? ''} onChange={(v) => set(f.key, v || undefined)} options={[{ value: '', label: '—' }, ...(f.options ?? [])]} />;
    if (f.type === 'textarea') return <TextArea key={f.key} label={f.label} hint={f.hint} value={value[f.key]} onChange={(v) => set(f.key, v)} rows={2} />;
    return (
      <div key={f.key}>
        <TextField label={f.label} required={f.required} hint={f.hint} value={value[f.key]} onChange={(v) => set(f.key, v)} />
        {f.list && <div className="chips-toggle" style={{ marginTop: 6 }}>{f.list.map((o) => <button type="button" key={o} aria-pressed={value[f.key] === o} onClick={() => set(f.key, o)}>{o}</button>)}</div>}
      </div>
    );
  };
  return (
    <div className="form">
      {errors && errors.length > 0 && <div className="banner banner-alert" role="alert">{errors.join(' ')}</div>}
      {rows.map((r, i) => (r.length === 2 ? <div key={i} className="form-row">{r.map(render)}</div> : render(r[0])))}
    </div>
  );
}
