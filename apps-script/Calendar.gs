/**
 * Sincronización bidireccional con Google Calendar (solo eventos con syncCalendar = TRUE).
 * Reglas:
 *  - Cada evento creado por la app lleva la etiqueta hogarId (setTag) → no se duplican ni se confunden con eventos ajenos.
 *  - App cambió y Google no → se actualiza Google.
 *  - Google cambió y la app no → se actualiza la app y se informa campo por campo qué cambió.
 *  - Ambos cambiaron → NO se toca nada; se informa como conflicto para que la familia decida.
 *  - Evento borrado en Google → no se borra en la app; se informa.
 *  - Evento borrado en la app → se elimina en Google (es la decisión explícita de quien lo borró) y se informa.
 *  - Eventos de Google sin etiqueta → se listan como "externos" para importarlos con revisión (no automáticamente).
 */

function calendar_() {
  var id = props_().getProperty('CALENDAR_ID');
  var cal = id && id !== 'primary' ? CalendarApp.getCalendarById(id) : CalendarApp.getDefaultCalendar();
  if (!cal) throw err_('No se encontró el calendario configurado', 'calendar');
  return cal;
}

function calendarList_() {
  return CalendarApp.getAllOwnedCalendars().map(function (c) { return { id: c.getId(), name: c.getName() }; });
}

function parseLocal_(s) {
  var p = s.split(/[-T:]/).map(Number);
  return new Date(p[0], p[1] - 1, p[2], p[3] || 0, p[4] || 0);
}
function fmtLocal_(d, withTime) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), withTime ? "yyyy-MM-dd'T'HH:mm" : 'yyyy-MM-dd');
}

function recurrenceFor_(r) {
  if (!r) return null;
  var rec = CalendarApp.newRecurrence();
  var rule = r.freq === 'daily' ? rec.addDailyRule() : r.freq === 'weekly' ? rec.addWeeklyRule() : r.freq === 'monthly' ? rec.addMonthlyRule() : rec.addYearlyRule();
  rule = rule.interval(Math.max(1, Number(r.interval || 1)));
  if (r.freq === 'weekly' && r.byWeekday && r.byWeekday.length) {
    var map = [CalendarApp.Weekday.SUNDAY, CalendarApp.Weekday.MONDAY, CalendarApp.Weekday.TUESDAY, CalendarApp.Weekday.WEDNESDAY, CalendarApp.Weekday.THURSDAY, CalendarApp.Weekday.FRIDAY, CalendarApp.Weekday.SATURDAY];
    rule = rule.onlyOnWeekdays(r.byWeekday.map(function (d) { return map[d]; }));
  }
  if (r.until) rule = rule.until(parseLocal_(r.until + 'T23:59'));
  else if (r.count) rule = rule.times(Number(r.count));
  return rec;
}

function eventTimes_(rec) {
  var start = parseLocal_(rec.start.length > 10 ? rec.start : rec.start + 'T00:00');
  var end = rec.end ? parseLocal_(rec.end.length > 10 ? rec.end : rec.end + 'T00:00') : new Date(start.getTime() + (rec.allDay ? 86400000 : 3600000));
  if (rec.allDay && rec.end && rec.end.slice(0, 10) >= rec.start.slice(0, 10)) end = new Date(parseLocal_(rec.end.slice(0, 10) + 'T00:00').getTime() + 86400000);
  return { start: start, end: end };
}

function description_(rec) {
  return [rec.description || '', rec.notes ? 'Notas: ' + rec.notes : '', 'Creado desde la app Hogar'].filter(String).join('\n\n');
}

function createGoogleEvent_(cal, rec) {
  var t = eventTimes_(rec);
  var opts = { location: rec.location || '', description: description_(rec) };
  var recurrence = recurrenceFor_(rec.recurrence);
  var ev;
  if (recurrence) ev = rec.allDay ? cal.createAllDayEventSeries(rec.title, t.start, recurrence, opts) : cal.createEventSeries(rec.title, t.start, t.end, recurrence, opts);
  else ev = rec.allDay ? cal.createAllDayEvent(rec.title, t.start, t.end, opts) : cal.createEvent(rec.title, t.start, t.end, opts);
  ev.setTag('hogarId', rec.id);
  (rec.reminders || []).slice(0, 5).forEach(function (m) { try { ev.addPopupReminder(Number(m)); } catch (e) { /* límite de recordatorios */ } });
  return ev;
}

function findGoogleEvent_(cal, rec) {
  if (!rec.googleEventId) return null;
  try {
    return rec.recurrence ? cal.getEventSeriesById(rec.googleEventId) : cal.getEventById(rec.googleEventId);
  } catch (e) { return null; }
}

