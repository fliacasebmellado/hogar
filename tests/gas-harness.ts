// Emulación en memoria de los servicios de Google Apps Script para ejecutar el backend REAL (apps-script/*.gs)
// dentro de Node. No es Google: sirve para verificar la lógica (idempotencia, versiones, copias, calendario).
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { BackendError, type Transport } from '../src/sync/transport';

const toSigned = (buf: Buffer) => [...buf].map((b) => (b > 127 ? b - 256 : b));
const toBuf = (bytes: number[] | Uint8Array) => Buffer.from([...bytes].map((b) => (b < 0 ? b + 256 : b)));

class FakeBlob {
  constructor(public bytes: Buffer, public type: string, public name = '') {}
  getBytes() { return toSigned(this.bytes); }
  getContentType() { return this.type; }
  getDataAsString() { return this.bytes.toString('utf8'); }
}

class FakeRange {
  constructor(private sheet: FakeSheet, private r: number, private c: number, private nr: number, private nc: number) {
    // Igual que Google Sheets: un rango fuera de las dimensiones de la hoja es un error.
    if (r < 1 || c < 1 || nr < 1 || nc < 1 || r + nr - 1 > sheet.maxRows || c + nc - 1 > sheet.maxCols) {
      throw new Error(`Las coordenadas del rango están fuera de las dimensiones de la hoja "${sheet.name}" (${r},${c},${nr},${nc} > ${sheet.maxRows}x${sheet.maxCols})`);
    }
  }
  getValues() {
    const out: any[][] = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] ?? [];
      out.push(Array.from({ length: this.nc }, (_, j) => row[this.c - 1 + j] ?? ''));
    }
    return out;
  }
  setValues(vals: any[][]) {
    if (vals.length !== this.nr || vals.some((r) => r.length !== this.nc)) throw new Error(`setValues: dimensiones incorrectas ${vals.length}x${vals[0]?.length} vs ${this.nr}x${this.nc}`);
    for (let i = 0; i < this.nr; i++) {
      const idx = this.r - 1 + i;
      while (this.sheet.data.length <= idx) this.sheet.data.push([]);
      const row = this.sheet.data[idx];
      for (let j = 0; j < this.nc; j++) {
        let v = vals[i][j];
        if (typeof v === 'string' && /^[=+]/.test(v)) throw new Error('Se intentó escribir una fórmula: ' + v);
        if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1); // Sheets guarda el texto sin el apóstrofo inicial
        row[this.c - 1 + j] = v;
      }
    }
    this.sheet.writes++;
    return this;
  }
  setNumberFormat() { return this; }
  setDataValidation(rule: any) { this.sheet.validations.push([this.c, rule]); return this; }
  setNote(note: string) { this.sheet.notes[`${this.r},${this.c}`] = note; return this; }
  setFormula(f: string) { this.sheet.formulas[`${this.r},${this.c}`] = f; return this; }
  getRow() { return this.r; }
  getLastRow() { return this.r + this.nr - 1; }
  getSheet() { return this.sheet; }
  clearContent() {
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i];
      if (row) for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = '';
    }
    // quitar filas vacías al final, como getLastRow de Sheets
    while (this.sheet.data.length && this.sheet.data[this.sheet.data.length - 1].every((x: any) => x === '' || x === undefined)) this.sheet.data.pop();
    return this;
  }
}

export class FakeSheet {
  data: any[][] = [];
  writes = 0;
  maxRows = 1000; // valores por defecto de una hoja nueva en Google Sheets
  maxCols = 26;
  hidden: number[] = [];
  notes: Record<string, string> = {};
  formulas: Record<string, string> = {};
  validations: [number, any][] = [];
  constructor(public name: string, public parent?: FakeSpreadsheet) {}
  getParent() { return this.parent; }
  hideColumns(c: number, n: number) { for (let i = 0; i < n; i++) this.hidden.push(c + i); return this; }
  clear() { this.data = []; this.notes = {}; this.formulas = {}; return this; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_after: number, n: number) { this.maxRows += n; return this; }
  insertColumnsAfter(_after: number, n: number) { this.maxCols += n; return this; }
  getName() { return this.name; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return Math.max(0, ...this.data.map((r) => r.length)); }
  getMaxRows() { return this.maxRows; }
  getRange(r: number, c: number, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  appendRow(row: any[]) { if (this.data.length + 1 > this.maxRows) this.maxRows++; this.maxCols = Math.max(this.maxCols, row.length); this.data.push(row.map((v) => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v))); return this; }
  setFrozenRows() { return this; }
}

