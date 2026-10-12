# Copias de seguridad y recuperación

La sincronización **no** es una copia de seguridad: si algo se borra o se daña, el cambio llega a todos los dispositivos.
Por eso hay tres niveles independientes:

| Nivel | Dónde | Cuándo | Qué incluye |
| --- | --- | --- | --- |
| Copia automática en Drive | `Hogar App/Backups` | Todos los días a las 3 a. m. (activador del backend) y a pedido | Todos los registros de la planilla (no los archivos: esos ya están en Drive) |
| Copia automática local | IndexedDB del dispositivo | Una por día al abrir la app y antes de cada restauración (se guardan 7) | Todos los registros del dispositivo |
| Exportación manual | Archivo `.json` que descargás | Cuando quieras (recomendado: mensual) | Registros, relaciones, historial y opcionalmente los archivos |

## Formato

JSON abierto: `{ format: "hogar-backup", schemaVersion, createdAt, deviceId, counts, checksum, data: { entidad: [...] }, files? }`.
`checksum` es el SHA-256 de `data`. Las copias del servidor y de la app usan el mismo formato y se pueden restaurar en
cualquiera de los dos lados.

## Garantías

- Cada copia de Drive se **relee y verifica** (cantidades por entidad + suma de verificación) antes de marcarse válida en la
  hoja `_backups`.
- Las copias antiguas solo se eliminan (enviándolas a la papelera de Drive) después de crear una copia nueva **válida**; se
  conservan las 30 últimas válidas. Una copia incompleta nunca reemplaza a una válida.
- Antes de cualquier restauración se crea automáticamente una copia del estado actual (en el servidor:
  "pre-restauracion"; en el dispositivo: "Antes de restaurar"), así que toda restauración se puede deshacer.
- Una copia con cantidades que no coinciden, colecciones faltantes o suma de verificación distinta se rechaza sin
  restaurar nada.

## Restaurar

**En un dispositivo (desde un archivo o una copia local):** Ajustes → Copias de seguridad → Restaurar desde un archivo →
elegir el `.json` → debe aparecer "La copia es válida" → Restaurar. Los registros de la copia reemplazan a los que tengan
el mismo identificador; los demás se conservan. Si Google está conectado, los datos restaurados se envían al servidor.

**En Google (toda la familia):** Ajustes → Copias de seguridad → Copias en Google Drive → **Restaurar en Google**. Reemplaza
el contenido de la planilla por esa copia (previa copia del estado actual). Todos los dispositivos detectan la restauración
y vuelven a descargar los datos en su próxima sincronización; los cambios que no habían enviado se conservan y se envían
después.

**Desde cero (dispositivo nuevo o perdido):** instalar la app → elegir perfil → Ajustes → Google → conectar: se descarga
todo desde la planilla. Si no hubiera backend, restaurar el último `.json` exportado.

**Si la planilla se dañó o se borró:** restaurar la copia de Drive desde la app, o desde Drive descargar el último
`hogar-backup-*.json` y restaurarlo en un dispositivo (luego se reenvía a la planilla nueva tras ejecutar `inicializar`).

## Cómo comprobar que la restauración funciona

1. Exportá una copia y cargala en "Restaurar desde un archivo": debe decir "La copia es válida".
2. Prueba completa: en otro navegador (o una ventana de invitado), abrí la app, restaurá la copia y verificá tareas, eventos,
   pagos y documentos.
3. Las pruebas automáticas incluyen exportar → alterar → detectar, restaurar en un dispositivo nuevo con archivos, y
   copia → cambios → restauración en el servidor → resincronización ([PRUEBAS.md](PRUEBAS.md)).

## Límites

- La copia de Drive no duplica los archivos (ya están en Drive con su hash); la exportación manual puede incluirlos.
- Los archivos borrados manualmente de Drive no se recuperan con estas copias (Drive los conserva 30 días en la papelera).
- Las copias locales viven en el navegador: si se borran los datos del sitio, se pierden. Por eso la exportación manual.
