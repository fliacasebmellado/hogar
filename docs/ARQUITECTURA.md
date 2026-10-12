# Arquitectura, modelo de datos y decisiones técnicas

## Visión general

```
 Celulares / computadora (PWA instalada)                         Cuenta la cuenta de Google de la familia
 ┌──────────────────────────────────────────┐   HTTPS (POST)    ┌───────────────────────────────────────┐
 │ React + TypeScript (interfaz por módulos) │  token familiar   │ Google Apps Script (aplicación web)   │
 │ Servicios de negocio (tareas, pagos, …)  │ ───────────────►  │  push/pull idempotente con versiones  │
 │ Asistente local (reglas, OCR, PDF, voz)  │                   │  ├─ Google Sheets  (registros)        │
 │ IndexedDB (Dexie): datos + cola + archivos│ ◄───────────────  │  ├─ Google Drive   (archivos, copias) │
 │ Service worker (offline, compartir)       │                   │  ├─ Google Calendar (eventos marcados)│
 └──────────────────────────────────────────┘                   │  ├─ Gmail (solo lectura, opcional)    │
        Alojamiento: GitHub Pages (estático)                     │  └─ Forms (vía hoja vinculada)        │
                                                                  └───────────────────────────────────────┘
```

Capas en el código (`src/`):

| Carpeta | Responsabilidad |
| --- | --- |
| `domain/` | Tipos, fechas, repeticiones, validaciones, permisos, reglas de economía. Sin dependencias de UI ni de almacenamiento. |
| `db/` | Base local (Dexie/IndexedDB) y `Repo`: única puerta de escritura (valida, versiona, historial, cola). |
| `services/` | Reglas de negocio por módulo (tareas recurrentes, pagos↔gastos, compras, casa, documentos, copias, avisos, búsqueda). |
| `sync/` | Transporte HTTP al backend y motor de sincronización (archivos, pull, push, conflictos). |
| `ai/` | Asistente: extracción en español, clasificación por reglas, procesadores locales opcionales, flujo de revisión. |
| `integrations/` | Acciones de Google (Calendar, Gmail, Forms, copias en Drive) e importaciones con revisión. |
| `ui/`, `app/`, `modules/` | Componentes, contexto global, navegación y pantallas de cada módulo. |
| `apps-script/` | Backend gratuito (Code, Sheets, Sync, Human — ediciones a mano —, Investments, Drive, Backup, Calendar, Gmail, Forms, Schema generado). |
| `shared/schema.json` | **Única definición** de entidades y columnas; se copia a `apps-script/Schema.gs` (`npm run gas:schema`). |

## Decisiones principales

| Decisión | Motivo | Alternativas descartadas |
| --- | --- | --- |
| PWA React + TS + Vite | Una sola base para celular y computadora, instalable sin tienda, gratis | App nativa (tiendas, costo de mantenimiento) |
| IndexedDB como fuente local + cola | Offline real, sin pérdida silenciosa, transacciones | localStorage (limitado, sin transacciones) |
| Apps Script como backend | Gratis, corre como la cuenta familiar, sin claves en el frontend ni proyecto de Cloud | OAuth en el navegador (verificación, tokens de 7 días en modo prueba), Firebase (otra cuenta, posibles costos) |
| Sheets por entidad con columnas tipadas | Legible y exportable por la familia | Una sola columna JSON (ilegible) |
| Versión por registro + `rev` global + `opId` | Concurrencia optimista, sincronización incremental, reintentos sin duplicados | Último que escribe gana (pierde datos) |
| Borrado lógico | Las eliminaciones se sincronizan y se pueden auditar | Borrado físico (no se propaga, irreversible) |
| Asistente por reglas locales | Gratis, privado, funciona sin conexión | APIs de IA pagas o con claves expuestas |
| HashRouter + `base: './'` | Funciona en GitHub Pages en cualquier subcarpeta | Rutas con historial (requieren reescrituras en el servidor) |

## Modelo de datos

Campos comunes a todos los registros: `id` (UUID o determinista), `version` (escrituras en el servidor), `rev` (cursor
global), `createdAt`, `updatedAt`, `deleted` (borrado lógico), `updatedBy` (perfil), `deviceId`, `origin`
(`manual | asistente | google_calendar | gmail | forms | import | sistema | restauracion`), `demo`.

