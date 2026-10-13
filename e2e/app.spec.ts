// Pruebas de interfaz en Chromium real: celular (Pixel 7) y computadora.
import { test, expect, type Page } from '@playwright/test';

async function enter(page: Page, name: string) {
  page.on('console', (m) => { if (m.type() === 'error' || process.env.E2E_LOG) console.log(`[consola ${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => console.log(`[error de página] ${e.message}`));
  await page.goto('./');
  await page.getByRole('button', { name: new RegExp(`^${name}(?=\\s|$)`) }).click();
  await expect(page.locator('main#contenido')).toBeVisible();
}
async function noHorizontalScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
}
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

test('navegación adaptada al dispositivo y sin desbordes', async ({ page }) => {
  await enter(page, 'Mamá');
  if (isMobile(page)) {
    await expect(page.locator('nav.bottomnav')).toBeVisible();
    await expect(page.locator('nav.sidebar')).toBeHidden();
    await expect(page.locator('nav.bottomnav a, nav.bottomnav button')).toHaveCount(5); // compacta, con Capturar al centro
    await page.getByRole('button', { name: /Menú/ }).click();
    await expect(page.getByRole('dialog', { name: 'Todas las secciones' })).toBeVisible();
    await page.getByRole('dialog').getByRole('link', { name: /^Economía/ }).click();
  } else {
    await expect(page.locator('nav.sidebar')).toBeVisible();
    await expect(page.locator('nav.bottomnav')).toBeHidden();
    await page.locator('nav.sidebar').getByRole('link', { name: /Economía/ }).click();
  }
  await expect(page.getByRole('heading', { name: 'Economía', exact: true })).toBeVisible();
  for (const route of ['', 'agenda', 'tareas', 'compras', 'economia', 'casa', 'familia', 'documentos', 'asistente', 'ajustes', 'buscar', 'notificaciones']) {
    await page.goto(`./#/${route}`);
    await expect(page.locator('main#contenido')).not.toBeEmpty();
    await noHorizontalScroll(page);
  }
  await expect(page.getByRole('link', { name: /Capturar/ }).first()).toBeVisible(); // captura siempre accesible
});

test('crear una tarea desde el formulario y conservarla al recargar', async ({ page }) => {
  await enter(page, 'Mamá');
  await page.goto('./#/tareas');
  await expect(page.getByText('Todavía no hay tareas.')).toBeVisible(); // estado vacío
  await page.getByRole('button', { name: 'Nueva' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva tarea' });
  await dialog.getByRole('button', { name: 'Crear' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Falta el título'); // validación visible
  await dialog.getByLabel('Título').fill('Barrer el patio');
  await dialog.getByLabel('Categoría').selectOption('patio');
  await dialog.getByRole('button', { name: 'Crear' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tarea creada' })).toBeVisible(); // confirmación
  await expect(page.getByText('Barrer el patio')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Barrer el patio')).toBeVisible();
  await page.getByRole('button', { name: 'Completar Barrer el patio' }).click();
  await expect(page.getByText('Barrer el patio')).toBeHidden(); // pasa a completadas (filtro: abiertas)
});

test('asistente: interpretar, aclarar, confirmar y ver los registros en cada módulo', async ({ page }) => {
  await enter(page, 'Mamá');
  await page.goto('./#/asistente');
  await page.getByLabel(/Escribí, pegá un mensaje/).fill('Mañana a las 18 reunión de padres. Hay que comprar leche y pan. El 20 vence la luz $45.000. Turno pediatra Hija el 15/10 a las 5');
  await page.getByRole('button', { name: 'Interpretar' }).click();
  const review = page.getByRole('dialog', { name: 'Revisar antes de guardar' });
  await expect(review).toBeVisible();
  await expect(review.locator('article.proposal')).toHaveCount(4);
  const confirm = review.getByRole('button', { name: /Confirmar y guardar/ });
  await expect(confirm).toHaveAttribute('aria-disabled', 'true'); // la ambigüedad bloquea la confirmación
  await confirm.click({ force: true }); // sigue siendo enfocable: al tocarlo explica qué falta
  await expect(review.getByText(/No se puede confirmar todavía/)).toBeVisible();
  await review.getByRole('button', { name: '17:00 (tarde/noche)' }).click();
  await expect(confirm).toHaveAttribute('aria-disabled', 'false');
  await confirm.click();
  await expect(review).toBeHidden();
  await expect(page.getByText(/Guardado: .*Leche/)).toBeVisible();
  await expect(page.getByText(/solo en este dispositivo/)).toBeVisible(); // estado de sincronización honesto
  await page.goto('./#/compras');
  await expect(page.getByText('Leche', { exact: true })).toBeVisible();
  await page.goto('./#/economia');
  await expect(page.getByText('Luz', { exact: true })).toBeVisible();
  await page.goto('./#/agenda');
  await page.getByRole('tab', { name: 'Mes' }).click();
  await page.getByRole('gridcell', { name: /15 de octubre/ }).click();
  await expect(page.locator('.ev-title', { hasText: 'Turno pediatra Hija' })).toBeVisible();
});

test('asistente: cancelar no guarda nada', async ({ page }) => {
  await enter(page, 'Mamá');
  await page.goto('./#/asistente');
  await page.getByLabel(/Escribí, pegá un mensaje/).fill('Hay que comprar yerba');
  await page.getByRole('button', { name: 'Interpretar' }).click();
  const review = page.getByRole('dialog', { name: 'Revisar antes de guardar' });
  await review.getByRole('button', { name: 'Cancelar captura' }).click();
  await page.goto('./#/compras');
  await expect(page.getByText('No hay productos pendientes en esta lista.')).toBeVisible();
  await page.goto('./#/asistente');
  await page.getByRole('tab', { name: 'Historial' }).click();
  await page.getByRole('tab', { name: 'Canceladas' }).click();
  await expect(page.getByText('Hay que comprar yerba')).toBeVisible();
});

test('perfil infantil: vista simple y sin economía, documentos privados ni administración', async ({ page }) => {
  await enter(page, 'Hijo');
  await expect(page.getByRole('heading', { name: '¡Hola, Hijo!' }).or(page.getByText('¡Hola, Hijo!'))).toBeVisible();
  await expect(page.getByRole('link', { name: /^Economía/ })).toHaveCount(0); // ni en Inicio ni en el menú
  await expect(page.getByRole('group', { name: 'Cambiar de perfil' })).toHaveCount(0); // sin selector rápido
  await page.goto('./#/economia');
  await expect(page.getByText(/no está disponible para el perfil Hijo/)).toBeVisible();
  await page.goto('./#/ajustes/copias');
  await expect(page.getByText('Esta sección es solo para adultos.')).toBeVisible();
  // cambio de perfil a un adulto
  await page.getByRole('button', { name: /Cambiar de perfil/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Papá/ }).click();
  await page.goto('./#/economia');
  await expect(page.getByRole('tab', { name: 'Resumen' })).toBeVisible();
});

test('documentos: privados ocultos para chicos', async ({ page }) => {
  await enter(page, 'Mamá');
  await page.goto('./#/documentos');
  await page.getByRole('button', { name: 'Cargar' }).click();
  const dlg = page.getByRole('dialog', { name: 'Cargar documento' });
  await dlg.locator('input[type=file]').first().setInputFiles({ name: 'factura-luz.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 factura') });
  await dlg.getByLabel('Categoría').selectOption('facturas');
  await expect(dlg.getByLabel('Quién puede verlo')).toHaveValue('adultos');
  await dlg.getByRole('button', { name: 'Guardar documento' }).click();
  await expect(page.getByText('factura-luz')).toBeVisible();
  await page.getByRole('button', { name: /Cambiar de perfil/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Hija/ }).click();
  await page.goto('./#/documentos');
  await expect(page.getByText('factura-luz')).toBeHidden();
  await expect(page.getByText(/privado\(s\) no se muestran/)).toBeVisible();
});

test('navegación por teclado y foco en hojas modales', async ({ page }) => {
  test.skip(isMobile(page), 'teclado físico: se prueba en computadora');
  await enter(page, 'Mamá');
  await page.goto('./#/tareas');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();
  await page.keyboard.press('Enter');
  const profileBtn = page.getByRole('button', { name: /Cambiar de perfil/ });
  await profileBtn.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Cambiar de perfil' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Cambiar de perfil' })).toBeHidden();
  await expect(profileBtn).toBeFocused(); // el foco vuelve al origen
  // los botones solo-icono tienen nombre accesible
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, a[href]')].filter((b) => !(b as HTMLElement).innerText.trim() && !b.getAttribute('aria-label') && b.getClientRects().length).length);
  expect(unnamed).toBe(0);
});

test('PWA: manifiesto, service worker y funcionamiento sin conexión', async ({ page, context }) => {
  await page.goto('./');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  const manifest = await (await page.request.get(new URL(href!, page.url()).toString())).json();
  expect(manifest).toMatchObject({ short_name: 'Hogar', display: 'standalone', start_url: './' });
  expect(manifest.icons.map((i: any) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((i: any) => i.purpose === 'maskable')).toBe(true);
  expect(manifest.share_target.params.files[0].accept).toContain('audio/*');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByRole('button', { name: /Mamá/ }).click();
  await page.goto('./#/tareas'); // precarga el fragmento de tareas

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(/Sin conexión: los cambios se guardan en este dispositivo/)).toBeVisible();
  await page.getByRole('button', { name: 'Nueva' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva tarea' });
  await dialog.getByLabel('Título').fill('Tarea creada sin conexión');
  await dialog.getByLabel('Categoría').selectOption('orden');
  await dialog.getByRole('button', { name: 'Crear' }).click();
  await expect(page.getByText('Tarea creada sin conexión')).toBeVisible();
  for (const route of ['agenda', 'compras', 'documentos', 'asistente']) {
    await page.goto(`./#/${route}`);
    await expect(page.locator('main#contenido')).not.toBeEmpty();
    await expect(page.getByText('Algo falló')).toBeHidden();
  }
  await context.setOffline(false);
  await page.reload();
  await page.goto('./#/tareas');
  await expect(page.getByText('Tarea creada sin conexión')).toBeVisible();
});

test('copias: exportar y validar un archivo de copia desde la interfaz', async ({ page }) => {
  await enter(page, 'Mamá');
  await page.goto('./#/ajustes/demo');
  await page.getByRole('button', { name: 'Cargar datos de demostración' }).click();
  await expect(page.getByRole('button', { name: /Eliminar datos de demostración \(\d+\)/ })).toBeEnabled();
  await page.goto('./#/ajustes/copias');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar copia' }).click()]);
  const filePath = await download.path();
  await page.locator('input[type=file][accept*="json"]').setInputFiles(filePath!);
  await expect(page.getByText('La copia es válida (cantidades y suma de verificación correctas).')).toBeVisible();
  await page.getByRole('button', { name: 'Restaurar estos datos' }).click();
  await page.getByRole('dialog', { name: 'Restaurar datos' }).getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByText(/Restaurados \d+ registros/)).toBeVisible();
  await page.goto('./#/ajustes/demo');
  await page.getByRole('button', { name: /Eliminar datos de demostración/ }).click();
  await expect(page.getByRole('button', { name: 'Eliminar datos de demostración (0)' })).toBeDisabled();
});

test('chicos: piden algo para el colegio y queda en la lista con su nombre', async ({ page }) => {
  await enter(page, 'Hija');
  await page.getByRole('button', { name: /¿Necesitás algo\?/ }).click();
  const dlg = page.getByRole('dialog', { name: '¿Qué necesitás?' });
  await dlg.getByLabel('Qué hay que comprar').fill('Cartulina verde');
  await dlg.getByRole('button', { name: '✏️ Para el colegio' }).click();
  await dlg.getByLabel(/Para cuándo/).fill('el jueves');
  await dlg.getByRole('button', { name: 'Agregar a la lista' }).click();
  await page.goto('./#/compras');
  await expect(page.getByText('Cartulina verde')).toBeVisible();
  await expect(page.getByText('Pidió Hija')).toBeVisible();
});

test('perfil Familia: muestra lo de todos junto, sin economía', async ({ page }) => {
  await enter(page, 'Mamá');
  await page.goto('./#/ajustes/demo');
  await page.getByRole('button', { name: 'Cargar datos de demostración' }).click();
  await expect(page.getByRole('button', { name: /Eliminar datos de demostración \(\d+\)/ })).toBeEnabled();
  await page.goto('./#/');
  await page.getByRole('button', { name: 'Ver como Familia' }).click();
  await expect(page.getByText('¡Hola, familia!')).toBeVisible();
  await expect(page.locator('.ev-title', { hasText: '[Demo] Turno dentista' })).toBeVisible(); // de Papá
  await expect(page.locator('.ev-title', { hasText: '[Demo] Clase de inglés' })).toBeVisible(); // de Hijo
  await expect(page.getByRole('link', { name: /^Economía/ })).toHaveCount(0);
  await page.goto('./#/agenda');
  await expect(page.getByRole('button', { name: /Todos/ }).first()).toHaveAttribute('aria-pressed', 'true');
});

test('inversiones: visibles para adultos, ocultas para chicos y el perfil Familia', async ({ page }) => {
  await enter(page, 'Papá');
  await page.goto('./#/ajustes/demo');
  await page.getByRole('button', { name: 'Cargar datos de demostración' }).click();
  await expect(page.getByRole('button', { name: /Eliminar datos de demostración \(\d+\)/ })).toBeEnabled();
  await page.goto('./#/inversiones');
  await page.getByRole('button', { name: /Depto de ejemplo/ }).click();
  await page.getByRole('tab', { name: /Impuestos/ }).click();
  await page.getByRole('button', { name: 'Pagado' }).click();
  await expect(page.getByText('pagado', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Cambiar de perfil/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Hijo/ }).click();
  await page.goto('./#/inversiones');
  await expect(page.getByText(/no está disponible para el perfil Hijo/)).toBeVisible();
});

test('foto de perfil: se recorta, se guarda en el perfil y se ve en el avatar', async ({ page }) => {
  await enter(page, 'Papá');
  await page.goto('./#/familia');
  await page.getByRole('button', { name: 'Editar', exact: true }).first().click();
  // Imagen generada en el momento (no se usan fotos reales)
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 800;
    const x = c.getContext('2d')!; x.fillStyle = '#6f87a3'; x.fillRect(0, 0, 600, 800); x.fillStyle = '#f2c9a0'; x.beginPath(); x.arc(300, 300, 120, 0, 7); x.fill();
    const b: Blob = await new Promise((r) => c.toBlob((bb) => r(bb!), 'image/png'));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(page.getByText('Quitar foto')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('.avatar.has-photo img').first()).toBeVisible();
  const src = await page.locator('.avatar.has-photo img').first().getAttribute('src');
  expect(src!.startsWith('data:image/jpeg')).toBe(true);
  expect(src!.length).toBeLessThan(45_000);
});

test('botón Foto de Inicio: abre la cámara, se elige el destino y se revisa', async ({ page }) => {
  await enter(page, 'Mamá');
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 400;
    const x = c.getContext('2d')!; x.fillStyle = '#c29a5b'; x.fillRect(0, 0, 300, 400);
    const b: Blob = await new Promise((r) => c.toBlob((bb) => r(bb!), 'image/png'));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  await page.locator('label.quick-camera input[type=file]').setInputFiles({ name: 'repuesto.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(page).toHaveURL(/modo=foto/);
  await expect(page.getByRole('img', { name: 'Foto 1' })).toBeVisible();
  await page.getByRole('button', { name: /Compras/ }).click();
  await page.getByLabel(/Qué hay que hacer con esta foto/).fill('Filtro de la pileta');
  await page.getByRole('button', { name: 'Continuar' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Tipo de registro' }).first()).toHaveValue('compra');
});

test('botones Escribir y Voz de Inicio: sin opciones de audio al escribir; la voz abre el dictado', async ({ page }) => {
  await enter(page, 'Mamá');
  await page.getByRole('link', { name: 'Escribir' }).click();
  await expect(page.getByLabel(/Escribí o pegá lo que haya que anotar/)).toBeFocused();
  await expect(page.getByRole('button', { name: /Grabar voz/ })).toHaveCount(0);
  await page.goto('./#/');
  await page.locator('.quick-round').getByRole('link', { name: 'Voz', exact: true }).click();
  await expect(page).toHaveURL(/modo=voz/);
  // En Chromium de pruebas no hay reconocimiento de voz: se muestra la alternativa o el micrófono
  await expect(page.getByText(/no permite dictar por voz|Te escucho|Tocá el micrófono|Listo/).first()).toBeVisible();
});
