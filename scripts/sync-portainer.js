/**
 * STORM MULTIMEDIA - Автоматическая синхронизация файлов в контейнер Synology NAS (Portainer Docker API)
 */
import '../env-loader.js';
import fs from 'fs';
import path from 'path';

function collectDirFiles(dirRel, out = []) {
  if (!fs.existsSync(dirRel)) return out;
  for (const entry of fs.readdirSync(dirRel, { withFileTypes: true })) {
    const fullRel = path.posix.join(dirRel.replace(/\\/g, '/'), entry.name);
    if (entry.isDirectory()) {
      collectDirFiles(fullRel, out);
    } else if (entry.isFile() && !/\.(?:apk|zip|exe|db|sqlite|sqlite3|log)$/i.test(entry.name)) {
      out.push(fullRel);
    }
  }
  return out;
}

function createTar(files) {
  const chunks = [];
  for (const file of files) {
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
    const header = Buffer.alloc(512, 0);

    let namePart = file.name.replace(/\\/g, '/');
    let prefixPart = '';
    if (Buffer.byteLength(namePart, 'utf8') > 99) {
      const idx = namePart.lastIndexOf('/');
      if (idx > 0) {
        prefixPart = namePart.slice(0, idx);
        namePart = namePart.slice(idx + 1);
      }
    }

    header.write(namePart, 0, Math.min(100, Buffer.byteLength(namePart, 'utf8')), 'utf8');
    if (prefixPart) {
      header.write(prefixPart, 345, Math.min(155, Buffer.byteLength(prefixPart, 'utf8')), 'utf8');
    }
    header.write('0000644\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');

    const sizeStr = content.length.toString(8).padStart(11, '0') + '\0';
    header.write(sizeStr, 124, 12, 'ascii');

    const mtimeStr = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0';
    header.write(mtimeStr, 136, 12, 'ascii');

    header.fill(32, 148, 156);
    header.write('0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');

    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    const chkStr = sum.toString(8).padStart(6, '0') + '\0 ';
    header.write(chkStr, 148, 8, 'ascii');

    chunks.push(header);
    chunks.push(content);

    const remainder = content.length % 512;
    if (remainder !== 0) chunks.push(Buffer.alloc(512 - remainder, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

async function ensureFastBootWrappers(host, port, jwt, epId, containerId) {
  try {
    const setupCmd = [
      'if [ ! -f /usr/local/bin/npm.real ]; then mv /usr/local/bin/npm /usr/local/bin/npm.real; fi',
      'printf "#!/bin/sh\\nif [ \\"\\$1\\" = \\"install\\" ] && [ -d \\"/app/node_modules/express\\" ]; then exit 0; fi\\nexec /usr/local/bin/npm.real \\"\\$@\\"\\n" > /usr/local/bin/npm',
      'chmod +x /usr/local/bin/npm',
      'if [ ! -f /sbin/apk.real ]; then cp /sbin/apk /sbin/apk.real; fi',
      'printf "#!/bin/sh\\nif [ \\"\\$1\\" = \\"add\\" ] && [ -f \\"/usr/bin/wget\\" ]; then exit 0; fi\\nexec /sbin/apk.real \\"\\$@\\"\\n" > /sbin/apk',
      'chmod +x /sbin/apk'
    ].join(' && ');

    const exRes = await fetch(`http://${host}:${port}/api/endpoints/${epId}/docker/containers/${containerId}/exec`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
      body: JSON.stringify({ AttachStdout: true, AttachStderr: true, Cmd: ['sh', '-c', setupCmd] })
    });
    if (exRes.ok) {
      const { Id } = await exRes.json();
      await fetch(`http://${host}:${port}/api/endpoints/${epId}/docker/exec/${Id}/start`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
        body: JSON.stringify({ Detach: false, Tty: true })
      });
    }
  } catch (_) {}
}

export async function syncToPortainer(options = {}) {
  const host = options.host || process.env.PORTAINER_HOST || process.env.DB_HOST_FALLBACK || '127.0.0.1';
  const port = Number(options.port || process.env.PORTAINER_PORT || 9000);
  const username = options.username || process.env.PORTAINER_USER || '';
  const password = options.password || process.env.PORTAINER_PASSWORD || '';

  if (!username || !password) {
    throw new Error('Укажите PORTAINER_HOST, PORTAINER_USER и PORTAINER_PASSWORD в локальном файле .env');
  }

  console.log(`[Portainer Sync] Авторизация на http://${host}:${port}...`);
  const authRes = await fetch(`http://${host}:${port}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Username: username, Password: password })
  });
  if (!authRes.ok) throw new Error('Portainer auth error: ' + authRes.status);
  const { jwt } = await authRes.json();

  const endpointsRes = await fetch(`http://${host}:${port}/api/endpoints`, {
    headers: { 'Authorization': 'Bearer ' + jwt }
  });
  const endpoints = await endpointsRes.json();
  const epId = endpoints[0].Id;

  const containersRes = await fetch(`http://${host}:${port}/api/endpoints/${epId}/docker/containers/json?all=true`, {
    headers: { 'Authorization': 'Bearer ' + jwt }
  });
  const containers = await containersRes.json();
  const stormContainer = containers.find(c => c.Names.includes('/storm-multimedia'));
  if (!stormContainer) throw new Error('Контейнер storm-multimedia не найден!');

  console.log(`[Portainer Sync] Найден контейнер: ${stormContainer.Id.slice(0, 12)} (${stormContainer.State})`);

  const rootFiles = ['package.json', 'env-loader.js', 'server.js', 'db.js', 'mariadb.js', '.env'];
  const filePaths = Array.from(new Set([
    ...rootFiles,
    ...collectDirFiles('services'),
    ...collectDirFiles('public')
  ]));

  const tarFiles = [];
  for (const rel of filePaths) {
    if (fs.existsSync(rel)) {
      tarFiles.push({
        name: rel.replace(/\\/g, '/'),
        content: fs.readFileSync(rel)
      });
    }
  }
  console.log(`  [+] Упаковано файлов: ${tarFiles.length}`);

  const tarBuffer = createTar(tarFiles);
  console.log(`[Portainer Sync] Загрузка архива (${tarBuffer.length} байт) в /app...`);

  const uploadRes = await fetch(`http://${host}:${port}/api/endpoints/${epId}/docker/containers/${stormContainer.Id}/archive?path=/app`, {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + jwt,
      'Content-Type': 'application/x-tar'
    },
    body: tarBuffer
  });

  if (!uploadRes.ok) throw new Error('Upload error: ' + uploadRes.status);
  console.log('[Portainer Sync] Файлы успешно обновлены.');

  await ensureFastBootWrappers(host, port, jwt, epId, stormContainer.Id);

  console.log('[Portainer Sync] Перезапуск контейнера...');
  const restartRes = await fetch(`http://${host}:${port}/api/endpoints/${epId}/docker/containers/${stormContainer.Id}/restart?t=2`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + jwt }
  });
  console.log(`[Portainer Sync] Перезапуск завершен (HTTP ${restartRes.status})`);

  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const hRes = await fetch(`http://${host}:3900/api/health`);
      if (hRes.ok) {
        const hJson = await hRes.json();
        console.log(`[Portainer Sync] Сервер онлайн (версия ${hJson.version}, БД: ${hJson.database?.driver})`);
        break;
      }
    } catch (_) {}
  }
}

// Если запущен напрямую из CLI
if (process.argv[1] && process.argv[1].endsWith('sync-portainer.js')) {
  syncToPortainer().catch(console.error);
}