| Entidad | Campos clave | Relaciones |
| --- | --- | --- |
| `household` | nombre, zona horaria, moneda, correo | — |
| `profiles` | nombre, rol (adulto / chico / familia: perfil "Todos" que reúne lo de todos), color, avatar, alias, preferencias (bloques de inicio, vista simple, avisos), `pinHash` | responsables de tareas/eventos/pagos |
| `config` | `key`, `value` (categorías, permisos, avisos) | — |
| `tasks` | título, categoría, responsable, colaboradores, fecha/hora límite, prioridad, estado, `recurrence`, `isSeries`, `seriesId`, `occurrenceDate`, `detached`, `nextRun`, completada (fecha/autor), adjuntos | `relatedType/relatedId` (reparación, mantenimiento…), `assetId`, `roomId`, `maintenanceId` |
| `events` | título, inicio/fin, todo el día, lugar, participantes, responsable, categoría, recordatorios, repetición, confirmación, `syncCalendar`, `googleEventId`, `googleUpdated`, `calendarSyncedAt` | adjuntos, relación genérica |
| `shoppingLists` | nombre, `isTemplate` (habitual), archivada | ítems |
| `shoppingItems` | producto, cantidad, unidad, categoría, prioridad, comprador, `requestedBy` (quién lo pidió), estado, comprado (fecha/autor), `mergedInto` | `listId`, `expenseId`, relación con tarea/gasto/elemento |
| `payments` | concepto, categoría, proveedor, importe, moneda, emisión, vencimiento, fecha de pago, responsable, estado, medio, repetición/serie | `receiptDocId` (documento), `expenseId` (gasto generado) |
| `expenses` | fecha, importe, moneda, categoría, concepto, responsable, extraordinario, medio | `paymentId`, `repairId`, `assetId`, `shoppingItemIds`, `receiptDocId` |
| `rooms` / `providers` | ambiente; proveedor (rubro, teléfono, correo) | elementos, reparaciones |
| `assets` | nombre, categoría, marca, modelo, serie, compra, garantía, datos técnicos, fotos | `roomId`, `providerId`, `manualDocId` |
| `maintenance` | título, categoría, **frecuencia definida por la familia**, fuente de la frecuencia, responsable, activo | `assetId`, `roomId`, `taskSeriesId` |
| `repairs` | título, descripción, estado, fechas, costo | `assetId`, `roomId`, `providerId`, `taskId`, `expenseId`, `invoiceDocId` |
| `documents` | nombre, tipo, categoría, fecha, persona, descripción, etiquetas, visibilidad, texto extraído | `attachmentId`, relación con cualquier entidad |
| `attachments` | nombre, tipo MIME, tamaño, SHA-256, carpeta, `driveFileId`, `driveUrl`, estado de subida | binario local en tabla `files` |
| `notes` | título, cuerpo, personas | relación genérica |
| `captures` | tipo, texto original, adjuntos, texto extraído, procesador, estado, propuestas, decisiones, `sourceRef` | registros creados (en `decisions`) |
| `history` | entidad, registro, acción, fecha, autor, cambios campo a campo | registro afectado |
| `investments` | nombre, tipo, dirección, titulares, estado, compra (fecha/valor/moneda), partidas, carpeta de Drive | contratos, impuestos, mantenimiento, documentos |
| `investmentContracts` | tipo, contraparte, inicio, fin, importe, moneda, periodicidad, actualización, día de cobro, estado | `investmentId`, `documentId` |
| `investmentTaxes` | impuesto, período, vencimiento, importe, moneda, fecha de pago, estado, medio, n.º de cuenta | `investmentId`, `receiptDocId` |
| `investmentWorks` | trabajo, fecha, proveedor, costo, moneda, estado, quién pagó | `investmentId`, `documentId` |

Tablas **solo locales**: `outbox` (operaciones pendientes), `conflicts`, `syncLog`, `files` (binarios), `notifState`
(leído/descartado), `localBackups`, `kv` (dispositivo, perfil actual, URL/token del backend, ajustes del asistente).