class FakeSpreadsheet {
  sheets: FakeSheet[] = [];
  constructor(public id: string, public name: string) {}
  getId() { return this.id; }
  getUrl() { return `https://docs.google.com/spreadsheets/d/${this.id}`; }
  getSheetByName(n: string) { return this.sheets.find((s) => s.name === n) ?? null; }
  insertSheet(n: string) { const s = new FakeSheet(n, this); this.sheets.push(s); return s; }
  getSheets() { return [...this.sheets]; }
  deleteSheet(sh: FakeSheet) { this.sheets = this.sheets.filter((x) => x !== sh); }
}

class FakeFile {
  trashed = false; description = '';
  constructor(public id: string, public name: string, public blob: FakeBlob, public parent: FakeFolder, public mime = blob.type) {}
  getMimeType() { return this.mime; }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return `https://drive.google.com/file/d/${this.id}`; }
  getBlob() { return this.blob; }
  setDescription(d: string) { this.description = d; return this; }
  isTrashed() { return this.trashed; }
  setTrashed(t: boolean) { this.trashed = t; return this; }
  moveTo(f: FakeFolder) { this.parent.files = this.parent.files.filter((x) => x !== this); f.files.push(this); this.parent = f; return this; }
}

class FakeFolder {
  folders: FakeFolder[] = []; files: FakeFile[] = [];
  constructor(public drive: FakeDrive, public id: string, public name: string) {}
  trashed = false;
  getId() { return this.id; }
  getName() { return this.name; }
  isTrashed() { return this.trashed; }
  getUrl() { return `https://drive.google.com/drive/folders/${this.id}`; }
  getFoldersByName(n: string) { return iter(this.folders.filter((f) => f.name === n)); }
  getFolders() { return iter(this.folders); }
  getFilesByName(n: string) { return iter(this.files.filter((f) => f.name === n)); }
  createFolder(n: string) { const f = this.drive.newFolder(n); this.folders.push(f); return f; }
  createFile(a: any, content?: string, mime?: string) {
    const blob = a instanceof FakeBlob ? a : new FakeBlob(Buffer.from(content ?? '', 'utf8'), mime ?? 'text/plain', a);
    const f = new FakeFile(randomUUID(), blob.name || a, blob, this);
    this.drive.files.set(f.id, f); this.files.push(f);
    return f;
  }
}

function iter<T>(list: T[]) { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }

class FakeDrive {
  folders = new Map<string, FakeFolder>(); files = new Map<string, FakeFile>();
  root = this.newFolder('Mi unidad');
  getRootFolder() { return this.root; }
  getFoldersByName(n: string) { return iter([...this.folders.values()].filter((f) => f.name === n)); }
  /** Busca una carpeta por ruta desde Mi unidad (para las pruebas). */
  path(...names: string[]): FakeFolder | undefined { let f: FakeFolder | undefined = this.root; for (const n of names) f = f?.folders.find((x) => x.name === n); return f; }
  newFolder(n: string) { const f = new FakeFolder(this, randomUUID(), n); this.folders.set(f.id, f); return f; }
  createFolder(n: string) { return this.newFolder(n); }
  getFolderById(id: string) { const f = this.folders.get(id); if (!f) throw new Error('No folder'); return f; }
  getFileById(id: string) { const f = this.files.get(id); if (!f) throw new Error('No file ' + id); return f; }
}

