// Foto sacada desde el botón "Foto" de Inicio: la cámara se abre ahí mismo (necesita el toque del usuario) y la imagen
// pasa en memoria a la pantalla del Asistente, que la retira una sola vez.
let pending: File[] = [];

export function setPendingPhotos(files: File[]) { pending = files; }
export function takePendingPhotos(): File[] { const f = pending; pending = []; return f; }
