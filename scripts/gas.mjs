// Sube el backend (apps-script/) a Google Apps Script sin copiar y pegar, usando clasp (herramienta oficial de Google).
//
//   npm run gas:login    → una sola vez: abre el navegador para iniciar sesión con la cuenta de Google de la familia
//   npm run gas:create   → una sola vez: crea el proyecto "Hogar backend" en esa cuenta
//   npm run gas:deploy   → cada vez que cambie apps-script/: sube el código y actualiza la MISMA aplicación web
//                          (la URL /exec no cambia, así que los celulares no hay que reconfigurarlos)
//   npm run gas:push     → solo sube el código (sin publicar una versión nueva)
//
// .clasp.json (id del proyecto) y .gas-deployment.json (id de la implementación) quedan solo en esta computadora.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const cmd = process.argv[2];
const DEPLOY_FILE = '.gas-deployment.json';
// Usa los certificados de Windows/macOS (evita errores cuando un antivirus inspecciona las conexiones seguras).
const env = { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--use-system-ca'].filter(Boolean).join(' ') };
const run = (c) => execSync(c, { stdio: 'pipe', encoding: 'utf8', env });
const show = (c) => execSync(c, { stdio: 'inherit', env });

function needProject() {
  if (!existsSync('.clasp.json')) {
    console.error('Todavía no hay proyecto. Ejecutá primero: npm run gas:login  y luego  npm run gas:create');
    process.exit(1);
  }
}

if (cmd === 'create') {
  if (existsSync('.clasp.json')) { console.log('El proyecto ya existe (.clasp.json). Usá npm run gas:deploy.'); process.exit(0); }
  show('npx clasp create --type standalone --title "Hogar backend" --rootDir apps-script');
  // clasp 2.x guarda .clasp.json dentro de rootDir: se mueve a la raíz del proyecto
  if (!existsSync('.clasp.json') && existsSync('apps-script/.clasp.json')) renameSync('apps-script/.clasp.json', '.clasp.json');
  show('node scripts/gen-gas-schema.mjs');
  show('npx clasp push --force');
  console.log(`
Proyecto creado y código subido. Falta UNA sola vez autorizar los permisos:
  1. npx clasp open   (abre el editor de Apps Script)
  2. Elegí la función "inicializar" y tocá Ejecutar → aceptá los permisos con la cuenta de Google de la familia
  3. Copiá el token que aparece en el registro de ejecución
  4. npm run gas:deploy   (publica la aplicación web y muestra la URL para pegar en la app)`);
} else if (cmd === 'push') {
  needProject();
  show('node scripts/gen-gas-schema.mjs');
  show('npx clasp push --force');
} else if (cmd === 'deploy') {
  needProject();
  show('node scripts/gen-gas-schema.mjs');
  show('npx clasp push --force');
  const saved = existsSync(DEPLOY_FILE) ? JSON.parse(readFileSync(DEPLOY_FILE, 'utf8')) : null;
  const desc = `Hogar ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const out = run(saved?.deploymentId ? `npx clasp deploy -i ${saved.deploymentId} -d "${desc}"` : `npx clasp deploy -d "${desc}"`);
  process.stdout.write(out);
  const id = saved?.deploymentId ?? /-\s*(AKfy[\w-]+)\s*@/.exec(out)?.[1];
  if (!id) { console.error('No se pudo leer el id de la implementación en la salida de clasp.'); process.exit(1); }
  writeFileSync(DEPLOY_FILE, JSON.stringify({ deploymentId: id }, null, 2));
  console.log(`\nListo. URL de la aplicación web (no cambia entre versiones):\nhttps://script.google.com/macros/s/${id}/exec`);
} else {
  console.log('Uso: node scripts/gas.mjs create | push | deploy');
  process.exit(1);
}