### Reglas de integridad

- **Una fuente de verdad por dato.** Los paneles muestran relaciones, no copias: Inicio, avisos y la ficha de cada
  integrante se calculan a partir de las entidades.
- **Pago ↔ gasto.** Un pago es una obligación. Al **confirmarlo** se crea un único gasto con `paymentId` (y el pago guarda
  `expenseId`). Reintentar la confirmación reutiliza el mismo gasto. Los reportes de gasto suman solo `expenses`; los pagos
  pendientes se informan aparte como obligaciones.
- **Reparación ↔ factura ↔ gasto.** La factura es un `document`; la reparación guarda `invoiceDocId` y `expenseId`; el
  gasto guarda `repairId` y `receiptDocId`. Corregir el importe actualiza el mismo gasto.
- **Compras ↔ gasto.** Marcar comprado no crea gastos; solo si se informa el importe se crea un gasto con los
  `shoppingItemIds`.
- **Series recurrentes.** Tareas y pagos usan una maestra (`isSeries`) y ocurrencias con id determinista
  `serie__AAAA-MM-DD`: dos dispositivos generan la misma ocurrencia y no se duplica. Las tareas mantienen una ocurrencia
  abierta (la siguiente se crea al completar); los pagos generan obligaciones hasta 45 días adelante.
- **Eliminación.** Siempre lógica (`deleted = true`). Los archivos en Drive no se borran automáticamente. Al fusionar
  productos, los fusionados quedan con `mergedInto`.
- **Validación** antes de guardar (`domain/validation.ts`): campos obligatorios, fechas reales, importes positivos,
  estados válidos, fin posterior al inicio, frecuencia obligatoria en mantenimiento, tipos de archivo y tamaño (15 MB).

## Planillas y carpetas de la familia

`shared/schema.json` define, además de los campos, **dónde vive cada entidad** (`placement`: planilla y pestaña), las
etiquetas en castellano de cada columna, los campos obligatorios y los nombres de las carpetas. Hay cinco planillas
(app, Gastos de la casa, Inversiones, Casa y mantenimiento, Índice de documentos), cada una dentro de la carpeta de Drive
que le corresponde. Las columnas de personas e inversiones guardan el **nombre** (legible) y el backend lo traduce al ID.

Ediciones a mano (`apps-script/Human.gs`): un activador "Al editar" en cada planilla asigna ID a las filas nuevas,
normaliza fechas (`15/10/2026`), importes argentinos (`45.000,50`) y nombres, completa valores por defecto y publica la
fila con una revisión nueva para que los dispositivos la descarguen. Una fila sin datos obligatorios queda con una nota y
no se publica. "Al cambiar" (filas borradas) cambia `IDS_EPOCH`; los dispositivos comparan IDs y quitan lo borrado, salvo
que desaparezca más del 20 % de una entidad de golpe (protección contra borrados accidentales).

Archivos (`apps-script/Drive.gs`): la app decide la carpeta según el documento (`src/services/folders.ts`) y el backend la
resuelve: `documentos/<persona>`, `peques/<nombre>`, `gastos/<AAAA-MM>`, `casa/<subcarpeta>`, `inversion/<id>/<subcarpeta>`,
`app/<Capturas|Audios>`. Si la clasificación cambia, el archivo se mueve; nunca se borra.

## Sincronización

1. **Escritura local:** `Repo` guarda el registro, su historial y una operación en `outbox` **en la misma transacción**.
   Si algo falla, no queda nada a medias. Una edición posterior se fusiona con la operación pendiente si todavía no se
   intentó enviar.
2. **Ciclo** (al abrir, al volver la conexión, 2,5 s después de un cambio y cada 2 minutos con la app visible):
   subir archivos → `pull` desde la última `rev` → `push` en lotes (máx. 40, una operación por registro por lote) →
   `pull` final.
3. **Servidor:** `LockService` serializa escrituras. Por cada operación: si el `opId` ya está en `_ops` → `duplicate`
   (devuelve el registro actual); si la versión del servidor ≠ `baseVersion` → `conflict` (no escribe); si no, escribe con
   `version + 1` y una `rev` nueva.
