import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import { Banner, StatusChip } from '../../ui/components';
import { Checkbox, NumberField, SelectField, TextField } from '../../ui/fields';
import { ConfirmSheet } from '../../ui/Sheet';
import { DEFAULT_CATEGORIES, SOFT, type Category, type CategoryModule } from '../../domain/catalog';
import { CAPABILITY_LABEL, DEFAULT_PERMISSIONS, type Capability, type PermissionMatrix } from '../../domain/permissions';
import { setConfig, type NotificationSettings } from '../../services/config';
import { DEFAULT_AI_SETTINGS, type AISettings } from '../../ai/types';
import { speechRecognitionAvailable } from '../../ai/processors';
import { loadDemo, countDemo } from '../../services/demo';
import { ENTITY_NAMES } from '../../domain/types';
import { formatDateTimeHuman } from '../../domain/dates';
import schema from '../../../shared/schema.json';
import { humanSize } from '../../services/files';

const MODULE_LABEL: Record<CategoryModule, string> = { events: 'Eventos', tasks: 'Tareas', shopping: 'Compras', payments: 'Pagos', expenses: 'Gastos', documents: 'Documentos', assets: 'Elementos de la casa', maintenance: 'Mantenimiento' };

export function CategoriesPanel() {
  const { repo, categories, run, profile } = useApp();
  const [mod, setMod] = useState<CategoryModule>('tasks');
  const [list, setList] = useState<Category[]>([]);
  useEffect(() => setList(categories(mod)), [mod]);
  const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cat';
  const save = () => run(() => setConfig(repo, `categories.${mod}`, list.filter((c) => c.label.trim()), profile?.id), 'Categorías guardadas');
  return (
    <div className="stack">
      <SelectField label="Módulo" value={mod} onChange={(v) => setMod(v as CategoryModule)} options={Object.entries(MODULE_LABEL).map(([value, label]) => ({ value: value as CategoryModule, label }))} />
      <p className="small muted">Renombrar o recolorear una categoría no cambia los registros (se guarda el identificador). Si quitás una categoría en uso, esos registros la siguen mostrando con su identificador.</p>
      <div className="card card-pad stack-sm">
        {list.map((c, i) => (
          <div key={c.id} className="row">
            <input className="input" aria-label={`Nombre de la categoría ${c.label}`} value={c.label} onChange={(e) => setList(list.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
            <select className="input" style={{ width: 110, background: c.color }} aria-label="Color" value={c.color} onChange={(e) => setList(list.map((x, k) => (k === i ? { ...x, color: e.target.value } : x)))}>
              {Object.entries(SOFT).map(([n, v]) => <option key={n} value={v}>{n}</option>)}
            </select>
            <button className="icon-btn" aria-label={`Quitar ${c.label}`} onClick={() => setList(list.filter((_, k) => k !== i))}><Trash2 size={16} /></button>
          </div>
        ))}
        <div className="row-wrap">
          <button className="btn btn-sm" onClick={() => setList([...list, { id: `${slug('nueva')}-${Date.now().toString(36)}`, label: 'Nueva categoría', color: SOFT.gray }])}><Plus size={14} /> Agregar</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setList(DEFAULT_CATEGORIES[mod])}>Restaurar predeterminadas</button>
          <span className="spacer" />
          <button className="btn btn-primary btn-sm" onClick={save}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

export function PermissionsPanel() {
  const { repo, permissions, run, profile } = useApp();
  const full = (x: PermissionMatrix): PermissionMatrix => ({ adult: { ...DEFAULT_PERMISSIONS.adult, ...x.adult }, family: { ...DEFAULT_PERMISSIONS.family, ...x.family }, child: { ...DEFAULT_PERMISSIONS.child, ...x.child } });
  const [m, setM] = useState<PermissionMatrix>(full(permissions));
  useEffect(() => setM(full(permissions)), [JSON.stringify(permissions)]);
  const caps = Object.keys(CAPABILITY_LABEL) as Capability[];
  const locked: Capability[] = ['settings.admin', 'integrations.manage', 'backup.manage', 'profiles.manage'];
  return (
    <div className="stack">
      <Banner tone="warn">Estos permisos ordenan la interfaz en el modo familiar compartido. No son seguridad real: quien tenga el dispositivo puede cambiar de perfil. La protección de los datos depende del token del backend y de los permisos de la cuenta de Google.</Banner>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="simple">
          <thead><tr><th>Permiso</th><th>Adultos</th><th>Familia (todos)</th><th>Chicos</th></tr></thead>
          <tbody>{caps.map((c) => (
            <tr key={c}>
              <td>{CAPABILITY_LABEL[c]}</td>
              <td><input type="checkbox" aria-label={`${CAPABILITY_LABEL[c]} para adultos`} checked={m.adult[c]} disabled={locked.includes(c)} onChange={(e) => setM({ ...m, adult: { ...m.adult, [c]: e.target.checked } })} /></td>
              <td><input type="checkbox" aria-label={`${CAPABILITY_LABEL[c]} para el perfil Familia`} checked={m.family[c]} disabled={locked.includes(c)} onChange={(e) => setM({ ...m, family: { ...m.family, [c]: e.target.checked } })} /></td>
              <td><input type="checkbox" aria-label={`${CAPABILITY_LABEL[c]} para chicos`} checked={m.child[c]} disabled={locked.includes(c)} onChange={(e) => setM({ ...m, child: { ...m.child, [c]: e.target.checked } })} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="row-wrap">
        <button className="btn btn-primary" onClick={() => run(() => setConfig(repo, 'permissions', m, profile?.id), 'Permisos guardados')}>Guardar</button>
        <button className="btn btn-ghost" onClick={() => setM(DEFAULT_PERMISSIONS)}>Restaurar predeterminados</button>
      </div>
    </div>
  );
}

export function NotificationsPanel() {
  const { repo, notifSettings, run, profile, toast } = useApp();
  const [s, setS] = useState<NotificationSettings>(notifSettings);
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  useEffect(() => setS(notifSettings), [JSON.stringify(notifSettings)]);
  const ask = async () => {
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === 'granted') setS({ ...s, browser: true });
  };
  const test = async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification('Hogar', { body: 'Notificación de prueba', icon: './icons/icon-192.png' });
    else if (typeof Notification !== 'undefined') new Notification('Hogar', { body: 'Notificación de prueba' });
    toast('Se envió una notificación de prueba.', { tone: 'ok' });
  };
  return (
    <div className="stack">
      <Banner tone="info">El centro de avisos de la app siempre funciona. Las notificaciones del sistema solo se muestran mientras la app está abierta o en segundo plano reciente: sin un servidor de notificaciones push (no incluido para mantener costo cero) no son fiables con la app cerrada. Para recordatorios con la app cerrada, marcá los eventos para Google Calendar y usá sus recordatorios.</Banner>
      <div className="card card-pad form">
        <Checkbox label="Mostrar avisos en la app" checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} />
        <div className="row-wrap">
          <span className="small">Notificaciones del sistema: <StatusChip tone={perm === 'granted' ? 'ok' : perm === 'denied' ? 'alert' : 'neutral'}>{perm === 'granted' ? 'permitidas' : perm === 'denied' ? 'bloqueadas en el navegador' : perm === 'unsupported' ? 'no compatibles' : 'sin pedir'}</StatusChip></span>
          {perm === 'default' && <button className="btn btn-sm" onClick={ask}>Permitir</button>}
          {perm === 'granted' && <button className="btn btn-sm btn-ghost" onClick={test}>Probar</button>}
        </div>
        {perm === 'granted' && <Checkbox label="Usar notificaciones del sistema" checked={s.browser} onChange={(v) => setS({ ...s, browser: v })} />}
        <div className="form-row">
          <NumberField label="Eventos: minutos antes" value={s.eventLeadMinutes} onChange={(v) => setS({ ...s, eventLeadMinutes: v ?? 60 })} />
          <NumberField label="Pagos: días antes" value={s.paymentLeadDays} onChange={(v) => setS({ ...s, paymentLeadDays: v ?? 3 })} />
        </div>
        <div className="form-row">
          <NumberField label="Tareas: días antes" value={s.taskLeadDays} onChange={(v) => setS({ ...s, taskLeadDays: v ?? 1 })} />
          <NumberField label="Mantenimiento: días antes" value={s.maintenanceLeadDays} onChange={(v) => setS({ ...s, maintenanceLeadDays: v ?? 3 })} />
        </div>
        <div className="form-row">
          <TextField label="Silencio desde" type="time" value={s.quietFrom} onChange={(v) => setS({ ...s, quietFrom: v })} />
          <TextField label="Silencio hasta" type="time" value={s.quietTo} onChange={(v) => setS({ ...s, quietTo: v })} />
        </div>
        <div className="field"><span className="field-label">Tipos de aviso</span>
          {(Object.keys(s.categories) as (keyof NotificationSettings['categories'])[]).map((k) => <Checkbox key={k} label={k} checked={s.categories[k]} onChange={(v) => setS({ ...s, categories: { ...s.categories, [k]: v } })} />)}
        </div>
        <button className="btn btn-primary" onClick={() => run(() => setConfig(repo, 'notifications', s, profile?.id), 'Preferencias guardadas')}>Guardar</button>
      </div>
    </div>
  );
}

export function AssistantPanel() {
  const { ai, setAI, toast } = useApp();
  const [s, setS] = useState<AISettings>(ai);
  useEffect(() => setS(ai), [JSON.stringify(ai)]);
  const testLLM = async () => {
    try {
      const r = await fetch(s.llm.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: s.llm.model, messages: [{ role: 'user', content: 'Respondé solo: ok' }] }) });
      toast(r.ok ? 'El modelo local respondió correctamente.' : `El modelo respondió ${r.status}.`, { tone: r.ok ? 'ok' : 'error' });
    } catch { toast('No se pudo conectar. Verificá que el servidor local esté encendido y permita este origen (CORS).', { tone: 'error' }); }
  };
  return (
    <div className="stack">
      <div className="card card-pad form">
        <SelectField label="Interpretación" value={s.mode} onChange={(v) => setS({ ...s, mode: v as AISettings['mode'] })}
          options={[{ value: 'reglas', label: 'Automática con reglas locales (recomendado, sin costo, sin conexión)' }, { value: 'manual', label: 'Desactivada: completar todo a mano' }]} />
        <Checkbox label="Leer texto de imágenes y capturas (OCR en el dispositivo)" checked={s.ocr} onChange={(v) => setS({ ...s, ocr: v })} hint="Tesseract.js; la primera vez descarga ~5 MB" />
        <Checkbox label="Leer texto de PDF (en el dispositivo)" checked={s.pdfText} onChange={(v) => setS({ ...s, pdfText: v })} />
        <Checkbox label="Dictado por voz del navegador" checked={s.speech} onChange={(v) => setS({ ...s, speech: v })}
          hint={speechRecognitionAvailable() ? 'en Chrome/Android el audio lo procesa Google para transcribir' : 'este navegador no lo admite'} />
        <Checkbox label="Transcribir audios en el dispositivo (Whisper, experimental)" checked={s.whisper} onChange={(v) => setS({ ...s, whisper: v })} hint="descarga ~80 MB la primera vez; puede ser lento en celulares" />
        <details className="more"><summary>Modelo de lenguaje local (opcional, avanzado)</summary>
          <div className="form" style={{ marginTop: 8 }}>
            <p className="small muted">Para quienes tengan un servidor local gratuito como Ollama en la red de la casa. No se usan servicios pagos ni claves. Requiere permitir el origen de la app (OLLAMA_ORIGINS) y, desde una app con HTTPS, un acceso HTTPS al servidor.</p>
            <Checkbox label="Usar modelo local" checked={s.llm.enabled} onChange={(v) => setS({ ...s, llm: { ...s.llm, enabled: v } })} />
            <TextField label="Endpoint (compatible con OpenAI)" value={s.llm.endpoint} onChange={(v) => setS({ ...s, llm: { ...s.llm, endpoint: v } })} />
            <TextField label="Modelo" value={s.llm.model} onChange={(v) => setS({ ...s, llm: { ...s.llm, model: v } })} />
            <button className="btn btn-sm" onClick={testLLM}>Probar conexión</button>
          </div>
        </details>
        <div className="row-wrap">
          <button className="btn btn-primary" onClick={() => setAI(s).then(() => toast('Ajustes del asistente guardados (en este dispositivo).', { tone: 'ok' }))}>Guardar</button>
          <button className="btn btn-ghost" onClick={() => setS(DEFAULT_AI_SETTINGS)}>Restaurar</button>
        </div>
      </div>
      <Banner tone="info">Ningún modo guarda datos sin tu confirmación. Las reglas locales entienden fechas ("mañana", "el martes", "15/10"), horas, importes en pesos y dólares, integrantes y repeticiones; lo que no entienden queda marcado para completar.</Banner>
    </div>
  );
}

