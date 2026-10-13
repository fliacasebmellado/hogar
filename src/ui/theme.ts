// Colores derivados: a partir del color de cada perfil se calculan un fondo suave (tint), un tono fuerte para íconos
// y textos (ink) y el color de texto legible encima (on). También los colores e íconos de cada módulo y categoría.

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
export function mix(hex: string, other: string, t: number) {
  const a = hexToRgb(hex), b = hexToRgb(other);
  return toHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}
function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
/** Texto legible sobre un color: oscuro o blanco, el que tenga más contraste. */
export function onColor(hex: string) { return contrast(hex, '#1c1917') >= contrast(hex, '#ffffff') ? '#1c1917' : '#ffffff'; }
export interface Tone { base: string; tint: string; soft: string; ink: string; on: string }
/** Tonos de un color: tint = fondo muy suave, soft = fondo de tarjeta, ink = íconos y acentos con contraste AA sobre blanco. */
export function tones(hex: string): Tone {
  let ink = hex;
  for (let i = 0; i < 12 && contrast(ink, '#ffffff') < 4.5; i++) ink = mix(ink, '#1c1917', 0.18);
  const base = mix(hex, '#ffffff', 0.5); // la paleta se usa al 50 % de transparencia
  return { base, tint: mix(hex, '#ffffff', 0.86), soft: mix(hex, '#ffffff', 0.68), ink, on: onColor(base) };
}

export type ModuleId = 'agenda' | 'tareas' | 'compras' | 'economia' | 'inversiones' | 'casa' | 'familia' | 'documentos' | 'asistente' | 'ajustes' | 'avisos';
/** Colores de módulos: apagados, en la misma familia que la paleta de perfiles. */
export const MODULE_COLOR: Record<ModuleId, string> = {
  inversiones: '#8a7a5c', agenda: '#6f87a3', tareas: '#7f9677', compras: '#c29a5b', economia: '#5c8a7d', casa: '#b07f6a',
  familia: '#a8919d', documentos: '#8d86a6', asistente: '#626b71', ajustes: '#8a8580', avisos: '#c08a5a',
};

const EVENT_ICON: Record<string, string> = {
  colegio: '🏫', actividades: '⚽', turnos: '📋', salud: '🩺', tramites: '🗂️', reuniones: '👥', cumpleanos: '🎂', familia: '🏡', otros: '📌',
};
const TASK_ICON: Record<string, string> = {
  limpieza: '🧽', ropa: '👕', cocina: '🍳', orden: '🧺', patio: '🌿', pileta: '🏊', mantenimiento: '🔧', tramites: '🗂️', familia: '🏡', otras: '✅',
};
const SHOP_ICON: Record<string, string> = {
  supermercado: '🛒', limpieza: '🧴', higiene: '🪥', ferreteria: '🔩', farmacia: '💊', colegio: '✏️', ropa: '👟', otras: '📦',
};
export const categoryIcon = (kind: 'events' | 'tasks' | 'shopping', id?: string) =>
  ({ events: EVENT_ICON, tasks: TASK_ICON, shopping: SHOP_ICON }[kind][id ?? ''] ?? { events: '📌', tasks: '✅', shopping: '📦' }[kind]);