function updateGoogleEvent_(ev, rec) {
  ev.setTitle(rec.title);
  ev.setLocation(rec.location || '');
  ev.setDescription(description_(rec));
  var t = eventTimes_(rec);
  var recurrence = recurrenceFor_(rec.recurrence);
  if (recurrence) {
    if (rec.allDay) ev.setRecurrence(recurrence, t.start); else ev.setRecurrence(recurrence, t.start, t.end);
  } else if (rec.allDay) ev.setAllDayDates(t.start, t.end);
  else ev.setTime(t.start, t.end);
}

function googleFields_(ev, rec) {
  var out = { title: ev.getTitle(), location: ev.getLocation() || '' };
  if (!rec.recurrence && ev.getStartTime) {
    var allDay = ev.isAllDayEvent();
    out.start = allDay ? fmtLocal_(ev.getAllDayStartDate(), false) : fmtLocal_(ev.getStartTime(), true);
    out.end = allDay ? fmtLocal_(new Date(ev.getAllDayEndDate().getTime() - 86400000), false) : fmtLocal_(ev.getEndTime(), true);
  }
  return out;
}

function calendarSync_(req) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw err_('El servidor está ocupado', 'busy');
  var report = { created: [], updatedInGoogle: [], updatedFromGoogle: [], conflicts: [], deletedInGoogle: [], deletedFromApp: [], external: [], errors: [] };
  try {
    var cal = calendar_();
    var t = new Table_('events');
    var now = new Date().toISOString();
    t.all().forEach(function (rec) {
      try {
        if (!rec.syncCalendar && !rec.googleEventId) return;
        if (rec.deleted || !rec.syncCalendar) {
          if (rec.googleEventId) {
            var gone = findGoogleEvent_(cal, rec);
            if (gone) { gone.deleteEvent ? gone.deleteEvent() : gone.deleteEventSeries(); }
            report.deletedFromApp.push({ id: rec.id, title: rec.title });
            rec.googleEventId = ''; rec.googleUpdated = ''; rec.calendarSyncedAt = now;
            rec.version = Number(rec.version || 0) + 1; rec.rev = nextRev_(); rec.updatedAt = now;
            t.put(rec);
          }
          return;
        }
        if (!rec.googleEventId) {
          var created = createGoogleEvent_(cal, rec);
          rec.googleEventId = created.getId();
          rec.googleUpdated = created.getLastUpdated().toISOString();
          rec.calendarSyncedAt = now; rec.updatedAt = now;
          rec.version = Number(rec.version || 0) + 1; rec.rev = nextRev_();
          t.put(rec);
          report.created.push({ id: rec.id, title: rec.title });
          return;
        }
        var ev = findGoogleEvent_(cal, rec);
        if (!ev) { report.deletedInGoogle.push({ id: rec.id, title: rec.title }); return; }
        var gUpdated = ev.getLastUpdated().toISOString();
        var googleChanged = rec.googleUpdated && gUpdated > rec.googleUpdated;
        var appChanged = !rec.calendarSyncedAt || rec.updatedAt > rec.calendarSyncedAt;
        if (googleChanged && appChanged) {
          report.conflicts.push({ id: rec.id, title: rec.title, google: googleFields_(ev, rec), googleUpdated: gUpdated });
          return;
        }
        if (googleChanged) {
          var g = googleFields_(ev, rec);
          var changes = {};
          Object.keys(g).forEach(function (k) { if ((rec[k] || '') !== (g[k] || '')) { changes[k] = [rec[k] || '', g[k]]; rec[k] = g[k]; } });
          rec.googleUpdated = gUpdated; rec.calendarSyncedAt = now; rec.updatedAt = now;
          rec.version = Number(rec.version || 0) + 1; rec.rev = nextRev_();
          t.put(rec);
          if (Object.keys(changes).length) report.updatedFromGoogle.push({ id: rec.id, title: rec.title, changes: changes });
          return;
        }
        if (appChanged) {
          updateGoogleEvent_(ev, rec);
          rec.googleUpdated = ev.getLastUpdated().toISOString(); rec.calendarSyncedAt = now; rec.updatedAt = now;
          rec.version = Number(rec.version || 0) + 1; rec.rev = nextRev_();
          t.put(rec);
          report.updatedInGoogle.push({ id: rec.id, title: rec.title });
        }
      } catch (e) {
        report.errors.push({ id: rec.id, title: rec.title, error: String(e.message || e) });
      }
    });
    t.flush();
    if (!req || !req.auto) {
      var from = new Date();
      var to = new Date(from.getTime() + 60 * 86400000);
      cal.getEvents(from, to).forEach(function (ev) {
        if (ev.getTag('hogarId')) return;
        var allDay = ev.isAllDayEvent();
        report.external.push({
          googleEventId: ev.getId(), title: ev.getTitle(), location: ev.getLocation() || '', description: (ev.getDescription() || '').slice(0, 2000),
          allDay: allDay, start: allDay ? fmtLocal_(ev.getAllDayStartDate(), false) : fmtLocal_(ev.getStartTime(), true),
          end: allDay ? '' : fmtLocal_(ev.getEndTime(), true),
        });
      });
    }
    return report;
  } finally {
    lock.releaseLock();
  }
}