export function AppearancePanel() {
  const { prefs, setPrefs } = useApp();
  return (
    <div className="card card-pad form">
      <SelectField label="Tema" value={prefs.theme} onChange={(v) => setPrefs({ theme: v as any })} options={[{ value: 'auto', label: 'Automático (según el sistema)' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Oscuro' }]} />
      <SelectField label="Tamaño de letra" value={prefs.size} onChange={(v) => setPrefs({ size: v as any })} options={[{ value: 'normal', label: 'Normal' }, { value: 'large', label: 'Grande' }]} />
      <p className="small muted">Los bloques de la pantalla de Inicio se configuran por perfil en Familia → Editar.</p>
    </div>
  );
}

export function PrivacyPanel() {
  const { repo, run } = useApp();
  const [wipe, setWipe] = useState(false);
  return (
    <div className="stack small">
      <div className="card card-pad stack-sm">
        <h3>Qué se procesa en este dispositivo</h3>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Todos los datos se guardan primero en el navegador (IndexedDB) de este dispositivo.</li>
          <li>La interpretación del asistente (reglas), la lectura de imágenes (Tesseract) y de PDF (pdf.js) y la transcripción con Whisper se ejecutan en el dispositivo. Las bibliotecas se descargan de CDNs públicos (jsDelivr, Hugging Face) pero no se les envía contenido.</li>
        </ul>
      </div>
      <div className="card card-pad stack-sm">
        <h3>Qué se envía a servicios externos</h3>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><strong>Google (cuenta familiar)</strong>, solo si conectás la integración: registros a Google Sheets, archivos a Google Drive, eventos marcados a Google Calendar; lectura de correos elegidos en Gmail y respuestas de Forms.</li>
          <li><strong>Dictado por voz</strong> (si lo activás): en Chrome/Android el audio lo procesa Google para transcribirlo.</li>
          <li><strong>Modelo local opcional</strong>: el texto se envía al servidor que configures (por ejemplo, una computadora de la casa).</li>
          <li>La app no envía datos a proveedores de IA en la nube ni los usa para entrenar modelos.</li>
        </ul>
      </div>
      <div className="card card-pad stack-sm">
        <h3>Borrar los datos de este dispositivo</h3>
        <p>Elimina la base local (no borra Google Sheets ni Drive). Exportá una copia antes.</p>
        <button className="btn btn-danger" onClick={() => setWipe(true)}>Borrar datos locales</button>
      </div>
      <ConfirmSheet open={wipe} onClose={() => setWipe(false)} title="Borrar datos locales" danger confirmLabel="Borrar"
        message={<p>Se eliminarán TODOS los datos de este dispositivo, incluidos cambios no sincronizados y archivos no subidos. ¿Seguro?</p>}
        onConfirm={() => run(async () => { repo.db.close(); await indexedDB.deleteDatabase('hogar'); location.reload(); })} />
    </div>
  );
}

export function SystemPanel() {
  const { syncStatus: s, backend, online } = useApp();
  const counts = useLive(async (r) => Object.fromEntries(await Promise.all(ENTITY_NAMES.map(async (n) => [n, await r.db.table(n).count()] as const))), [], {} as Record<string, number>);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [sw, setSw] = useState('');
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setStorage((x) => ({ ...x, usage: e.usage, quota: e.quota })));
    navigator.storage?.persisted?.().then((p) => setStorage((x) => ({ ...x, persisted: p })));
    navigator.serviceWorker?.getRegistration().then((r) => setSw(r ? (r.active ? 'activo' : 'instalando') : 'no registrado'));
  }, []);
  const feat = (ok: boolean) => <StatusChip tone={ok ? 'ok' : 'neutral'}>{ok ? 'sí' : 'no'}</StatusChip>;
  return (
    <div className="stack">
      <div className="card card-pad">
        <h3 style={{ marginBottom: 8 }}>Salud técnica</h3>
        <dl className="kv small">
          <dt>Google</dt><dd>{backend ? 'conectado' : 'no conectado'}</dd>
          <dt>Conexión</dt><dd>{online ? 'en línea' : 'sin conexión'}</dd>
          <dt>Última sincronización</dt><dd>{formatDateTimeHuman(s?.lastSyncAt)}</dd>
          <dt>Pendientes / errores / conflictos</dt><dd>{s?.pending ?? 0} / {s?.errors ?? 0} / {s?.conflicts ?? 0}</dd>
          <dt>Revisión local</dt><dd>{s?.lastRev ?? 0}</dd>
          <dt>Service worker (uso sin conexión)</dt><dd>{sw || '—'}</dd>
          <dt>Almacenamiento</dt><dd>{storage.usage != null ? `${humanSize(storage.usage)} de ${humanSize(storage.quota ?? 0)}` : '—'} · persistente: {storage.persisted ? 'sí' : 'no'}</dd>
          <dt>Versión de esquema</dt><dd>{schema.schemaVersion}</dd>
          <dt>Instalada como app</dt><dd>{feat(matchMedia('(display-mode: standalone)').matches)}</dd>
          <dt>Notificaciones</dt><dd>{feat(typeof Notification !== 'undefined')}</dd>
          <dt>Micrófono</dt><dd>{feat(!!navigator.mediaDevices)}</dd>
          <dt>Dictado del navegador</dt><dd>{feat(speechRecognitionAvailable())}</dd>
        </dl>
      </div>
      <div className="card card-pad">
        <h3 style={{ marginBottom: 8 }}>Registros locales</h3>
        <dl className="kv small">{Object.entries(counts).map(([k, v]) => <><dt key={k}>{k}</dt><dd key={k + 'v'}>{v}</dd></>)}</dl>
      </div>
      <p className="small muted">Para diagnosticar errores de sincronización, mirá Ajustes → Sincronización → Registro. La guía docs/TROUBLESHOOTING.md lista los problemas frecuentes.</p>
    </div>
  );
}

export function DemoPanel() {
  const { repo, run, profile } = useApp();
  const n = useLive((r) => countDemo(r), [], 0);
  return (
    <div className="stack">
      <Banner tone="warn">Los datos de demostración sirven para probar la app. Llevan el prefijo "[Demo]", están marcados internamente y se eliminan con un botón. No representan información real.</Banner>
      <div className="row-wrap">
        <button className="btn" onClick={() => run(() => loadDemo(repo, profile?.id), 'Datos de demostración cargados')}>Cargar datos de demostración</button>
        <button className="btn btn-danger" disabled={!n} onClick={() => run(() => repo.purgeDemo(), 'Datos de demostración eliminados')}>Eliminar datos de demostración ({n})</button>
      </div>
    </div>
  );
}
