# Configurar Google (Sheets, Drive, Calendar, Gmail y Forms)

Hogar guarda los datos compartidos en la cuenta **la cuenta de Google de la familia** mediante un *backend* gratuito de
**Google Apps Script**. El script se ejecuta con los permisos de esa cuenta, así que **no hace falta crear un proyecto en
Google Cloud ni credenciales OAuth** y nunca se pide la contraseña de Gmail.

> Mientras no completes estos pasos, la app funciona igual pero los datos quedan solo en el dispositivo donde se cargan.

## Cómo queda el Drive de la familia

El script **adopta las carpetas que ya existen** en Mi unidad de la cuenta de Google de la familia (las busca por nombre) y solo
agrega lo que falta. **No renombra, no mueve y no borra** carpetas ni archivos existentes.

```
Mi unidad/
├── Documentos/                         ← ya existía
│   ├── Índice de documentos            (planilla: todos los documentos cargados, con enlace al archivo)
│   ├── Papá/  Mamá/  Familia/         (DNI, pasaporte, obra social, partidas… se crean al subir el primero)
├── Peques/                             ← ya existía
│   └── Hijo/  Hija/                 (documentos de los chicos: colegio, salud, actividades)
├── Gastos Mensuales casa/              ← ya existía
│   ├── Gastos de la casa               (planilla: pestañas Pagos y Gastos)
│   └── Comprobantes/<AAAA-MM>/         (facturas y comprobantes, por mes)
├── Inversiones/                        ← ya existía
│   ├── Inversiones                     (planilla: Inversiones, Contratos, Impuestos, Mantenimiento + "Resumen - <inversión>")
│   └── <cada inversión>/               ← cada subcarpeta existente se vuelve una inversión en la app
│       └── Contratos/  Impuestos/  Mantenimiento/  Otros/
├── Reforma, mantenimiento casa/        ← ya existía
│   ├── Casa y mantenimiento            (planilla: Ambientes, Proveedores, Elementos, Mantenimiento, Reparaciones)
│   └── Reparaciones/  Manuales y garantías/  Fotos/  Facturas/
└── Hogar App/                          (nueva: lo técnico de la app)
    ├── Hogar — datos de la app         (Tareas, Agenda, Compras, Perfiles, Notas, Historial…)
    ├── Capturas/  Audios/              (lo que se captura con el asistente antes de clasificarlo)
    └── Backups/                        (copia diaria verificada de TODAS las planillas; se guardan 30)
```

Si alguna carpeta tiene otro nombre, se puede indicar en **Configuración del proyecto → Propiedades del script**:
`FOLDER_NAME_documentos`, `FOLDER_NAME_gastos`, `FOLDER_NAME_inversiones`, `FOLDER_NAME_peques`, `FOLDER_NAME_casa`.

### Editar las planillas a mano

Todo lo que se carga en la app aparece en estas planillas, y **lo que se carga o cambia en las planillas aparece en la app**
(en la próxima sincronización, a lo sumo en un par de minutos con la app abierta):

- Los encabezados están en castellano. Las primeras 10 columnas (ID, versión, fechas técnicas…) están **ocultas**: no
  hace falta tocarlas.
- Para agregar algo, escribí en una fila vacía. Las fechas pueden ir como `15/10/2026`, los importes como `45.000` o
  `45.000,50`, y las personas y las inversiones **por nombre** (por ejemplo "Mamá", "Depto Palermo").
- Si a una fila le falta un dato obligatorio (por ejemplo, el importe de un gasto), queda con una nota "Falta completar" y
  la app no la ve hasta que se complete.
- Para borrar, poné **Eliminado = Sí** (recomendado) o borrá la fila. Si de golpe desaparecen muchas filas (por ejemplo,
  se vació una pestaña por error), la app no las borra y avisa para restaurar una copia.
- Las pestañas "Resumen - …" de Inversiones son automáticas (fórmulas): los datos se cargan en Contratos, Impuestos y
  Mantenimiento.
- Si la misma fila se cambia a la vez en la planilla y en la app, la app muestra un conflicto para elegir qué conservar.

## Camino recomendado: todo desde la computadora (sin copiar y pegar)

Una sola vez:

1. En <https://script.google.com/home/usersettings> (con la cuenta de Google de la familia) activá **"API de Google Apps Script"**.
2. Iniciá sesión (se abre el navegador; elegí la cuenta de Google de la familia):

