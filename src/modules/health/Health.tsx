// Salud (solo adultos): medicación del día, tratamientos con sus horarios, indicaciones médicas (y planes para una
// crisis), calendario de vacunas y cartilla de médicos.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Copy, Pencil, Plus, Camera, FileText, Phone, MessageCircle, MapPin, BellRing, Check, SkipForward, Pill, Syringe, Stethoscope, ClipboardList, Paperclip } from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import type { Doctor, DoseLog, HealthCard, HealthNote, Medication, Profile, Treatment, Vaccination } from '../../domain/types';
import { Avatar, Banner, Empty, PersonFilter, Segmented, StatusChip } from '../../ui/components';
import { Sheet, ConfirmSheet } from '../../ui/Sheet';
import { Checkbox, DateField, NumberField, PersonSelect, SelectField, TextArea, TextField, TimeField } from '../../ui/fields';
import { FilePickButton, useOpenAttachment } from '../../ui/records';
import { formatDate, today } from '../../domain/dates';
import { storeFile } from '../../services/files';
import { documentFolder } from '../../services/folders';
import { ocrImage } from '../../ai/processors';
import { NOTE_KINDS, buildDoseCalendar, doseSchedule, dosesBetween, localStamp, noteKind, parsePrescription, progress, timesFromInterval, type ParsedPrescription } from '../../services/health';
import { VACCINE_SOURCE, VACCINE_SOURCE_URL, VACCINE_STATE_LABEL, ensureVaccinePlan, hasFullBirthDate, markPastAsApplied, vaccineState } from '../../services/vaccines';

type Tab = 'fichas' | 'hoy' | 'tratamientos' | 'indicaciones' | 'vacunas' | 'cartilla';
const nameOf = (profiles: Profile[], id?: string) => profiles.find((p) => p.id === id)?.name ?? '';

export default function Health() {
  const { profile, profiles, repo } = useApp();
  const [params, setParams] = useSearchParams();
  const [tab, setTabState] = useState<Tab>((params.get('tab') as Tab) || 'fichas');
  const setTab = (t: Tab) => { setTabState(t); setParams(t === 'fichas' ? {} : { tab: t }, { replace: true }); };
  const [person, setPerson] = useState('');
  const notes = useLive((r) => r.list('healthNotes'), [], [] as HealthNote[]);
  const treatments = useLive((r) => r.list('treatments'), [], [] as Treatment[]);
  const meds = useLive((r) => r.list('medications'), [], [] as Medication[]);
  const logs = useLive((r) => r.list('doseLogs'), [], [] as DoseLog[]);
  const vaccines = useLive((r) => r.list('vaccinations'), [], [] as Vaccination[]);
  const doctors = useLive((r) => r.list('doctors'), [], [] as Doctor[]);
  const cards = useLive((r) => r.list('healthCards'), [], [] as HealthCard[]);
  const [openNote, setOpenNote] = useState<HealthNote | null | undefined>(undefined);
  const [openTreatment, setOpenTreatment] = useState<{ t: Treatment | null; draft?: ParsedPrescription; photo?: File } | undefined>(undefined);
  const people = profiles.filter((p) => p.active && p.role !== 'family');
  const mine = <T extends { personId?: string }>(l: T[]) => (person ? l.filter((x) => x.personId === person) : l);
  const plans = mine(notes.filter((n) => n.pinned));

  useEffect(() => { ensureVaccinePlan(repo, profiles, profile?.id).catch(() => {}); }, [profiles.map((p) => `${p.id}:${p.birthDate}`).join(',')]);

  return (
    <div className="health">
      <PersonFilter value={person} onChange={setPerson} profiles={profiles} label="Ver la salud de" />
      {plans.length > 0 && (
        <div className="crisis-list">
          {plans.map((n) => (
            <button key={n.id} type="button" className="crisis-card" onClick={() => setOpenNote(n)}>
              <span className="crisis-ico" aria-hidden="true">🚨</span>
              <span><strong>{n.title}</strong><span className="sub">{nameOf(profiles, n.personId) || 'Familia'} · qué hacer</span></span>
            </button>
          ))}
        </div>
      )}
      <div className="tabs-scroll" style={{ margin: '14px 0' }}>
        <Segmented label="Secciones de salud" value={tab} onChange={setTab} options={[
          { value: 'fichas', label: 'Fichas' }, { value: 'hoy', label: 'Medicación' }, { value: 'tratamientos', label: 'Tratamientos' }, { value: 'indicaciones', label: 'Indicaciones' },
          { value: 'vacunas', label: 'Vacunas', badge: mine(vaccines).filter((v) => !v.deleted && vaccineState(v) === 'toca_ahora').length }, { value: 'cartilla', label: 'Cartilla' },
        ]} />
      </div>
      {tab === 'fichas' && <Cards people={person ? people.filter((p) => p.id === person) : people} cards={cards} doctors={doctors} />}
      {tab === 'hoy' && <Today meds={meds} logs={logs} treatments={treatments} person={person} onNew={(t) => setOpenTreatment(t)} />}
      {tab === 'tratamientos' && <Treatments list={mine(treatments)} meds={meds} logs={logs} onOpen={(t) => setOpenTreatment({ t })} onNew={(t) => setOpenTreatment(t)} />}
      {tab === 'indicaciones' && <Notes list={mine(notes)} onOpen={setOpenNote} />}
      {tab === 'vacunas' && <Vaccines list={vaccines} people={person ? people.filter((p) => p.id === person) : people} notes={notes} />}
      {tab === 'cartilla' && <Doctors list={doctors.filter((d) => !person || (d.personIds ?? []).includes(person))} />}
      <NoteSheet note={openNote} defaultPerson={person} cards={cards} onClose={() => setOpenNote(undefined)} />
      {openTreatment && <TreatmentSheet init={openTreatment} meds={meds} defaultPerson={person} onClose={() => setOpenTreatment(undefined)} />}
    </div>
  );
}

