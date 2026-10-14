// Permisos por rol. IMPORTANTE: en el modo familiar compartido el perfil NO es una identidad autenticada.
// Estos permisos organizan la interfaz (p. ej. ocultar economía a los chicos) pero no son una barrera de seguridad:
// cualquiera con el dispositivo desbloqueado puede cambiar de perfil (salvo PIN, que es solo disuasivo).
// La seguridad real de los datos depende del token del backend (Apps Script) y de los permisos de Google Drive/Sheets.
import type { DocumentRecord, Profile, Role } from './types';

export type Capability =
  | 'finance.view' | 'finance.edit' | 'documents.private' | 'settings.admin' | 'profiles.manage'
  | 'integrations.manage' | 'backup.manage' | 'tasks.assignOthers' | 'events.edit' | 'house.edit';

export type PermissionMatrix = Record<Role, Record<Capability, boolean>>;

export const DEFAULT_PERMISSIONS: PermissionMatrix = {
  adult: {
    'finance.view': true, 'finance.edit': true, 'documents.private': true, 'settings.admin': true, 'profiles.manage': true,
    'integrations.manage': true, 'backup.manage': true, 'tasks.assignOthers': true, 'events.edit': true, 'house.edit': true,
  },
  // Perfil "Familia": vista compartida de todos. Cualquiera puede elegirlo, por eso no muestra economía ni privados.
  family: {
    'finance.view': false, 'finance.edit': false, 'documents.private': false, 'settings.admin': false, 'profiles.manage': false,
    'integrations.manage': false, 'backup.manage': false, 'tasks.assignOthers': true, 'events.edit': true, 'house.edit': true,
  },
  child: {
    'finance.view': false, 'finance.edit': false, 'documents.private': false, 'settings.admin': false, 'profiles.manage': false,
    'integrations.manage': false, 'backup.manage': false, 'tasks.assignOthers': false, 'events.edit': true, 'house.edit': false,
  },
};

export const CAPABILITY_LABEL: Record<Capability, string> = {
  'finance.view': 'Ver economía', 'finance.edit': 'Editar pagos y gastos', 'documents.private': 'Ver documentos privados',
  'settings.admin': 'Administrar configuración', 'profiles.manage': 'Gestionar perfiles', 'integrations.manage': 'Gestionar integraciones',
  'backup.manage': 'Copias de seguridad', 'tasks.assignOthers': 'Asignar tareas a otros', 'events.edit': 'Crear y editar eventos',
  'house.edit': 'Editar casa y mantenimiento',
};

export function can(profile: Pick<Profile, 'role'> | undefined | null, cap: Capability, matrix: PermissionMatrix = DEFAULT_PERMISSIONS): boolean {
  if (!profile) return false;
  // Las capacidades de administración nunca se otorgan a perfiles infantiles aunque se edite la matriz.
  if (profile.role !== 'adult' && (cap === 'settings.admin' || cap === 'integrations.manage' || cap === 'backup.manage' || cap === 'profiles.manage')) return false;
  return (matrix[profile.role] ?? DEFAULT_PERMISSIONS[profile.role])?.[cap] ?? false;
}

export function canSeeDocument(profile: Profile | undefined | null, doc: DocumentRecord, matrix?: PermissionMatrix): boolean {
  if (!profile) return false;
  if (doc.visibility === 'familia') return true;
  if (doc.visibility === 'personal') return doc.ownerId === profile.id || doc.personId === profile.id;
  return can(profile, 'documents.private', matrix);
}

export type ModuleKey = 'inicio' | 'agenda' | 'tareas' | 'compras' | 'economia' | 'inversiones' | 'casa' | 'familia' | 'documentos' | 'asistente' | 'ajustes';
export function canOpenModule(profile: Profile | undefined | null, mod: ModuleKey, matrix?: PermissionMatrix): boolean {
  if (!profile) return mod === 'ajustes' || mod === 'inicio';
  if (mod === 'economia' || mod === 'inversiones') return can(profile, 'finance.view', matrix); // nunca para chicos ni el perfil Familia
  if (mod === 'casa') return profile.role !== 'child' || can(profile, 'house.edit', matrix);
  return true;
}

/** Hash del PIN opcional para cambiar a un perfil adulto. Disuasivo, no es seguridad fuerte. */
export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Quién puede autorizar un cambio de perfil (lista vacía = no hace falta PIN):
 * - Desde un adulto o desde Familia se pasa a cualquier perfil sin PIN (los adultos van y vienen).
 * - Desde un chico, salir de su perfil (a un adulto, a Familia o al de un hermano) pide el PIN de un adulto.
 * - En la pantalla inicial (sin perfil elegido): un chico entra directo; un adulto con PIN pide el suyo; Familia pide
 *   el de cualquier adulto.
 * Si ningún adulto cargó un PIN, no hay forma de bloquear y se entra libremente.
 */
export function pinHoldersFor(current: Profile | undefined, target: Profile, profiles: Profile[]): Profile[] {
  if (current?.id === target.id) return [];
  const adultsWithPin = profiles.filter((p) => p.active && p.role === 'adult' && p.pinHash);
  if (current && current.role !== 'child') return [];
  if (!current) {
    if (target.role === 'child') return [];
    if (target.role === 'adult') return target.pinHash ? [target] : [];
    return adultsWithPin;
  }
  return target.role === 'adult' && target.pinHash ? [target, ...adultsWithPin.filter((a) => a.id !== target.id)] : adultsWithPin;
}

/** ¿El PIN corresponde a alguno de los autorizados? */
export async function pinMatches(pin: string, holders: Profile[]): Promise<boolean> {
  for (const h of holders) if (h.pinHash && (await hashPin(pin, h.id)) === h.pinHash) return true;
  return false;
}