```bash
npm run gas:login
```

3. Creá el proyecto y subí el código:

```bash
npm run gas:create
```

4. Autorizá los permisos una única vez: `npx clasp open` → función **inicializar** → **Ejecutar** → aceptar (ver Paso 2).
   Copiá el token del registro de ejecución.
5. Publicá la aplicación web (muestra la URL `/exec` para pegar en la app):

```bash
npm run gas:deploy
```

**Cada vez que cambie algo en `apps-script/`:** solo `npm run gas:deploy`. Sube el código y actualiza la misma
implementación, así que la URL no cambia y los celulares no hay que reconfigurarlos. Los cambios de la app (pantallas,
diseño) no pasan por acá: se publican con GitHub Pages.

> Si se agregan permisos nuevos (por ejemplo, otra integración de Google), hay que volver a ejecutar `inicializar` una
> vez desde el editor para aceptarlos. Para cambios de código normales no hace falta.

El camino manual (copiar los archivos en el editor) sigue funcionando y se describe a continuación.

## Paso 1 — Crear el proyecto de Apps Script (camino manual)

1. Iniciá sesión en el navegador con **la cuenta de Google de la familia** y abrí <https://script.google.com>.
2. **Nuevo proyecto** → cambiá el nombre a `Hogar backend`.
3. ⚙️ **Configuración del proyecto** → activá **"Mostrar el archivo de manifiesto appsscript.json en el editor"**.
4. En el editor, reemplazá el contenido de `appsscript.json` por el de [`apps-script/appsscript.json`](../apps-script/appsscript.json).
5. Creá un archivo de secuencia de comandos por cada `.gs` de la carpeta [`apps-script/`](../apps-script) con el mismo
   nombre y pegá su contenido: `Code`, `Schema`, `Sheets`, `Sync`, `Human`, `Investments`, `Drive`, `Backup`, `Calendar`, `Gmail`, `Forms`.
   (Podés borrar el `Código.gs` vacío que trae el proyecto.)

**Alternativa por línea de comandos (opcional):** habilitá la API en <https://script.google.com/home/usersettings>, luego:

```bash
npm install -g @google/clasp
```
```bash
clasp login
```
```bash
clasp create --type standalone --title "Hogar backend" --rootDir apps-script
```
```bash
clasp push
```

`.clasp.json` está en `.gitignore`: no lo subas al repositorio.

## Paso 2 — Inicializar y autorizar

1. En el editor elegí la función **`inicializar`** y tocá **Ejecutar**.
2. Google pide permisos. Como es un script propio y no verificado, aparece "Google no verificó esta app":
   **Configuración avanzada → Ir a Hogar backend (no seguro)**. Es seguro porque el código es el de esta carpeta y corre en
   tu cuenta.
3. Permisos que se solicitan y para qué:

| Permiso | Uso |
| --- | --- |
| `spreadsheets` | Leer/escribir la planilla "Hogar — datos" |
| `drive` | Crear la carpeta, guardar archivos y copias, leer los archivos registrados por la app |
| `calendar` | Crear/actualizar los eventos marcados para Google Calendar y listar eventos externos |
| `gmail.readonly` | **Opcional.** Buscar correos puntuales cuando se habilita en la app. Nunca envía ni modifica |
| `script.scriptapp` | Crear los activadores: copia diaria, revisión horaria de carpetas de Inversiones y calendario, y "al editar" de cada planilla |

4. `inicializar` adopta las carpetas, crea las planillas y pestañas, las subcarpetas de cada inversión, los activadores (incluidos los que detectan ediciones a mano en las planillas) y **el token familiar**.
   Abrí **Registro de ejecución** y copiá el token que aparece en la línea `Token familiar (...)`.
   Si lo perdés, ejecutá **`generarToken`** (genera uno nuevo e invalida el anterior en todos los dispositivos).

## Paso 3 — Implementar como aplicación web

1. **Implementar → Nueva implementación** → tipo **Aplicación web**.
2. *Ejecutar como*: **Yo (la cuenta de Google de la familia)**. *Quién tiene acceso*: **Cualquier persona**.
3. **Implementar** y copiá la URL que termina en **`/exec`**.

> "Cualquier persona" significa que la URL responde a solicitudes, pero **cada solicitud debe incluir el token familiar**;
> sin él no se devuelve ningún dato. Por GET no se expone nada. Tratá la URL y el token como una contraseña.

