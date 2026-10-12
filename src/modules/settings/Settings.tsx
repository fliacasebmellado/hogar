import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { useApp } from '../../app/context';
import type { Capability } from '../../domain/permissions';
import { IntegrationsPanel } from './Integrations';
import { SyncPanel } from './SyncPanel';
import { BackupsPanel } from './Backups';
import { AppearancePanel, AssistantPanel, CategoriesPanel, DemoPanel, NotificationsPanel, PermissionsPanel, PrivacyPanel, SystemPanel } from './Panels';

const SECTIONS: { path: string; title: string; desc: string; cap?: Capability }[] = [
  { path: 'integraciones', title: 'Google (Sheets, Drive, Calendar, Gmail, Forms)', desc: 'Conexión, inicialización y estado', cap: 'integrations.manage' },
  { path: 'sincronizacion', title: 'Sincronización', desc: 'Pendientes, errores, conflictos y registro' },
  { path: 'copias', title: 'Copias de seguridad', desc: 'Exportar, restaurar y copias en Drive', cap: 'backup.manage' },
  { path: 'perfiles', title: 'Integrantes y perfiles', desc: 'Agregar, editar o desactivar perfiles' },
  { path: 'permisos', title: 'Permisos', desc: 'Qué puede ver y hacer cada tipo de perfil', cap: 'settings.admin' },
  { path: 'categorias', title: 'Categorías', desc: 'Tareas, eventos, compras, economía, documentos…', cap: 'settings.admin' },
  { path: 'notificaciones', title: 'Notificaciones', desc: 'Anticipación, horarios y tipos de aviso' },
  { path: 'asistente', title: 'Asistente', desc: 'Interpretación, lectura de imágenes y voz', cap: 'settings.admin' },
  { path: 'apariencia', title: 'Apariencia', desc: 'Tema, tamaño de letra y pantalla de inicio' },
  { path: 'privacidad', title: 'Privacidad y datos', desc: 'Qué se procesa en el dispositivo y qué en Google' },
  { path: 'sistema', title: 'Estado del sistema', desc: 'Salud técnica y diagnóstico' },
  { path: 'demo', title: 'Datos de demostración', desc: 'Cargar o eliminar datos de prueba', cap: 'settings.admin' },
];

export default function Settings() {
  const { can } = useApp();
  const loc = useLocation();
  const sub = loc.pathname.split('/')[2];
  const section = SECTIONS.find((s) => s.path === sub);
  if (section?.cap && !can(section.cap)) return <div className="empty"><p>Esta sección es solo para adultos.</p><Link to="/ajustes">Volver</Link></div>;
  return (
    <div>
      {section && <div className="row" style={{ marginBottom: 12 }}><Link to="/ajustes" className="btn btn-sm btn-ghost"><ChevronLeft size={16} /> Ajustes</Link><h2>{section.title}</h2></div>}
      <Routes>
        <Route index element={
          <div className="card"><ul className="list">
            {SECTIONS.filter((s) => !s.cap || can(s.cap)).map((s) => (
              <li key={s.path}><Link className="item" to={s.path === 'perfiles' ? '/familia' : `/ajustes/${s.path}`}><div className="item-main"><div className="item-title">{s.title}</div><div className="item-sub">{s.desc}</div></div><ChevronRight size={18} className="muted" /></Link></li>
            ))}
          </ul></div>
        } />
        <Route path="integraciones" element={<IntegrationsPanel />} />
        <Route path="sincronizacion" element={<SyncPanel />} />
        <Route path="copias" element={<BackupsPanel />} />
        <Route path="permisos" element={<PermissionsPanel />} />
        <Route path="categorias" element={<CategoriesPanel />} />
        <Route path="notificaciones" element={<NotificationsPanel />} />
        <Route path="asistente" element={<AssistantPanel />} />
        <Route path="apariencia" element={<AppearancePanel />} />
        <Route path="privacidad" element={<PrivacyPanel />} />
        <Route path="sistema" element={<SystemPanel />} />
        <Route path="demo" element={<DemoPanel />} />
      </Routes>
    </div>
  );
}