// ---- Calendar ----
export class FakeEvent {
  tags: Record<string, string> = {}; updated = new Date(); deleted = false; reminders: number[] = [];
  constructor(public cal: FakeCalendar, public id: string, public title: string, public start: Date, public end: Date, public allDay: boolean, public opts: any, public recurrence: any = null) {}
  touch() { this.updated = new Date(Math.max(Date.now(), this.updated.getTime() + 1000)); }
  getId() { return this.id; }
  getTitle() { return this.title; }
  setTitle(t: string) { this.title = t; this.touch(); }
  getLocation() { return this.opts.location ?? ''; }
  setLocation(l: string) { this.opts.location = l; this.touch(); }
  getDescription() { return this.opts.description ?? ''; }
  setDescription(d: string) { this.opts.description = d; this.touch(); }
  setTime(s: Date, e: Date) { this.start = s; this.end = e; this.touch(); }
  setAllDayDates(s: Date, e: Date) { this.start = s; this.end = e; this.touch(); }
  setRecurrence(r: any, s: Date, e?: Date) { this.recurrence = r; this.start = s; if (e) this.end = e; this.touch(); }
  isAllDayEvent() { return this.allDay; }
  getStartTime() { return this.start; }
  getEndTime() { return this.end; }
  getAllDayStartDate() { return this.start; }
  getAllDayEndDate() { return this.end; }
  getLastUpdated() { return this.updated; }
  setTag(k: string, v: string) { this.tags[k] = v; }
  getTag(k: string) { return this.tags[k] ?? null; }
  addPopupReminder(m: number) { this.reminders.push(m); }
  deleteEvent() { this.deleted = true; }
  deleteEventSeries() { this.deleted = true; }
}
export class FakeCalendar {
  events: FakeEvent[] = [];
  getId() { return 'primary'; }
  getName() { return 'Familia'; }
  private add(title: string, s: Date, e: Date, allDay: boolean, opts: any, rec: any = null) { const ev = new FakeEvent(this, randomUUID(), title, s, e, allDay, { ...opts }, rec); this.events.push(ev); return ev; }
  createEvent(t: string, s: Date, e: Date, o: any) { return this.add(t, s, e, false, o); }
  createAllDayEvent(t: string, s: Date, e: Date, o: any) { return this.add(t, s, e, true, o); }
  createEventSeries(t: string, s: Date, e: Date, r: any, o: any) { return this.add(t, s, e, false, o, r); }
  createAllDayEventSeries(t: string, s: Date, r: any, o: any) { return this.add(t, s, new Date(s.getTime() + 86400000), true, o, r); }
  getEventById(id: string) { return this.events.find((e) => e.id === id && !e.deleted) ?? null; }
  getEventSeriesById(id: string) { return this.getEventById(id); }
  getEvents(from: Date, to: Date) { return this.events.filter((e) => !e.deleted && e.start < to && e.end > from); }
}
function recurrenceBuilder() {
  const rule: any = { interval: () => rule, onlyOnWeekdays: () => rule, until: () => rule, times: () => rule };
  return { addDailyRule: () => rule, addWeeklyRule: () => rule, addMonthlyRule: () => rule, addYearlyRule: () => rule };
}

export interface GasServer {
  ctx: any; ss: () => FakeSpreadsheet; book: (k: string) => FakeSpreadsheet; tab: (entity: string) => FakeSheet; drive: FakeDrive; calendar: FakeCalendar; props: Map<string, string>; token: string;
  triggers: { fn: string; src?: string }[]; edit: (entity: string, row: number) => void;
  call: (action: string, payload?: any) => any; gmailMessages: any[];
}

function pad(n: number) { return String(n).padStart(2, '0'); }
function formatDate(d: Date, _tz: string, fmt: string) {
  return fmt.replace("'T'", 'T').replace('yyyy', String(d.getFullYear())).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate()))
    .replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes())).replace('ss', pad(d.getSeconds()));
}

