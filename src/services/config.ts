// Configuración compartida (sincronizada) en la entidad `config`, con un registro por clave e id determinista.
import type { Repo } from '../db/repo';
import { DEFAULT_CATEGORIES, type Category, type CategoryModule } from '../domain/catalog';
import { DEFAULT_PERMISSIONS, type PermissionMatrix } from '../domain/permissions';
import type { ConfigEntry, ID } from '../domain/types';

const cfgId = (key: string) => `config-${key}`;

export async function getConfig<T>(repo: Repo, key: string, fallback: T): Promise<T> {
  const row = await repo.get('config', cfgId(key));
  return row && !row.deleted ? (row.value as T) : fallback;
}

export async function setConfig(repo: Repo, key: string, value: any, by?: ID): Promise<ConfigEntry> {
  const existing = await repo.get('config', cfgId(key));
  if (existing) return repo.update('config', existing.id, { value, deleted: false }, { by });
  return repo.create('config', { id: cfgId(key), key, value }, { by });
}

export function categoriesFrom(configRows: ConfigEntry[] | undefined, mod: CategoryModule): Category[] {
  const row = configRows?.find((r) => r.key === `categories.${mod}` && !r.deleted);
  if (!row) return DEFAULT_CATEGORIES[mod];
  // Si la familia personalizó las categorías, igual se suman las nuevas que trae la app (sin pisar las suyas).
  const own = row.value as Category[];
  return [...own, ...DEFAULT_CATEGORIES[mod].filter((d) => !own.some((c) => c.id === d.id))];
}
export function permissionsFrom(configRows: ConfigEntry[] | undefined): PermissionMatrix {
  const row = configRows?.find((r) => r.key === 'permissions' && !r.deleted);
  return (row?.value as PermissionMatrix) ?? DEFAULT_PERMISSIONS;
}

export interface NotificationSettings {
  enabled: boolean; browser: boolean; eventLeadMinutes: number; paymentLeadDays: number; taskLeadDays: number;
  maintenanceLeadDays: number; categories: { eventos: boolean; pagos: boolean; tareas: boolean; mantenimiento: boolean; sincronizacion: boolean };
  quietFrom: string; quietTo: string;
}
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true, browser: false, eventLeadMinutes: 60, paymentLeadDays: 3, taskLeadDays: 1, maintenanceLeadDays: 3,
  categories: { eventos: true, pagos: true, tareas: true, mantenimiento: true, sincronizacion: true }, quietFrom: '22:00', quietTo: '07:30',
};
export function notificationSettingsFrom(rows: ConfigEntry[] | undefined): NotificationSettings {
  const row = rows?.find((r) => r.key === 'notifications' && !r.deleted);
  return { ...DEFAULT_NOTIFICATION_SETTINGS, ...(row?.value ?? {}) };
}
