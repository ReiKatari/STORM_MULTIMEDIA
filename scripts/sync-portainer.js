/**
 * STORM MULTIMEDIA - Автоматическая синхронизация файлов в контейнер Synology NAS (Portainer Docker API)
 */
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

export async function syncToPortainer(options = {}) {
  const host = options.host || '192.168.1.154';
  const port = options.port || 9000;
  const username = options.username || 'ReiKatari';
  const password = options.password || 'SeR1eNi!2Ty9kP';

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

  const rootFiles = ['package.json', 'server.js', 'db.js', 'mariadb.js'];
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

  console.log('[Portainer Sync] Перезапуск контейнера...');
  const restartRes = await fetch(`http://${host}:${port}/api/endpoints/${epId}/docker/containers/${stormContainer.Id}/restart?t=3`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + jwt }
  });
  console.log(`[Portainer Sync] Перезапуск завершен (HTTP ${restartRes.status})`);
}

// Если запущен напрямую из CLI
if (process.argv[1] && process.argv[1].endsWith('sync-portainer.js')) {
  syncToPortainer().catch(console.error);
}
