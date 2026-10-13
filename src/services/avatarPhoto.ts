// Foto de perfil: se recorta un cuadrado centrado en la parte alta (donde suele estar la cara), se achica a 192 px y
// se guarda como JPEG en el campo "avatar" del perfil. Pesa ~10–20 KB, entra en una celda de Google Sheets (máx. 50.000
// caracteres) y viaja a todos los dispositivos con la sincronización normal. Nunca se incluye en el código publicado.
export const AVATAR_SIZE = 192;
const MAX_CHARS = 45_000;

export const isPhotoAvatar = (avatar?: string) => !!avatar && avatar.startsWith('data:image/');

/**
 * Zona a recortar. Foto individual: cuadrado del 65 % del lado menor, centrado y apenas debajo del borde superior (la
 * cara). Foto grupal (perfil Familia): el cuadrado más grande posible, para que entren todos.
 */
export function avatarCrop(w: number, h: number, group = false) {
  const side = Math.round(Math.min(w, h) * (group ? 1 : 0.65));
  const sx = Math.round((w - side) / 2);
  const sy = Math.round(group ? (h - side) * 0.35 : Math.min(h - side, h * 0.12));
  return { sx, sy, side };
}

export async function photoToAvatar(file: Blob, group = false): Promise<string> {
  const bmp = await createImageBitmap(file);
  const { sx, sy, side } = avatarCrop(bmp.width, bmp.height, group);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bmp.close?.();
  for (const q of [0.82, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length <= MAX_CHARS) return url;
  }
  throw new Error('La foto es demasiado pesada. Probá con otra imagen.');
}
