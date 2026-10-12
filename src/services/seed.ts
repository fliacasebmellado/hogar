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
// Paleta Sherwin-Williams: Granite Peak, Swanky Gray, Ripe Olive, Enchant y Amazing Gray (Familia).
export const FAMILY_PROFILE_ID = 'profile-familia';
const INITIAL_PROFILES: Partial<Profile>[] = [
  { id: 'profile-papa', name: 'Papá', role: 'adult', color: '#626b71', avatar: 'P', aliases: ['papa'] },
  { id: 'profile-mama', name: 'Mamá', role: 'adult', color: '#b1afb6', avatar: 'M', aliases: ['mama'] },
  { id: 'profile-hijo', name: 'Hijo', role: 'child', color: '#8c8e84', avatar: 'H', aliases: [] },
  { id: 'profile-hija', name: 'Hija', role: 'child', color: '#c4b9c0', avatar: 'H', aliases: [] },
  { id: FAMILY_PROFILE_ID, name: 'Familia', role: 'family', color: '#c2bbb4', avatar: '👪', aliases: ['todos', 'toda la familia'] },
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

/** Actualización v2: agrega el perfil Familia si falta (los perfiles de cada persona no se tocan). */
async function upgradeSeed(repo: Repo) {
  if ((await repo.db.getKV<number>('seedVersion', 1)) >= 2) return;
  await repo.tx(async () => { await createMissing(repo, [FAMILY_PROFILE_ID]); });
  await repo.db.setKV('seedVersion', 2);
}

export { DEFAULT_HOME_BLOCKS };
