// Inicialización: crea la estructura mínima (hogar, perfiles de la familia y lista principal).
// No crea eventos, pagos, tareas ni documentos: nada de datos inventados.
// Los ids son deterministas para que dos dispositivos que se inicializan por separado no dupliquen perfiles.
import type { Repo } from '../db/repo';
import type { Profile } from '../domain/types';
import { DEFAULT_LIST_ID } from './shopping';

export const HOUSEHOLD_ID = 'household-main';
// Dirección pública de la aplicación web (no es secreta: sin el token familiar no da acceso a nada).
export const FAMILY_BACKEND_URL = 'https://script.google.com/macros/s/AKfycbyVNbcWZYwpZ-WM1wHD6r-vwlbMkAfv958CxzrlcotsAdegTOoCyMBLKgasA6DX0kQCZw/exec';

const DEFAULT_HOME_BLOCKS = ['agenda', 'tareas', 'pagos', 'compras', 'casa', 'recordatorios', 'responsabilidades', 'bandeja'];

// Perfiles iniciales GENÉRICOS (el código es público). Los nombres reales se cargan en la app y viajan por la planilla:
// un dispositivo nuevo los recibe al conectarse y descarta estos genéricos (ver SyncEngine.dropSeedPlaceholders).
// Paleta elegida por la familia (en pantalla se ve al 75 %).
export const FAMILY_PROFILE_ID = 'profile-familia';
const INITIAL_PROFILES: Partial<Profile>[] = [
  { id: 'profile-papa', name: 'Papá', role: 'adult', color: '#b9c2cf', avatar: 'P', aliases: ['papa'] },
  { id: 'profile-mama', name: 'Mamá', role: 'adult', color: '#aa9aad', avatar: 'M', aliases: ['mama'] },
  { id: 'profile-hijo', name: 'Hijo', role: 'child', color: '#c1cabc', avatar: 'H', aliases: [] },
  { id: 'profile-hija', name: 'Hija', role: 'child', color: '#d2c7cc', avatar: 'H', aliases: [] },
  { id: FAMILY_PROFILE_ID, name: 'Familia', role: 'family', color: '#c3bdaf', avatar: '👪', aliases: ['todos', 'toda la familia'] },
];

async function createMissing(repo: Repo, only?: string[]) {
  for (const p of INITIAL_PROFILES) {
    if (only && !only.includes(p.id!)) continue;
    if (await repo.get('profiles', p.id!)) continue;
    await repo.create('profiles', {
      ...p, active: true,
      prefs: { homeBlocks: DEFAULT_HOME_BLOCKS, simpleMode: p.role === 'child', notifyLeadMinutes: 60 },
    }, { origin: 'sistema', seed: true, skipHistory: true });
  }
}

export async function ensureSeed(repo: Repo): Promise<boolean> {
  const seeded = await repo.db.getKV<boolean>('seeded');
  if (seeded) { await upgradeSeed(repo); return false; }
  await repo.tx(async () => {
    if (!(await repo.get('household', HOUSEHOLD_ID))) {
      await repo.create('household', { id: HOUSEHOLD_ID, name: 'Familia', timezone: 'America/Argentina/Buenos_Aires', currency: 'ARS' }, { origin: 'sistema', seed: true, skipHistory: true });
    }
    await createMissing(repo);
    if (!(await repo.get('shoppingLists', DEFAULT_LIST_ID))) {
      await repo.create('shoppingLists', { id: DEFAULT_LIST_ID, name: 'Lista principal', isTemplate: false, archived: false }, { origin: 'sistema', seed: true, skipHistory: true });
    }
  });
  await repo.db.setKV('seeded', true);
  await repo.db.setKV('seedVersion', 2);
  return true;
}

/** Paletas anteriores (v2 y la primera versión de v3) → paleta actual de la familia. Solo se cambia un color que siga siendo el de fábrica (si alguien eligió otro, se respeta). */
const PALETTE_V3: Record<string, string> = { '#626b71': '#b9c2cf', '#8c8e84': '#c1cabc', '#c4b9c0': '#d2c7cc', '#b1afb6': '#aa9aad', '#c2bbb4': '#c3bdaf', '#73859f': '#b9c2cf', '#839579': '#c1cabc', '#a58f99': '#d2c7cc', '#55355b': '#aa9aad', '#877b5f': '#c3bdaf' };

/** Actualizaciones: v2 agrega el perfil Familia si falta; v3 aplica la paleta nueva (se revisa en cada inicio porque los
 * perfiles pueden llegar después desde la planilla con el color viejo). */
async function upgradeSeed(repo: Repo) {
  if ((await repo.db.getKV<number>('seedVersion', 1)) < 2) {
    await repo.tx(async () => { await createMissing(repo, [FAMILY_PROFILE_ID]); });
    await repo.db.setKV('seedVersion', 2);
  }
  await applyPaletteV3(repo);
}

export async function applyPaletteV3(repo: Repo) {
  const old = (await repo.list('profiles')).filter((p) => PALETTE_V3[p.color?.toLowerCase()]);
  if (!old.length) return;
  await repo.tx(async () => { for (const p of old) await repo.update('profiles', p.id, { color: PALETTE_V3[p.color.toLowerCase()] }, { origin: 'sistema', skipHistory: true }); });
}

export { DEFAULT_HOME_BLOCKS };
