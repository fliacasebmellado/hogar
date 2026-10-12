# Diagnóstico de problemas

Primero mirá **Ajustes → Estado del sistema** y **Ajustes → Sincronización → Registro**.

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| "La respuesta no es válida… URL /exec" al conectar | URL de `/dev` o de la página del editor, o acceso no es "Cualquier persona" | Copiar la URL de **Implementar → Administrar implementaciones** (termina en `/exec`) y revisar el acceso |
| "Token familiar inválido" | Token mal copiado o rotado | Copiar el token del registro de `inicializar`/`generarToken` |
| "Encabezados incompatibles" | Se editaron a mano los encabezados de una hoja | Restaurar los encabezados (ver `shared/schema.json`) o renombrar la hoja dañada y tocar "Verificar / reparar hojas" |
| Operaciones en error que no se van | Registro inválido o cuota agotada | Ver el detalle en Sincronización; "Reintentar errores"; si es un dato inválido, corregirlo o "Descartar" (el dato sigue en el dispositivo) |
| Conflictos | El mismo campo se editó en dos dispositivos | Elegir versión en Sincronización → Conflictos |
| "El servidor está ocupado" | Dos dispositivos sincronizando a la vez | Se reintenta solo |
| No aparecen datos de otro celular | Ese celular no sincronizó o no está conectado | Verificar su indicador; "Sincronizar ahora" en ambos |
| La app quedó en blanco tras una actualización | Versión vieja en caché | Recargar; si persiste, cerrar y abrir la app (el service worker se actualiza) |
| "Cargando…" que no termina | Red lenta durante la primera instalación | Esperar o tocar "Está tardando: recargar" |
| La foto no se leyó | OCR desactivado, sin conexión la primera vez, o imagen poco legible | Activar OCR en Ajustes → Asistente; escribir los datos a mano |
| El micrófono no graba | Permiso denegado o sitio sin HTTPS | Permitir el micrófono en el navegador; usar la dirección publicada (HTTPS) |
| No llegan notificaciones | Permiso no otorgado, horario de silencio, o app cerrada | Ver Ajustes → Notificaciones; usar Google Calendar para avisos críticos |
| Google Calendar no refleja un evento | El evento no tiene "Sincronizar con Google Calendar" o no se corrió la sincronización de calendario | Activar la opción y tocar "Sincronizar calendario ahora" |
| Gmail dice "desactivada" | Integración apagada | Ajustes → Google → Habilitar búsqueda en Gmail |

## Registros del backend

En <https://script.google.com> → proyecto → **Ejecuciones** se ven las llamadas y errores. La hoja `_log` de la planilla
guarda los últimos errores (sin contenido de los registros).

## Volver a empezar en un dispositivo

Ajustes → Privacidad y datos → Borrar datos locales (exportá una copia antes si tiene cambios sin sincronizar). Luego
conectá Google de nuevo para descargar todo.
