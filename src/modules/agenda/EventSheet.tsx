import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import type { CalendarEvent } from '../../domain/types';
import { Sheet, ConfirmSheet } from '../../ui/Sheet';
import { CategorySelect, Checkbox, DateField, PeoplePicker, PersonSelect, RecurrenceField, SelectField, TextArea, TextField, TimeField } from '../../ui/fields';
import { AttachmentList, HistoryList } from '../../ui/records';
import { RSVP_LABEL } from '../../domain/catalog';
import { validateRecord } from '../../domain/validation';
import { today, formatDateTimeHuman } from '../../domain/dates';

const REMINDERS = [{ m: 10, l: '10 min' }, { m: 30, l: '30 min' }, { m: 60, l: '1 hora' }, { m: 1440, l: '1 día' }];

export function EventSheet({ open, onClose, event, defaultDate }: { open: boolean; onClose: () => void; event?: CalendarEvent | null; defaultDate?: string }) {
  const { repo, profile, profiles, categories, run, backend, can } = useApp();
  const isNew = !event;
  const [d, setD] = useState<Partial<CalendarEvent>>({});
  const [date, setDate] = useState<string | undefined>();
  const [time, setTime] = useState<string | undefined>();
  const [endDate, setEndDate] = useState<string | undefined>();
  const [endTime, setEndTime] = useState<string | undefined>();
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDel, setConfirmDel] = useState(false);
  const editable = can('events.edit');

  useEffect(() => {
    if (!open) return;
    setErrors([]);
    const e: Partial<CalendarEvent> = event ? { ...event } : { title: '', category: 'otros', allDay: false, participantIds: profile ? [profile.id] : [], ownerId: profile?.role === 'adult' ? profile.id : undefined, reminders: [60], rsvp: 'pendiente', syncCalendar: !!backend, attachmentIds: [] };
    setD(e);
    setDate(e.start?.slice(0, 10) ?? defaultDate ?? today());
    setTime(e.start && e.start.length > 10 ? e.start.slice(11, 16) : isNew ? '09:00' : undefined);
    setEndDate(e.end?.slice(0, 10));
    setEndTime(e.end && e.end.length > 10 ? e.end.slice(11, 16) : undefined);
  }, [open, event?.id]);
  const set = (p: Partial<CalendarEvent>) => setD((x) => ({ ...x, ...p }));

  const build = (): Partial<CalendarEvent> => {
    const start = date ? (d.allDay || !time ? date : `${date}T${time}`) : '';
    let end: string | undefined;
    if (d.allDay) end = endDate && endDate !== date ? endDate : undefined;
    else if (endTime) end = `${endDate ?? date}T${endTime}`;
    return { ...d, start, end, allDay: !!d.allDay || !time };
  };

  const save = async () => {
    const rec = build();
    const errs = validateRecord('events', { id: 'x', ...rec });
    setErrors(errs);
    if (errs.length) return;
    const { id, version, createdAt, updatedAt, rev, _sync, ...data } = rec as any;
    const ok = await run(() => (isNew ? repo.create('events', data, { by: profile?.id }) : repo.update('events', event!.id, data, { by: profile?.id })), isNew ? 'Evento creado' : 'Evento actualizado');
    if (ok) onClose();
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title={isNew ? 'Nuevo evento' : 'Evento'}
        footer={editable ? <>
          {!isNew && <button className="btn btn-danger" onClick={() => setConfirmDel(true)}>Eliminar</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={save}>{isNew ? 'Crear' : 'Guardar'}</button>
        </> : undefined}>
        <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
          {errors.length > 0 && <div className="banner banner-alert" role="alert">{errors.join(' ')}</div>}
          <TextField label="Título" required value={d.title} onChange={(v) => set({ title: v })} autoFocus={isNew} />
          <CategorySelect value={d.category} onChange={(v) => set({ category: v })} categories={categories('events')} required />
          <Checkbox label="Todo el día" checked={!!d.allDay} onChange={(v) => set({ allDay: v })} />
          <div className="form-row">
            <DateField label="Fecha" required value={date} onChange={setDate} />
            {!d.allDay && <TimeField label="Hora de inicio" value={time} onChange={setTime} />}
          </div>
          <div className="form-row">
            <DateField label="Fecha de fin" value={endDate} onChange={setEndDate} hint="Opcional" />
            {!d.allDay && <TimeField label="Hora de fin" value={endTime} onChange={setEndTime} />}
          </div>
          <TextField label="Lugar" value={d.location} onChange={(v) => set({ location: v })} />
          <PeoplePicker label="Participantes" value={d.participantIds ?? []} onChange={(v) => set({ participantIds: v })} profiles={profiles} />
          <PersonSelect label="Responsable principal" value={d.ownerId} onChange={(v) => set({ ownerId: v })} profiles={profiles} />
          <div className="field" role="group" aria-label="Recordatorios">
            <span className="field-label">Recordatorios</span>
            <div className="chips-toggle">
              {REMINDERS.map((r) => {
                const on = d.reminders?.includes(r.m) ?? false;
                return <button key={r.m} type="button" aria-pressed={on} onClick={() => set({ reminders: on ? d.reminders!.filter((x) => x !== r.m) : [...(d.reminders ?? []), r.m] })}>{r.l} antes</button>;
              })}
            </div>
          </div>
          <details className="more">
            <summary>Más opciones</summary>
            <div className="form" style={{ marginTop: 8 }}>
              <RecurrenceField value={d.recurrence} onChange={(v) => set({ recurrence: v })} hint="En eventos, los cambios se aplican a toda la serie." />
              <SelectField label="Confirmación" value={d.rsvp} onChange={(v) => set({ rsvp: v as any })} options={Object.entries(RSVP_LABEL).map(([value, label]) => ({ value: value as any, label }))} />
              <Checkbox label="Sincronizar con Google Calendar" checked={!!d.syncCalendar} onChange={(v) => set({ syncCalendar: v })}
                hint={backend ? 'se envía al calendario familiar en la próxima sincronización de calendario' : 'requiere conectar Google en Ajustes'} />
              <TextArea label="Descripción" value={d.description} onChange={(v) => set({ description: v })} />
              <TextArea label="Notas" value={d.notes} onChange={(v) => set({ notes: v })} rows={2} />
              <div className="field"><span className="field-label">Archivos</span><AttachmentList ids={d.attachmentIds ?? []} onChange={(ids) => set({ attachmentIds: ids })} /></div>
            </div>
          </details>
          {!isNew && (
            <details className="more">
              <summary>Origen e historial</summary>
              <dl className="kv small" style={{ margin: '8px 0' }}>
                <dt>Origen</dt><dd>{({ manual: 'Cargado a mano', asistente: 'Asistente', google_calendar: 'Google Calendar', gmail: 'Gmail', forms: 'Formulario' } as Record<string, string>)[event!.origin ?? 'manual'] ?? event!.origin}</dd>
                <dt>Creado</dt><dd>{formatDateTimeHuman(event!.createdAt)}</dd>
                {event!.googleEventId && <><dt>Google Calendar</dt><dd>Vinculado · última sincronización {formatDateTimeHuman(event!.calendarSyncedAt)}</dd></>}
              </dl>
              <HistoryList entity="events" recordId={event!.id} />
            </details>
          )}
        </form>
      </Sheet>
      <ConfirmSheet open={confirmDel} onClose={() => setConfirmDel(false)} title="Eliminar evento" danger confirmLabel="Eliminar"
        message={<p>{event?.googleEventId ? 'También se eliminará de Google Calendar en la próxima sincronización de calendario. ' : ''}¿Eliminar "{event?.title}"?</p>}
        onConfirm={() => { run(() => repo.remove('events', event!.id, { by: profile?.id }), 'Evento eliminado').then(onClose); }} />
    </>
  );
}