// ---------------- Medicación de hoy ----------------
function Today({ meds, logs, treatments, person, onNew }: { meds: Medication[]; logs: DoseLog[]; treatments: Treatment[]; person: string; onNew: (t: { t: null; draft?: ParsedPrescription; photo?: File }) => void }) {
  const { repo, profile, profiles, run } = useApp();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 6);
  const relevant = meds.filter((m) => !person || (m.personId ?? treatments.find((t) => t.id === m.treatmentId)?.personId) === person);
  const items = dosesBetween(relevant, logs, treatments, start, end, now).filter((d) => d.plannedAt.slice(0, 10) === today() || d.status === 'atrasada');
  const mark = (medId: string, plannedAt: string, skipped = false) => run(() => repo.create('doseLogs', { medicationId: medId, plannedAt, takenAt: localStamp(new Date()), by: profile?.id, skipped }, { by: profile?.id }), skipped ? 'Toma salteada' : 'Toma marcada como dada');
  const undo = (log: DoseLog) => run(() => repo.remove('doseLogs', log.id, { by: profile?.id }), 'Se desmarcó la toma');
  const asNeeded = relevant.filter((m) => !m.deleted && m.status === 'activo' && m.asNeeded);
  return (
    <div className="stack">
      <ImportButtons onNew={onNew} />
      {items.length === 0 && asNeeded.length === 0 ? (
        <div className="card"><Empty icon={<Pill size={36} />} title="No hay medicación para hoy." /></div>
      ) : (
        <div className="card"><ul className="list">
          {items.map((d) => {
            const who = nameOf(profiles, d.med.personId ?? d.treatment?.personId);
            return (
              <li key={d.med.id + d.plannedAt} className={`item dose dose-${d.status}`}>
                <span className="dose-time">{d.plannedAt.slice(11)}</span>
                <div className="item-main">
                  <div className="item-title">{d.med.name}{d.med.dose ? <span className="muted"> · {d.med.dose}</span> : null}</div>
                  <div className="item-sub">{who}{d.treatment?.diagnosis ? ` · ${d.treatment.diagnosis}` : ''}{d.plannedAt.slice(0, 10) !== today() ? ` · ${formatDate(d.plannedAt.slice(0, 10))}` : ''}{d.log?.takenAt ? ` · dada ${d.log.takenAt.slice(11)}` : ''}</div>
                </div>
                {d.log ? (
                  <button className="btn btn-sm btn-ghost" onClick={() => undo(d.log!)}>{d.log.skipped ? 'Salteada' : <><Check size={14} /> Dada</>}</button>
                ) : (
                  <div className="row" style={{ gap: 6 }}>
                    <button className="icon-btn" aria-label={`Saltear ${d.med.name} de las ${d.plannedAt.slice(11)}`} onClick={() => mark(d.med.id, d.plannedAt, true)}><SkipForward size={16} /></button>
                    <button className="btn btn-sm btn-primary" onClick={() => mark(d.med.id, d.plannedAt)}><Check size={14} /> Dar</button>
                  </div>
                )}
              </li>
            );
          })}
          {asNeeded.map((m) => (
            <li key={m.id} className="item"><span className="dose-time">SOS</span><div className="item-main"><div className="item-title">{m.name}{m.dose ? <span className="muted"> · {m.dose}</span> : null}</div><div className="item-sub">Solo si hace falta{m.notes ? ` · ${m.notes}` : ''}</div></div></li>
          ))}
        </ul></div>
      )}
      <AlarmsButton meds={relevant} treatments={treatments} />
    </div>
  );
}