## Paso 4 — Conectar la app

1. En la app: **Ajustes → Google** → pegá la URL `/exec` y el token → **Conectar e inicializar**.
2. La app prueba la conexión, verifica las hojas y empieza a sincronizar.
3. En los demás celulares: en el primero tocá **"Código para otro dispositivo"** (lo copia al portapapeles), mandalo por un
   medio privado y pegalo en el otro dispositivo en **Ajustes → Google → Tengo un código**. También podés pegar URL y token.

## Actualizar el backend

Cuando cambie el código de `apps-script/`: pegá los archivos nuevos (o `clasp push`) y luego
**Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión → Implementar**. Así se mantiene la misma URL.
Si cambió `shared/schema.json`, ejecutá antes `npm run gas:schema` para regenerar `Schema.gs`, y después en la app
**Ajustes → Google → Verificar / reparar hojas** (agrega columnas nuevas al final; nunca reordena ni borra).

## Google Calendar

- Se sincronizan solo los eventos con **"Sincronizar con Google Calendar"** activado. Por defecto se usa el calendario
  principal de la cuenta. Para otro calendario: Configuración del proyecto → Propiedades del script → `CALENDAR_ID`.
- Sincronización manual desde **Ajustes → Google → Sincronizar calendario ahora**, o automática cada hora (opción en la app).
- Reglas: ver [ARQUITECTURA.md](ARQUITECTURA.md#google-calendar). Nunca se reemplaza un evento cambiado en ambos lados sin
  preguntar, y los eventos que no creó la app se proponen para importar con revisión.

## Gmail (opcional, solo lectura)

- Está **desactivado** hasta que lo actives en **Ajustes → Google → Habilitar búsqueda en Gmail**.
- Solo busca con la consulta que escribís (máximo 20 resultados) e importa los mensajes que elegís, que pasan por la
  revisión del asistente. No lee todo el correo, no envía, no borra, no marca.
- Para quitar el permiso por completo: borrá `Gmail.gs` y la línea `gmail.readonly` de `appsscript.json`, guardá, ejecutá
  `inicializar` para reautorizar y creá una nueva versión de la implementación.

## Google Forms

No se usa la API de Forms. En el formulario (creado con la misma cuenta): **Respuestas → Vincular a Hojas de cálculo →
Seleccionar una hoja existente → "Hogar — datos"**. Google crea una hoja "Respuestas de formulario N". Desde
**Asistente → Respuestas de formularios** la app trae las respuestas nuevas como capturas para revisar. Cada respuesta se
marca como importada (hoja `_forms_imported`) recién cuando se guardó en la app, así que no se duplica.

## Revocar el acceso

- Invalidar todos los dispositivos: ejecutá `generarToken` (y cargá el nuevo token en los dispositivos que sigan).
- Quitar los permisos del script: <https://myaccount.google.com/permissions> → "Hogar backend" → Quitar acceso.
- Dar de baja el backend: Implementar → Administrar implementaciones → Archivar.

## Cuotas gratuitas (aproximadas, pueden cambiar)

Consultá siempre <https://developers.google.com/apps-script/guides/services/quotas>. Para una cuenta gmail.com gratuita:

| Recurso | Límite aproximado | Uso típico de Hogar |
| --- | --- | --- |
| Tiempo por ejecución | 6 min | Un lote de sincronización tarda segundos |
| Tiempo total de activadores | 90 min/día | Copia diaria + calendario horario: pocos minutos |
| Eventos de Calendar creados | 5.000/día | Decenas |
| Lecturas de Gmail | 20.000/día | Solo búsquedas manuales |
| Ejecuciones simultáneas | 30 | 4 dispositivos |
| Almacenamiento | 15 GB compartidos (Gmail + Drive + Fotos) | Depende de los archivos que se suban |

Si una cuota se agota, la app guarda todo localmente, muestra el error en **Ajustes → Sincronización** y reintenta después.

## Por qué Apps Script y no OAuth desde el navegador

Llamar a las APIs de Google directamente desde la PWA exigiría un proyecto de Google Cloud, una pantalla de consentimiento
y, para permisos sensibles (Drive completo, Gmail), verificación de Google o el modo "prueba", cuyos tokens de actualización
vencen cada 7 días. El backend de Apps Script evita todo eso sin costo y sin claves en el frontend.