4. **Conflictos:** si los cambios locales y remotos tocan campos distintos (se compara contra la copia `base`), se
   fusionan solos. Si tocan el mismo campo, se guarda en `conflicts` y la persona elige: este dispositivo, el otro, o campo
   por campo. Nada se sobrescribe en silencio. La resolución queda en el historial.
5. **Errores:** reintentos con espera exponencial (5 s a 10 min). Ajustes → Sincronización muestra cada operación, su error
   y permite reintentar o descartar.
6. **Restauración del servidor:** cambia `RESTORE_EPOCH`; cada dispositivo lo detecta en el siguiente `pull`, vacía su
   caché sincronizada (conserva sus pendientes) y vuelve a descargar todo.

### Google Calendar

| Situación | Acción |
| --- | --- |
| Evento marcado sin `googleEventId` | Se crea en Google con la etiqueta `hogarId` y los recordatorios |
| Cambió en la app, no en Google | Se actualiza Google |
| Cambió en Google, no en la app | Se actualiza la app y se informa campo por campo (título, lugar, horario) |
| Cambió en ambos | Conflicto: no se toca nada; la persona elige |
| Eliminado en Google | Se informa; la persona elige eliminarlo en la app o recrearlo |
| Eliminado en la app | Se elimina en Google y se informa |
| Evento de Google sin etiqueta | Se lista como externo; importarlo genera una captura para revisar |

## Asistente (captura → interpretación → revisión → confirmación → guardado → sincronización)

- La **captura** se guarda primero, con sus archivos originales (tabla `files` + `attachments`). Se puede cancelar.
- **Interpretación local** (`ai/es.ts`, `ai/rules.ts`): divide el texto en fragmentos, detecta tipo e intención
  (orden, recordatorio, idea, consulta), fechas ("mañana", "el martes", "15/10", "la semana que viene"), horas y rangos,
  importes en formato argentino ($, USD, "15 lucas"), integrantes y alias, repeticiones ("todos los lunes", "cada 3 meses"),
  listas (incluidas capturas con un producto por renglón) y facturas (vencimiento + total).
- **Revisión** (`modules/inbox`): cada propuesta muestra el texto original, el tipo y módulo, los campos editables, las
  preguntas por ambigüedades (fecha u hora ambigua, varios importes, "alguien", tipo dudoso, categoría de documento),
  los datos faltantes, posibles duplicados (crear, actualizar o vincular) y relaciones (p. ej. "pagué la luz" ↔ pago
  pendiente). No se puede confirmar con preguntas abiertas.
- **Confirmación:** se guardan todas las propuestas elegidas en una sola transacción y se registra la decisión de cada una.
- "Coincidencia alta/media/baja" es un indicador heurístico de reglas, **no** una probabilidad.

## Seguridad y privacidad

- **Perfiles ≠ identidad.** El selector de perfil organiza la interfaz y los permisos visibles; el PIN (hash SHA-256 con
  sal) solo disuade. La seguridad real es el token del backend y los permisos de la cuenta de Google.
- **Sin secretos en el repositorio.** La URL `/exec` y el token se cargan en cada dispositivo y se guardan en su IndexedDB.
- El backend valida el token (comparación de tiempo constante), solo acepta entidades y columnas del esquema, rechaza
  archivos dañados (hash), solo entrega archivos registrados por la app y no devuelve trazas.
- Textos que empiezan con `= + @ '` se guardan como texto (sin fórmulas) en Sheets; el CSV escapa fórmulas.
- El registro de sincronización y el historial no guardan contenido de capturas ni documentos.
- Para pasar a **usuarios autenticados** en el futuro: cada perfil puede asociarse a una cuenta de Google; el backend
  cambiaría a "ejecutar como el usuario que accede" o validaría un ID token de Google Identity Services en `doPost`, y
  `updatedBy` pasaría a ser la identidad verificada. El modelo de datos ya registra autor y dispositivo en cada cambio.

## Limitaciones conocidas

Ver [LIMITACIONES_Y_COSTOS.md](LIMITACIONES_Y_COSTOS.md).