function ImportButtons({ onNew }: { onNew: (t: { t: null; draft?: ParsedPrescription; photo?: File }) => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState('');
  const [textOpen, setTextOpen] = useState(false);
  const [text, setText] = useState('');
  const fromPhoto = async (f: File) => {
    setBusy('Leyendo la indicación…');
    try {
      const t = await ocrImage(f, (m) => setBusy(m));
      onNew({ t: null, draft: parsePrescription(t), photo: f });
    } catch (e: any) {
      toast(`No se pudo leer la foto (${e?.message ?? e}). Podés cargarla a mano: la foto queda adjunta igual.`, { tone: 'error' });
      onNew({ t: null, photo: f });
    } finally { setBusy(''); }
  };
  return (
    <div className="card card-pad stack-sm">
      <div className="row-wrap">
        <FilePickButton label="Foto de la indicación" accept="image/*" capture="environment" multiple={false} onFiles={(f) => f[0] && fromPhoto(f[0])} />
        <button className="btn btn-sm" onClick={() => setTextOpen(!textOpen)}><FileText size={16} /> Pegar o escribir</button>
        <button className="btn btn-sm" onClick={() => onNew({ t: null })}><Plus size={16} /> Cargar a mano</button>
      </div>
      {busy && <p className="muted small" role="status">{busy}</p>}
      {textOpen && (
        <div className="stack-sm">
          <TextArea label="Texto de la indicación" value={text} onChange={setText} rows={4} placeholder={'Ej.:\nAmoxicilina 500 mg cada 8 horas por 7 días\nIbuprofeno 5 ml si fiebre'} />
          <button className="btn btn-primary btn-sm" onClick={() => { onNew({ t: null, draft: parsePrescription(text) }); setText(''); setTextOpen(false); }}>Interpretar</button>
        </div>
      )}
      <p className="tiny muted">La foto se lee en este celular. Siempre vas a poder revisar y corregir antes de guardar (la letra manuscrita a veces no se entiende).</p>
    </div>
  );
}

function AlarmsButton({ meds, treatments }: { meds: Medication[]; treatments: Treatment[] }) {
  const { profiles } = useApp();
  const active = meds.filter((m) => !m.deleted && m.status === 'activo' && !m.asNeeded && treatments.find((t) => t.id === m.treatmentId && t.status !== 'terminado'));
  if (!active.length) return null;
  const download = () => {
    const now = localStamp(new Date());
    const items = active.map((m) => ({ med: m, personName: nameOf(profiles, m.personId ?? treatments.find((t) => t.id === m.treatmentId)?.personId), times: doseSchedule(m).filter((s) => s >= now) }));
    const blob = new Blob([buildDoseCalendar(items)], { type: 'text/calendar' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'hogar-medicacion.ics'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  return (
    <div className="card card-pad stack-sm">
      <button className="btn btn-block" onClick={download}><BellRing size={16} /> Alarmas en el calendario del celular</button>
      <p className="tiny muted">Descarga las próximas tomas como citas con alarma. Abrí el archivo con Google Calendar (Android) o Calendario (iPhone): suena aunque Hogar esté cerrada. Si cambiás horarios, volvé a descargarlo.</p>
    </div>
  );
}

// ---------------- Tratamientos ----------------
function Treatments({ list, meds, logs, onOpen, onNew }: { list: Treatment[]; meds: Medication[]; logs: DoseLog[]; onOpen: (t: Treatment) => void; onNew: (t: { t: null; draft?: ParsedPrescription; photo?: File }) => void }) {
  const { profiles } = useApp();
  const sorted = [...list].filter((t) => !t.deleted).sort((a, b) => (a.status === b.status ? (b.startDate ?? '').localeCompare(a.startDate ?? '') : a.status === 'activo' ? -1 : 1));
  return (
    <div className="stack">
      <ImportButtons onNew={onNew} />
      {sorted.length === 0 ? <div className="card"><Empty icon={<Stethoscope size={36} />} title="Todavía no hay tratamientos." /></div> : (
        <div className="card"><ul className="list">
          {sorted.map((t) => {
            const ms = meds.filter((m) => m.treatmentId === t.id && !m.deleted);
            return (
              <li key={t.id}><button className="item" onClick={() => onOpen(t)}>
                <Avatar profile={profiles.find((p) => p.id === t.personId)} />
                <div className="item-main">
                  <div className="item-title">{t.diagnosis || 'Tratamiento'}</div>
                  <div className="item-sub">{ms.map((m) => { const p = progress(m, logs); return `${m.name}${p.total ? ` (${p.done}/${p.total})` : ''}`; }).join(' · ') || 'Sin medicamentos'}{t.startDate ? ` · desde ${formatDate(t.startDate)}` : ''}</div>
                </div>
                <StatusChip tone={t.status === 'activo' ? 'ok' : 'neutral'}>{t.status === 'activo' ? 'Activo' : 'Terminado'}</StatusChip>
              </button></li>
            );
          })}
        </ul></div>
      )}
    </div>
  );
}

interface MedDraft extends Partial<Medication> { key: string; issues?: string[]; firstDate?: string; firstTime?: string; source?: string }
const toDraft = (m: Partial<Medication> & { issues?: string[]; source?: string }, i: number): MedDraft => ({
  ...m, key: m.id ?? `n${i}-${Math.random().toString(36).slice(2, 7)}`, firstDate: m.firstDose?.slice(0, 10) ?? today(), firstTime: m.firstDose?.slice(11) ?? nextRoundHour(),
});
function nextRoundHour() { const d = new Date(); d.setMinutes(0); d.setHours(d.getHours() + 1); return `${String(d.getHours()).padStart(2, '0')}:00`; }

function TreatmentSheet({ init, meds, defaultPerson, onClose }: { init: { t: Treatment | null; draft?: ParsedPrescription; photo?: File }; meds: Medication[]; defaultPerson: string; onClose: () => void }) {
  const { repo, profile, profiles, run, toast } = useApp();
  const openAtt = useOpenAttachment();
  const t0 = init.t;
  const [d, setD] = useState<Partial<Treatment>>(() => t0 ? { ...t0 } : { personId: defaultPerson || undefined, status: 'activo', startDate: today(), diagnosis: init.draft?.diagnosis, doctor: init.draft?.doctor, attachmentIds: [] });
  const [list, setList] = useState<MedDraft[]>(() => t0 ? meds.filter((m) => m.treatmentId === t0.id && !m.deleted).map(toDraft) : (init.draft?.meds ?? []).map((m, i) => toDraft({ name: m.name, dose: m.dose, everyHours: m.everyHours, days: m.days, asNeeded: m.asNeeded, notes: m.notes, status: 'activo', issues: m.issues, source: m.source }, i)));
  const [removed, setRemoved] = useState<string[]>([]);
  const [photos, setPhotos] = useState<File[]>(init.photo ? [init.photo] : []);
  const [del, setDel] = useState(false);
  const unread = init.draft?.unread ?? [];
  const setMed = (key: string, patch: Partial<MedDraft>) => setList((l) => l.map((m) => (m.key === key ? { ...m, ...patch } : m)));

  const save = async () => {
    if (!d.personId) { toast('Elegí para quién es el tratamiento.', { tone: 'error' }); return; }
    const bad = list.find((m) => !m.name?.trim());
    if (bad) { toast('Hay un medicamento sin nombre.', { tone: 'error' }); return; }
    const ok = await run(async () => {
      const attIds = [...(d.attachmentIds ?? [])];
      for (const f of photos) attIds.push((await storeFile(repo, f, f.name || 'indicacion.jpg', documentFolder({ category: 'salud', personId: d.personId, date: today() } as any, profiles), profile?.id)).attachment.id);
      const notesExtra = unread.length && !t0 ? [d.notes, `Sin interpretar: ${unread.join(' / ')}`].filter(Boolean).join('\n') : d.notes;
      const data: any = { personId: d.personId, diagnosis: d.diagnosis, doctor: d.doctor, place: d.place, startDate: d.startDate, status: d.status ?? 'activo', notes: notesExtra, attachmentIds: attIds };
      const tr = t0 ? await repo.update('treatments', t0.id, data, { by: profile?.id }) : await repo.create('treatments', data, { by: profile?.id });
      for (const m of list) {
        const rec: any = { treatmentId: tr.id, personId: d.personId, name: m.name!.trim(), dose: m.dose, everyHours: m.asNeeded ? undefined : m.everyHours, days: m.asNeeded ? undefined : m.days,
          firstDose: m.asNeeded ? undefined : `${m.firstDate ?? today()}T${m.firstTime ?? '08:00'}`, times: m.times?.length ? m.times : undefined, asNeeded: !!m.asNeeded, notes: m.notes, status: m.status ?? 'activo' };
        if (m.id) await repo.update('medications', m.id, rec, { by: profile?.id }); else await repo.create('medications', rec, { by: profile?.id });
      }
      for (const id of removed) await repo.remove('medications', id, { by: profile?.id });
      return tr;
    }, 'Tratamiento guardado');
    if (ok) onClose();
  };

  return (
    <Sheet open onClose={onClose} title={t0 ? (t0.diagnosis || 'Tratamiento') : 'Nuevo tratamiento'} wide
      footer={<>{t0 && <button className="btn btn-danger" onClick={() => setDel(true)}>Eliminar</button>}<span className="spacer" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <div className="form">
        {init.draft && <Banner tone="info">Revisá lo que se leyó. Los datos marcados en amarillo no se entendieron bien: completalos o corregilos antes de guardar.</Banner>}
        {unread.length > 0 && <Banner tone="warn"><strong>No se entendió:</strong> {unread.join(' · ')}. Si es una indicación, agregala abajo.</Banner>}
        <div className="form-row">
          <PersonSelect label="Para quién" value={d.personId} onChange={(v) => setD({ ...d, personId: v })} profiles={profiles.filter((p) => p.role !== 'family')} allowEmpty={false} />
          <DateField label="Inicio" value={d.startDate} onChange={(v) => setD({ ...d, startDate: v })} />
        </div>
        <TextField label="Diagnóstico" value={d.diagnosis} onChange={(v) => setD({ ...d, diagnosis: v })} placeholder="Ej.: Bronquitis obstructiva" />
        <div className="form-row">
          <TextField label="Médico/a" value={d.doctor} onChange={(v) => setD({ ...d, doctor: v })} />
          <TextField label="Lugar" value={d.place} onChange={(v) => setD({ ...d, place: v })} placeholder="Guardia, consultorio…" />
        </div>
        <TextArea label="Indicaciones generales" value={d.notes} onChange={(v) => setD({ ...d, notes: v })} rows={2} placeholder="Reposo, nebulizaciones, volver si…" />

        <h3 style={{ marginTop: 6 }}>Medicamentos</h3>
        {list.map((m) => <MedEditor key={m.key} m={m} others={list.filter((x) => x.key !== m.key)} onChange={(p) => setMed(m.key, p)} onRemove={() => { if (m.id) setRemoved((r) => [...r, m.id!]); setList((l) => l.filter((x) => x.key !== m.key)); }} />)}
        <button type="button" className="btn btn-sm" onClick={() => setList((l) => [...l, toDraft({ status: 'activo', everyHours: 8, days: 7 }, l.length)])}><Plus size={14} /> Agregar medicamento</button>

        <h3 style={{ marginTop: 6 }}>Fotos de la indicación</h3>
        <div className="row-wrap">
          {(d.attachmentIds ?? []).map((id, i) => <button key={id} type="button" className="btn btn-sm" onClick={() => openAtt(id)}><Paperclip size={14} /> Foto {i + 1}</button>)}
          {photos.map((f, i) => <span key={i} className="chip">{f.name || 'foto nueva'}</span>)}
          <FilePickButton label="Agregar foto" accept="image/*,application/pdf" onFiles={(f) => setPhotos((p) => [...p, ...f])} />
        </div>
        {t0 && <Checkbox label="Tratamiento terminado" checked={d.status === 'terminado'} onChange={(v) => setD({ ...d, status: v ? 'terminado' : 'activo' })} />}
      </div>
      <ConfirmSheet open={del} onClose={() => setDel(false)} title="Eliminar tratamiento" danger confirmLabel="Eliminar" message={<p>Se elimina el tratamiento con sus medicamentos. Las fotos quedan en Drive.</p>}
        onConfirm={() => run(async () => { for (const m of list) if (m.id) await repo.remove('medications', m.id, { by: profile?.id }); await repo.remove('treatments', t0!.id, { by: profile?.id }); }, 'Tratamiento eliminado').then(onClose)} />
    </Sheet>
  );
}

function MedEditor({ m, others, onChange, onRemove }: { m: MedDraft; others: MedDraft[]; onChange: (p: Partial<MedDraft>) => void; onRemove: () => void }) {
  const [adjust, setAdjust] = useState(!!m.times?.length);
  const issues = new Set(m.issues ?? []);
  const warn = (k: string) => (issues.has(k) ? ' field-warn' : '');
  const suggested = m.everyHours && m.firstTime ? timesFromInterval(m.firstTime, m.everyHours) : [];
  const preview = doseSchedule({ firstDose: `${m.firstDate ?? today()}T${m.firstTime ?? '08:00'}`, everyHours: m.everyHours, days: m.days, times: adjust ? m.times : undefined, asNeeded: m.asNeeded, status: 'activo' });
  const otherTimes = [...new Set(others.flatMap((o) => o.times ?? (o.everyHours && o.firstTime ? timesFromInterval(o.firstTime, o.everyHours) : [])))].sort();
  return (
    <div className="med-card">
      {m.source && <p className="tiny muted">Leído: “{m.source}”</p>}
      <div className="form-row">
        <TextField label="Medicamento" required value={m.name} onChange={(v) => onChange({ name: v })} />
        <div className={warn('Falta la dosis')}><TextField label="Dosis" value={m.dose} onChange={(v) => onChange({ dose: v })} placeholder="5 ml, 1 comprimido…" /></div>
      </div>
      <Checkbox label="Solo si hace falta (fiebre, dolor…)" checked={!!m.asNeeded} onChange={(v) => onChange({ asNeeded: v })} />
      {!m.asNeeded && (
        <>
          <div className="form-row">
            <div className={warn('Falta cada cuántas horas')}><NumberField label="Cada (horas)" value={m.everyHours} onChange={(v) => onChange({ everyHours: v })} /></div>
            <div className={warn('Falta por cuántos días')}><NumberField label="Durante (días)" value={m.days} onChange={(v) => onChange({ days: v })} /></div>
          </div>
          <div className="form-row">
            <DateField label="Primera toma" value={m.firstDate} onChange={(v) => onChange({ firstDate: v })} />
            <TimeField label="Hora" value={m.firstTime} onChange={(v) => onChange({ firstTime: v })} />
          </div>
          <Checkbox label="Acomodar los horarios a mano" checked={adjust} onChange={(v) => { setAdjust(v); onChange({ times: v ? (m.times?.length ? m.times : suggested) : undefined }); }}
            hint="Para que coincidan con otro medicamento o con la rutina (ej.: 8, 14 y 20 en lugar de 9, 17 y 1)." />
          {adjust && (
            <div className="stack-sm">
              <div className="row-wrap">
                {(m.times ?? []).map((t, i) => (
                  <span key={i} className="time-chip">
                    <input type="time" className="input" value={t} aria-label={`Horario ${i + 1}`} onChange={(e) => onChange({ times: (m.times ?? []).map((x, k) => (k === i ? e.target.value : x)).sort() })} />
                    <button type="button" className="icon-btn" aria-label={`Quitar horario ${t}`} onClick={() => onChange({ times: (m.times ?? []).filter((_, k) => k !== i) })}>×</button>
                  </span>
                ))}
                <button type="button" className="btn btn-sm" onClick={() => onChange({ times: [...(m.times ?? []), '12:00'].sort() })}><Plus size={14} /> Horario</button>
              </div>
              {otherTimes.length > 0 && <button type="button" className="link-btn" onClick={() => onChange({ times: otherTimes })}>Usar los mismos horarios que el otro medicamento ({otherTimes.join(', ')})</button>}
            </div>
          )}
          {preview.length > 0 && <p className="tiny muted">{preview.length} tomas · primera {formatDate(preview[0].slice(0, 10))} {preview[0].slice(11)} · última {formatDate(preview[preview.length - 1].slice(0, 10))} {preview[preview.length - 1].slice(11)}</p>}
        </>
      )}
      <TextField label="Indicaciones" value={m.notes} onChange={(v) => onChange({ notes: v })} placeholder="Con comida, agitar antes de usar…" />
      <div className="row"><span className="spacer" />
        {m.id && <SelectField label="Estado" value={m.status ?? 'activo'} onChange={(v) => onChange({ status: v })} options={[{ value: 'activo', label: 'Activo' }, { value: 'suspendido', label: 'Suspendido' }, { value: 'terminado', label: 'Terminado' }]} />}
        <button type="button" className="btn btn-sm btn-ghost" onClick={onRemove}>Quitar</button>
      </div>
    </div>
  );
}

// ---------------- Indicaciones y planes de crisis ----------------
function Notes({ list, onOpen }: { list: HealthNote[]; onOpen: (n: HealthNote | null) => void }) {
  const { profiles } = useApp();
  const sorted = list.filter((n) => !n.deleted).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.date ?? '').localeCompare(a.date ?? ''));
  return (
    <div className="stack">
      <button className="btn btn-primary" onClick={() => onOpen(null)}><Plus size={16} /> Nueva indicación</button>
      {sorted.length === 0 ? <div className="card"><Empty icon={<ClipboardList size={36} />} title="Sin indicaciones todavía. Ej.: qué hacer en una crisis de asma." /></div> : (
        <div className="card"><ul className="list">
          {sorted.map((n) => (
            <li key={n.id}><button className="item" onClick={() => onOpen(n)}>
              <span className="cat-ico" aria-hidden="true">{noteKind(n.kind).icon}</span>
              <div className="item-main"><div className="item-title">{n.title}</div><div className="item-sub">{noteKind(n.kind).label}{n.personId ? ` · ${nameOf(profiles, n.personId)}` : ''}{n.doctor ? ` · ${n.doctor}` : ''}{n.date ? ` · ${formatDate(n.date, { year: true })}` : ''}</div></div>
              {n.pinned && <StatusChip tone="alert">Plan de crisis</StatusChip>}
            </button></li>
          ))}
        </ul></div>
      )}
    </div>
  );
}

function NoteSheet({ note, defaultPerson, cards, onClose }: { note: HealthNote | null | undefined; defaultPerson: string; cards: HealthCard[]; onClose: () => void }) {
  const { repo, profile, profiles, run } = useApp();
  const openAtt = useOpenAttachment();
  const [d, setD] = useState<Partial<HealthNote>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [edit, setEdit] = useState(false);
  useEffect(() => { if (note !== undefined) { setD(note ?? { kind: 'indicacion', personId: defaultPerson || undefined, date: today(), attachmentIds: [] }); setFiles([]); setEdit(!note); } }, [note]);
  const save = async () => {
    const ok = await run(async () => {
      const att = [...(d.attachmentIds ?? [])];
      for (const f of files) att.push((await storeFile(repo, f, f.name, documentFolder({ category: 'salud', personId: d.personId, date: today() } as any, profiles), profile?.id)).attachment.id);
      const data: any = { personId: d.personId, kind: d.kind ?? 'indicacion', title: d.title?.trim(), body: d.body, doctor: d.doctor, date: d.date, pinned: !!d.pinned, attachmentIds: att };
      return note ? repo.update('healthNotes', note.id, data, { by: profile?.id }) : repo.create('healthNotes', data, { by: profile?.id });
    }, 'Indicación guardada');
    if (ok) onClose();
  };
  if (note === undefined) return null;
  // Vista de lectura grande (para una urgencia): texto bien legible.
  if (!edit && note) {
    return (
      <Sheet open onClose={onClose} title={`${noteKind(note.kind).icon} ${note.title}`} wide footer={<><button className="btn" onClick={() => setEdit(true)}>Editar</button><button className="btn btn-primary" onClick={onClose}>Cerrar</button></>}>
        <div className="stack">
          <p className="muted">{[nameOf(profiles, note.personId), note.doctor, note.date && formatDate(note.date, { year: true })].filter(Boolean).join(' · ')}</p>
          {(() => { const c = cards.find((x) => !x.deleted && x.personId === note.personId); return c?.allergies ? <Banner tone="alert"><strong>Alergias:</strong> {c.allergies}</Banner> : null; })()}
          <div className="note-read">{note.body || 'Sin texto.'}</div>
          <div className="row-wrap">{(note.attachmentIds ?? []).map((id, i) => <button key={id} className="btn btn-sm" onClick={() => openAtt(id)}><Paperclip size={14} /> Ver foto {i + 1}</button>)}</div>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet open onClose={onClose} title={note ? 'Editar indicación' : 'Nueva indicación'} wide
      footer={<>{note && <button className="btn btn-danger" onClick={() => run(() => repo.remove('healthNotes', note.id, { by: profile?.id }), 'Eliminada').then(onClose)}>Eliminar</button>}<span className="spacer" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save} disabled={!d.title?.trim()}>Guardar</button></>}>
      <div className="form">
        <div className="form-row">
          <PersonSelect label="De quién" value={d.personId} onChange={(v) => setD({ ...d, personId: v })} profiles={profiles.filter((p) => p.role !== 'family')} />
          <SelectField label="Tipo" value={d.kind ?? 'indicacion'} onChange={(v) => setD({ ...d, kind: v, pinned: v === 'plan' ? true : d.pinned })} options={NOTE_KINDS.map((k) => ({ value: k.id, label: `${k.icon} ${k.label}` }))} />
        </div>
        <TextField label="Título" required value={d.title} onChange={(v) => setD({ ...d, title: v })} placeholder="Ej.: Crisis de asma" />
        <TextArea label="Indicaciones" value={d.body} onChange={(v) => setD({ ...d, body: v })} rows={8} placeholder={'Ej.:\n1. Salbutamol 2 puff con aerocámara, repetir cada 20 min hasta 3 veces.\n2. Si no mejora o le cuesta hablar: guardia.\nTeléfono pediatra: …'} />
        <div className="form-row">
          <TextField label="Médico/a" value={d.doctor} onChange={(v) => setD({ ...d, doctor: v })} />
          <DateField label="Fecha" value={d.date} onChange={(v) => setD({ ...d, date: v })} />
        </div>
        <Checkbox label="Mostrar arriba como plan de crisis (acceso rápido)" checked={!!d.pinned} onChange={(v) => setD({ ...d, pinned: v })} />
        <div className="row-wrap">
          {(d.attachmentIds ?? []).map((id, i) => <button key={id} type="button" className="btn btn-sm" onClick={() => openAtt(id)}><Paperclip size={14} /> Foto {i + 1}</button>)}
          {files.map((f, i) => <span key={i} className="chip">{f.name}</span>)}
          <FilePickButton label="Adjuntar foto" accept="image/*,application/pdf" onFiles={(f) => setFiles((x) => [...x, ...f])} />
        </div>
      </div>
    </Sheet>
  );
}

// ---------------- Vacunas ----------------
function Vaccines({ list, people, notes }: { list: Vaccination[]; people: Profile[]; notes: HealthNote[] }) {
  const { repo, profile, run } = useApp();
  const openAtt = useOpenAttachment();
  const [editing, setEditing] = useState<Vaccination | null>(null);
  const [bulk, setBulk] = useState<Profile | null>(null);
  const kids = people.filter((p) => p.role === 'child');
  const addCarnet = async (p: Profile, files: File[]) => {
    await run(async () => {
      const ids: string[] = [];
      for (const f of files) ids.push((await storeFile(repo, f, f.name, documentFolder({ category: 'salud', personId: p.id, date: today() } as any, [p]), profile?.id)).attachment.id);
      const cur = notes.find((n) => !n.deleted && n.kind === 'vacuna' && n.personId === p.id && n.title === 'Carnet de vacunación');
      if (cur) return repo.update('healthNotes', cur.id, { attachmentIds: [...(cur.attachmentIds ?? []), ...ids] }, { by: profile?.id });
      return repo.create('healthNotes', { personId: p.id, kind: 'vacuna', title: 'Carnet de vacunación', attachmentIds: ids, date: today() } as any, { by: profile?.id });
    }, 'Foto del carnet guardada');
  };
  if (!kids.length) return <div className="card"><Empty icon={<Syringe size={36} />} title="El calendario de vacunas se arma para los perfiles de los chicos." /></div>;
  return (
    <div className="stack">
      {kids.map((p) => {
        const vs = list.filter((v) => !v.deleted && v.personId === p.id).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
        const carnet = notes.find((n) => !n.deleted && n.kind === 'vacuna' && n.personId === p.id && n.title === 'Carnet de vacunación');
        const pendingPast = vs.filter((v) => v.status === 'pendiente' && v.dueDate && v.dueDate <= today()).length;
        return (
          <section key={p.id} className="card card-pad stack-sm">
            <div className="row"><Avatar profile={p} /><h2 style={{ flex: 1 }}>{p.name}</h2></div>
            {!hasFullBirthDate(p) ? (
              <BirthDateAsk p={p} />
            ) : (
              <>
                <div className="row-wrap">
                  <FilePickButton label="Foto del carnet" accept="image/*" capture="environment" onFiles={(f) => addCarnet(p, f)} />
                  {(carnet?.attachmentIds ?? []).map((id, i) => <button key={id} className="btn btn-sm" onClick={() => openAtt(id)}><Camera size={14} /> Carnet {i + 1}</button>)}
                  {pendingPast > 0 && <button className="btn btn-sm" onClick={() => setBulk(p)}>Marcar las anteriores como aplicadas ({pendingPast})</button>}
                </div>
                <ul className="list vac-list">
                  {vs.map((v) => {
                    const st = vaccineState(v);
                    return (
                      <li key={v.id}><button className={`item vac vac-${st}`} onClick={() => setEditing(v)}>
                        <div className="item-main">
                          <div className="item-title">{v.vaccine} <span className="muted">· {v.dose}</span></div>
                          <div className="item-sub">{v.ageLabel}{v.dueDate ? ` · ${formatDate(v.dueDate, { year: true })}` : ''}{v.appliedDate ? ` · aplicada ${formatDate(v.appliedDate, { year: true })}` : ''}</div>
                        </div>
                        <StatusChip tone={st === 'aplicada' ? 'ok' : st === 'toca_ahora' ? 'warn' : st === 'proxima' ? 'info' : 'neutral'}>{VACCINE_STATE_LABEL[st]}</StatusChip>
                      </button></li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        );
      })}
      <p className="tiny muted">Referencia: <a href={VACCINE_SOURCE_URL} target="_blank" rel="noopener noreferrer">{VACCINE_SOURCE}</a>. Puede cambiar y algunas vacunas dependen de la zona o de indicación médica: confirmá siempre con el pediatra. Las de hace más de un año sin marcar figuran "Sin registrar" (no avisan): marcalas mirando el carnet.</p>
      <VaccineSheet v={editing} onClose={() => setEditing(null)} />
      <ConfirmSheet open={!!bulk} onClose={() => setBulk(null)} title="Marcar como aplicadas" confirmLabel="Marcar"
        message={<p>Se marcan como aplicadas todas las vacunas de {bulk?.name} que correspondían hasta hoy. Hacelo después de revisar el carnet; las que falten se pueden desmarcar una por una.</p>}
        onConfirm={() => { run(() => markPastAsApplied(repo, list.filter((v) => v.personId === bulk?.id), profile?.id), 'Vacunas marcadas'); setBulk(null); }} />
    </div>
  );
}

function BirthDateAsk({ p }: { p: Profile }) {
  const { repo, profile, run } = useApp();
  const [v, setV] = useState<string | undefined>();
  return (
    <div className="stack-sm">
      <p className="small">Para armar su calendario de vacunas hace falta la fecha de nacimiento completa.</p>
      <div className="row"><DateField label="Fecha de nacimiento" value={v} onChange={setV} />
        <button className="btn btn-primary" disabled={!v} onClick={() => run(() => repo.update('profiles', p.id, { birthDate: v }, { by: profile?.id }), 'Fecha guardada')}>Guardar</button></div>
    </div>
  );
}

function VaccineSheet({ v, onClose }: { v: Vaccination | null; onClose: () => void }) {
  const { repo, profile, run } = useApp();
  const [d, setD] = useState<Partial<Vaccination>>({});
  useEffect(() => { if (v) setD({ ...v, appliedDate: v.appliedDate ?? (v.status === 'pendiente' ? today() : undefined) }); }, [v?.id]);
  if (!v) return null;
  const save = (status: string) => run(() => repo.update('vaccinations', v.id, { status, appliedDate: status === 'aplicada' ? d.appliedDate : undefined, place: d.place, lot: d.lot, notes: d.notes }, { by: profile?.id }), 'Vacuna actualizada').then(onClose);
  return (
    <Sheet open onClose={onClose} title={`${v.vaccine} · ${v.dose ?? ''}`}
      footer={<><button className="btn btn-ghost" onClick={() => save('no corresponde')}>No corresponde</button><span className="spacer" />{v.status !== 'pendiente' && <button className="btn" onClick={() => save('pendiente')}>Pendiente</button>}<button className="btn btn-primary" onClick={() => save('aplicada')}>Aplicada</button></>}>
      <div className="form">
        <p className="muted">{v.ageLabel}{v.dueDate ? ` · le corresponde el ${formatDate(v.dueDate, { year: true })}` : ''}</p>
        {v.notes && <Banner tone="info">{v.notes}</Banner>}
        <DateField label="Aplicada el" value={d.appliedDate} onChange={(x) => setD({ ...d, appliedDate: x })} />
        <div className="form-row">
          <TextField label="Lugar" value={d.place} onChange={(x) => setD({ ...d, place: x })} />
          <TextField label="Lote" value={d.lot} onChange={(x) => setD({ ...d, lot: x })} />
        </div>
        <TextField label="Notas" value={d.notes} onChange={(x) => setD({ ...d, notes: x })} />
      </div>
    </Sheet>
  );
}

// ---------------- Cartilla de médicos ----------------
const digits = (s?: string) => (s ?? '').replace(/[^\d+]/g, '');
const waLink = (s?: string) => { let n = (s ?? '').replace(/\D/g, ''); if (n && !n.startsWith('54')) n = '549' + n.replace(/^0/, '').replace(/^15/, ''); return `https://wa.me/${n}`; };

function Doctors({ list }: { list: Doctor[] }) {
  const { profiles } = useApp();
  const [editing, setEditing] = useState<Doctor | null | undefined>(undefined);
  const sorted = useMemo(() => list.filter((d) => !d.deleted).sort((a, b) => a.name.localeCompare(b.name)), [list]);
  return (
    <div className="stack">
      <button className="btn btn-primary" onClick={() => setEditing(null)}><Plus size={16} /> Agregar médico/a</button>
      {sorted.length === 0 ? <div className="card"><Empty icon={<Stethoscope size={36} />} title="Cargá a los médicos de cada uno con su teléfono, para tenerlos a mano." /></div> : sorted.map((d) => (
        <div key={d.id} className="card card-pad doctor-card">
          <button type="button" className="doctor-main" onClick={() => setEditing(d)}>
            <strong>{d.name}</strong>
            <span className="muted small">{[d.specialty, d.insurance].filter(Boolean).join(' · ')}</span>
            <span className="row" style={{ gap: 4, marginTop: 4 }}>{(d.personIds ?? []).map((id) => <Avatar key={id} profile={profiles.find((p) => p.id === id)} />)}</span>
          </button>
          <div className="row-wrap">
            {d.phone && <a className="btn btn-sm btn-primary" href={`tel:${digits(d.phone)}`}><Phone size={14} /> Llamar</a>}
            {d.whatsapp && <a className="btn btn-sm" href={waLink(d.whatsapp)} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} /> WhatsApp</a>}
            {d.address && <a className="btn btn-sm" href={`https://maps.google.com/?q=${encodeURIComponent(d.address)}`} target="_blank" rel="noopener noreferrer"><MapPin size={14} /> Cómo llegar</a>}
          </div>
        </div>
      ))}
      <DoctorSheet doctor={editing} onClose={() => setEditing(undefined)} />
    </div>
  );
}

function DoctorSheet({ doctor, onClose }: { doctor: Doctor | null | undefined; onClose: () => void }) {
  const { repo, profile, profiles, run } = useApp();
  const [d, setD] = useState<Partial<Doctor>>({});
  useEffect(() => { if (doctor !== undefined) setD(doctor ?? { personIds: [] }); }, [doctor]);
  if (doctor === undefined) return null;
  const toggle = (id: string) => setD((x) => ({ ...x, personIds: (x.personIds ?? []).includes(id) ? (x.personIds ?? []).filter((y) => y !== id) : [...(x.personIds ?? []), id] }));
  const save = () => run(() => {
    const data: any = { name: d.name?.trim(), specialty: d.specialty, personIds: d.personIds ?? [], phone: d.phone, whatsapp: d.whatsapp, address: d.address, insurance: d.insurance, email: d.email, notes: d.notes };
    return doctor ? repo.update('doctors', doctor.id, data, { by: profile?.id }) : repo.create('doctors', data, { by: profile?.id });
  }, 'Guardado').then((ok) => ok && onClose());
  return (
    <Sheet open onClose={onClose} title={doctor ? doctor.name : 'Nuevo médico/a'}
      footer={<>{doctor && <button className="btn btn-danger" onClick={() => run(() => repo.remove('doctors', doctor.id, { by: profile?.id }), 'Eliminado').then(onClose)}>Eliminar</button>}<span className="spacer" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save} disabled={!d.name?.trim()}>Guardar</button></>}>
      <div className="form">
        <TextField label="Nombre" required value={d.name} onChange={(v) => setD({ ...d, name: v })} placeholder="Dra. Pérez" />
        <TextField label="Especialidad" value={d.specialty} onChange={(v) => setD({ ...d, specialty: v })} placeholder="Pediatra, neumonóloga, odontólogo…" />
        <div className="field" role="group" aria-label="Atiende a">
          <span className="field-label">Atiende a</span>
          <div className="chips-toggle" style={{ flexWrap: 'wrap' }}>{profiles.filter((p) => p.active && p.role !== 'family').map((p) => <button key={p.id} type="button" aria-pressed={(d.personIds ?? []).includes(p.id)} onClick={() => toggle(p.id)}><Avatar profile={p} /> {p.name}</button>)}</div>
        </div>
        <div className="form-row">
          <TextField label="Teléfono" type="tel" inputMode="tel" value={d.phone} onChange={(v) => setD({ ...d, phone: v })} />
          <TextField label="WhatsApp" type="tel" inputMode="tel" value={d.whatsapp} onChange={(v) => setD({ ...d, whatsapp: v })} hint="Con código de área" />
        </div>
        <TextField label="Dirección" value={d.address} onChange={(v) => setD({ ...d, address: v })} />
        <div className="form-row">
          <TextField label="Obra social / prepaga" value={d.insurance} onChange={(v) => setD({ ...d, insurance: v })} />
          <TextField label="Mail" type="email" value={d.email} onChange={(v) => setD({ ...d, email: v })} />
        </div>
        <TextArea label="Notas" value={d.notes} onChange={(v) => setD({ ...d, notes: v })} rows={2} placeholder="Horarios de atención, cómo pedir turno…" />
      </div>
    </Sheet>
  );
}

// ---------------- Fichas de salud ----------------
function ageOf(birth?: string): string {
  if (!birth || !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return '';
  const b = new Date(birth + 'T00:00'), n = new Date();
  let y = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) y--;
  return y < 2 ? `${Math.max(0, Math.round((n.getTime() - b.getTime()) / (30.44 * 864e5)))} meses` : `${y} años`;
}

function Cards({ people, cards, doctors }: { people: Profile[]; cards: HealthCard[]; doctors: Doctor[] }) {
  const { toast } = useApp();
  const [editing, setEditing] = useState<Profile | null>(null);
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast('Copiado', { tone: 'ok' }), () => {});
  return (
    <div className="stack">
      {people.map((p) => {
        const c = cards.find((x) => !x.deleted && x.personId === p.id);
        const doc = doctors.find((d) => d.id === c?.doctorId && !d.deleted);
        const age = ageOf(p.birthDate);
        return (
          <section key={p.id} className="card card-pad ficha">
            <div className="row">
              <Avatar profile={p} large />
              <div style={{ flex: 1 }}><h2>{p.name}</h2><span className="muted small">{[age, c?.dni && `DNI ${c.dni}`].filter(Boolean).join(' · ') || 'Sin datos todavía'}</span></div>
              <button className="icon-btn" onClick={() => setEditing(p)} aria-label={`Editar la ficha de ${p.name}`}><Pencil size={18} /></button>
            </div>
            {c?.allergies ? <div className="ficha-alert">⚠️ <strong>Alergias:</strong> {c.allergies}</div> : c ? <div className="ficha-ok">Sin alergias conocidas cargadas</div> : null}
            {c ? (
              <dl className="ficha-grid">
                {c.bloodType && <><dt>Grupo y factor</dt><dd className="strong">{c.bloodType}</dd></>}
                {(c.weightKg || c.heightCm) && <><dt>Peso / altura</dt><dd>{[c.weightKg && `${c.weightKg} kg`, c.heightCm && `${c.heightCm} cm`].filter(Boolean).join(' · ')}{c.measuredAt ? <span className="muted"> ({formatDate(c.measuredAt, { year: true })})</span> : null}</dd></>}
                {c.insurance && <><dt>Obra social</dt><dd>{[c.insurance, c.insurancePlan].filter(Boolean).join(' · ')}{c.insuranceNumber && <> · <button className="link-btn" onClick={() => copy(c.insuranceNumber!)} aria-label="Copiar número de afiliado">N.º {c.insuranceNumber} <Copy size={12} /></button></>}</dd></>}
                {c.regularMeds && <><dt>Medicación habitual</dt><dd>{c.regularMeds}</dd></>}
                {c.conditions && <><dt>Antecedentes</dt><dd>{c.conditions}</dd></>}
                {doc && <><dt>Médico de cabecera</dt><dd>{doc.name}{doc.phone && <> · <a href={`tel:${digits(doc.phone)}`}>Llamar</a></>}</dd></>}
                {c.emergencyNotes && <><dt>Para una urgencia</dt><dd>{c.emergencyNotes}</dd></>}
              </dl>
            ) : <button className="btn btn-sm" onClick={() => setEditing(p)}><Plus size={14} /> Completar ficha</button>}
          </section>
        );
      })}
      {editing && <CardSheet p={editing} card={cards.find((x) => !x.deleted && x.personId === editing.id)} doctors={doctors} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CardSheet({ p, card, doctors, onClose }: { p: Profile; card?: HealthCard; doctors: Doctor[]; onClose: () => void }) {
  const { repo, profile, run } = useApp();
  const [d, setD] = useState<Partial<HealthCard>>(card ?? { personId: p.id });
  const [birth, setBirth] = useState(p.birthDate);
  const save = () => run(async () => {
    const data: any = { personId: p.id, bloodType: d.bloodType, allergies: d.allergies, conditions: d.conditions, regularMeds: d.regularMeds, insurance: d.insurance, insurancePlan: d.insurancePlan,
      insuranceNumber: d.insuranceNumber, weightKg: d.weightKg, heightCm: d.heightCm, measuredAt: d.measuredAt, doctorId: d.doctorId, emergencyNotes: d.emergencyNotes, dni: d.dni };
    if (birth !== p.birthDate) await repo.update('profiles', p.id, { birthDate: birth }, { by: profile?.id });
    // ID fijo por persona: dos celulares que crean la ficha a la vez no la duplican.
    return card ? repo.update('healthCards', card.id, data, { by: profile?.id }) : repo.create('healthCards', { id: `ficha-${p.id}`, ...data }, { by: profile?.id });
  }, 'Ficha guardada').then((ok) => ok && onClose());
  return (
    <Sheet open onClose={onClose} title={`Ficha de ${p.name}`} wide footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <div className="form">
        <div className="form-row">
          <DateField label="Fecha de nacimiento" value={birth} onChange={setBirth} />
          <TextField label="DNI" value={d.dni} onChange={(v) => setD({ ...d, dni: v })} inputMode="numeric" />
        </div>
        <TextField label="Alergias" value={d.allergies} onChange={(v) => setD({ ...d, allergies: v })} placeholder="Ej.: penicilina, maní. Dejalo vacío si no tiene." />
        <div className="form-row">
          <SelectField label="Grupo y factor" value={d.bloodType ?? ''} onChange={(v) => setD({ ...d, bloodType: v || undefined })} options={[{ value: '', label: 'No sé' }, ...['0+', '0-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((x) => ({ value: x, label: x }))]} />
          <SelectField label="Médico de cabecera" value={d.doctorId ?? ''} onChange={(v) => setD({ ...d, doctorId: v || undefined })} options={[{ value: '', label: '—' }, ...doctors.filter((x) => !x.deleted).map((x) => ({ value: x.id, label: `${x.name}${x.specialty ? ` (${x.specialty})` : ''}` }))]} />
        </div>
        <div className="form-row">
          <TextField label="Obra social / prepaga" value={d.insurance} onChange={(v) => setD({ ...d, insurance: v })} />
          <TextField label="Plan" value={d.insurancePlan} onChange={(v) => setD({ ...d, insurancePlan: v })} />
        </div>
        <TextField label="N.º de afiliado" value={d.insuranceNumber} onChange={(v) => setD({ ...d, insuranceNumber: v })} />
        <div className="form-row">
          <NumberField label="Peso (kg)" value={d.weightKg} onChange={(v) => setD({ ...d, weightKg: v, measuredAt: d.measuredAt ?? today() })} step="0.1" />
          <NumberField label="Altura (cm)" value={d.heightCm} onChange={(v) => setD({ ...d, heightCm: v, measuredAt: d.measuredAt ?? today() })} />
        </div>
        <DateField label="Peso y altura medidos el" value={d.measuredAt} onChange={(v) => setD({ ...d, measuredAt: v })} hint="El peso sirve para las dosis pediátricas: actualizalo de vez en cuando." />
        <TextArea label="Medicación habitual" value={d.regularMeds} onChange={(v) => setD({ ...d, regularMeds: v })} rows={2} placeholder="Ej.: Budesonide 2 puff a la noche" />
        <TextArea label="Condiciones / antecedentes" value={d.conditions} onChange={(v) => setD({ ...d, conditions: v })} rows={2} placeholder="Ej.: asma, cirugías, internaciones" />
        <TextArea label="Para una urgencia" value={d.emergencyNotes} onChange={(v) => setD({ ...d, emergencyNotes: v })} rows={2} placeholder="Lo que tiene que saber quien lo atienda en una guardia" />
      </div>
    </Sheet>
  );
}
