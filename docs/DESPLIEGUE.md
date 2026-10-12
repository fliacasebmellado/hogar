# Instalación, desarrollo y publicación

## Requisitos

- Node.js 20 o superior (probado con Node 24) y npm.
- Una cuenta de GitHub (gratuita) para publicar.
- La cuenta de Google de la familia para el backend ([GOOGLE_SETUP.md](GOOGLE_SETUP.md)).

## Ejecutar en la computadora

```bash
npm install
```
```bash
npm run dev
```

Abrí <http://localhost:5173>. En modo desarrollo el service worker está desactivado; para probar la PWA completa:

```bash
npm run build
```
```bash
npm run preview
```

y abrí <http://localhost:4173>.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Regenera `Schema.gs`, verifica tipos y compila la PWA en `dist/` |
| `npm run preview` | Sirve `dist/` en el puerto 4173 |
| `npm test` | Pruebas unitarias, funcionales, del asistente y de sincronización (Vitest) |
| `REAL_OCR=1 npm test` | Incluye la prueba de OCR real (descarga el idioma español) |
| `npx playwright install chromium` y luego `npm run e2e` | Pruebas de interfaz en Chromium (celular y computadora) |
| `npm run gas:schema` | Copia `shared/schema.json` a `apps-script/Schema.gs` |

## Publicar gratis en GitHub Pages

1. Creá un repositorio en GitHub (por ejemplo `hogar`). Puede ser público: **no contiene secretos** (la URL del backend y
   el token se cargan en cada dispositivo). No subas exportaciones de datos ni capturas reales.
2. Subí el código:

```bash
git init
```
```bash
git add .
```
```bash
git commit -m "Hogar: primera versión"
```
```bash
git branch -M main
```
```bash
git remote add origin https://github.com/USUARIO/hogar.git
```
```bash
git push -u origin main
```

3. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. El flujo [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) ejecuta las pruebas, compila y publica en
   `https://USUARIO.github.io/hogar/`. HTTPS es automático (requisito de PWA, cámara y micrófono).
5. Abrí esa dirección en cada dispositivo e instalá la app ([GUIA_FAMILIA.md](GUIA_FAMILIA.md#instalar-la-app)).

Alternativas gratuitas compatibles (mismo `dist/`): Cloudflare Pages o Netlify (plan gratuito). No hacen falta reglas de
reescritura porque la app usa rutas con `#`.

## Actualizar la app

1. Hacé los cambios, ejecutá `npm test` y `npm run build`.
2. `git push` a `main`: GitHub Actions publica la versión nueva.
3. En los dispositivos aparece **"Hay una versión nueva de Hogar → Actualizar"**. Los datos locales no se tocan.
4. Si cambió el esquema de datos (`shared/schema.json`): agregá columnas solo **al final** de cada entidad, ejecutá
   `npm run gas:schema`, actualizá el backend (nueva versión de la implementación) y tocá **Ajustes → Google → Verificar /
   reparar hojas**. Cambiar de orden o renombrar columnas se detecta como incompatible y bloquea la escritura de esa hoja
   (los datos quedan a salvo en los dispositivos hasta corregirlo).

## Estructura de archivos

```
├── apps-script/            Backend gratuito (Google Apps Script)
├── docs/                   Documentación
├── e2e/                    Pruebas de interfaz (Playwright)
├── public/                 Íconos de la PWA
├── scripts/                Generador de Schema.gs e íconos
├── shared/schema.json      Esquema único de entidades y columnas
├── src/
│   ├── ai/                 Asistente: extracción, reglas, procesadores, flujo de revisión
│   ├── app/                Contexto global y navegación
│   ├── db/                 IndexedDB (Dexie) y repositorio
│   ├── domain/             Tipos, fechas, validaciones, permisos, economía
│   ├── integrations/       Google (Calendar, Gmail, Forms, copias)
│   ├── modules/            Pantallas: home, agenda, tasks, shopping, finance, house, family, documents, inbox, settings…
│   ├── services/           Reglas de negocio por módulo
│   ├── sync/               Transporte y motor de sincronización
│   ├── ui/                 Componentes reutilizables
│   ├── main.tsx, App.tsx   Entrada y rutas
│   └── sw.ts               Service worker (offline, compartir, notificaciones)
├── tests/                  Pruebas Vitest + emulador de Apps Script
└── .github/workflows/      Publicación automática
```