export function createGasServer(opts: { token?: string } = {}): GasServer {
  const token = opts.token ?? 'token-de-prueba-0123456789abcdef';
  const props = new Map<string, string>([['HOGAR_TOKEN', token]]);
  const spreadsheets = new Map<string, FakeSpreadsheet>();
  const drive = new FakeDrive();
  const calendar = new FakeCalendar();
  const triggers: { fn: string; src?: string }[] = [];
  const gmailMessages: any[] = [];
  const ctx: any = {
    console,
    Logger: { log: () => undefined },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => { props.set(k, String(v)); }, deleteProperty: (k: string) => { props.delete(k); } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => undefined, releaseLock: () => undefined }) },
    SpreadsheetApp: {
      create: (name: string) => {
        const s = new FakeSpreadsheet(randomUUID(), name); spreadsheets.set(s.id, s);
        const f = new FakeFile(s.id, name, new FakeBlob(Buffer.from(''), 'application/vnd.google-apps.spreadsheet', name), drive.root, 'application/vnd.google-apps.spreadsheet');
        drive.files.set(s.id, f); drive.root.files.push(f);
        s.sheets.push(new FakeSheet('Hoja 1', s));
        return s;
      },
      newDataValidation: () => { const b: any = { rule: {}, requireValueInList: (l: string[]) => { b.rule.list = l; return b; }, setAllowInvalid: () => b, build: () => b.rule }; return b; },
      openById: (id: string) => { const s = spreadsheets.get(id); if (!s) throw new Error('No ss'); return s; },
    },
    DriveApp: drive,
    Utilities: {
      getUuid: () => randomUUID(),
      base64Decode: (s: string) => toSigned(Buffer.from(s, 'base64')),
      base64Encode: (bytes: number[]) => toBuf(bytes).toString('base64'),
      computeDigest: (_alg: string, value: any) => toSigned(createHash('sha256').update(typeof value === 'string' ? Buffer.from(value, 'utf8') : toBuf(value)).digest()),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      newBlob: (bytes: number[], mime: string, name: string) => new FakeBlob(toBuf(bytes), mime, name),
      formatDate,
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'la cuenta de Google de la familia' }), getScriptTimeZone: () => 'America/Argentina/Buenos_Aires' },
    ScriptApp: {
      getProjectTriggers: () => triggers.map((t) => ({ getHandlerFunction: () => t.fn, getTriggerSourceId: () => t.src })),
      newTrigger: (fn: string) => { let src: string | undefined; const b: any = { timeBased: () => b, everyDays: () => b, atHour: () => b, everyHours: () => b, forSpreadsheet: (ss: any) => { src = ss.getId(); return b; }, onEdit: () => b, onChange: () => b, create: () => { triggers.push({ fn, src }); } }; return b; },
    },
    ContentService: { createTextOutput: (s: string) => ({ content: s, setMimeType() { return this; }, getContent() { return this.content; } }), MimeType: { JSON: 'json' } },
    CalendarApp: {
      getDefaultCalendar: () => calendar, getCalendarById: () => calendar, getAllOwnedCalendars: () => [calendar], newRecurrence: recurrenceBuilder,
      Weekday: { SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6 },
    },
    GmailApp: {
      search: (q: string, _s: number, max: number) => gmailMessages.filter((m) => m.subject.toLowerCase().includes(q.split(' ')[0].toLowerCase())).slice(0, max).map((m) => ({ getId: () => m.threadId, getMessages: () => [msg(m)] })),
      getMessageById: (id: string) => { const m = gmailMessages.find((x) => x.id === id); return m ? msg(m) : null; },
    },
  };
  function msg(m: any) {
    return {
      getId: () => m.id, getSubject: () => m.subject, getFrom: () => m.from, getDate: () => new Date(m.date), getPlainBody: () => m.body,
      getAttachments: () => (m.attachments ?? []).map((a: any) => ({ getName: () => a.name, getContentType: () => a.mime, getSize: () => a.bytes.length, getBytes: () => toSigned(a.bytes) })),
    };
  }
  vm.createContext(ctx);
  const dir = path.resolve(__dirname, '../apps-script');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.gs')).sort()) vm.runInContext(readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  const call = (action: string, payload: any = {}) => {
    const out = ctx.doPost({ postData: { contents: JSON.stringify({ ...payload, action, token: payload.token ?? token }) } });
    return JSON.parse(out.getContent());
  };
  const book = (k: string) => spreadsheets.get(props.get('SS_' + k)!)!;
  const tab = (entity: string) => { const pl = ctx.SCHEMA.placement[entity]; return book(pl[0]).getSheetByName(pl[1])!; };
  /** Simula una edición a mano de la fila `row` (número de fila de la hoja) y dispara el activador "Al editar". */
  const edit = (entity: string, row: number) => { const sh = tab(entity); ctx.onSheetEdit({ range: sh.getRange(row, 11) }); };
  return { ctx, ss: () => book('app'), book, tab, drive, calendar, props, token, call, gmailMessages, triggers, edit };
}

/** Transporte hacia el servidor emulado, con inyección de fallas de red. */
export class GasTransport implements Transport {
  failNext: null | 'before' | 'after' = null;
  failAction: string | null = 'push'; // acción a la que se aplica la falla inyectada
  online = true;
  calls: string[] = [];
  constructor(private server: GasServer) {}
  async call<T = any>(action: string, payload: Record<string, any> = {}): Promise<T> {
    this.calls.push(action);
    if (!this.online) throw new BackendError('Sin conexión con el servidor de Google.', 'network', true);
    const mode = !this.failAction || this.failAction === action ? this.failNext : null;
    if (mode === 'before') { this.failNext = null; throw new BackendError('Sin conexión con el servidor de Google.', 'network', true); }
    // ida y vuelta por JSON, como en la red
    const res = this.server.call(action, JSON.parse(JSON.stringify(payload)));
    if (mode === 'after') { this.failNext = null; throw new BackendError('Tiempo de espera agotado al contactar a Google.', 'network', true); }
    if (!res.ok) throw new BackendError(res.error, res.code, res.code !== 'auth' && res.code !== 'schema');
    return res.result as T;
  }
}
