/**
 * STORM MULTIMEDIA - Автоматическая синхронизация файлов в контейнер Synology NAS (Portainer Docker API)
 */
import fs from 'fs';

function createTar(files) {
  const chunks = [];
  for (const file of files) {
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
    const header = Buffer.alloc(512, 0);

    header.write(file.name, 0, Math.min(100, file.name.length), 'utf8');
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

  const filePaths = [
    'package.json',
    'server.js',
    'db.js',
    'public/index.html',
    'public/remote.html',
    'public/sw.js',
    'public/js/catalog-baseline.js',
    'services/catalog-fallback.js',
    'services/fanfilm-service.js',
    'services/fanfilm-catalog-intel.js',
    'services/kinobox-service.js',
    'services/canonical-media-intel.js',
    'services/tmdb-service.js',
    'public/js/fanfilm-catalog-intel.js',
    'public/js/app.js',
    'public/js/player.js',
    'public/js/auth.js',
    'public/js/ad-shield.js',
    'public/js/smart-skip.js',
    'public/js/bookmarks.js',
    'public/js/gamepad-tv.js',
    'public/js/storm-remote.js',
    'public/js/release-calendar.js',
    'public/js/neural-recommender.js',
    'public/js/updater.js',
    'public/js/form-factor.js',
    'public/styles/tv-mode.css',
    'public/styles/main.css',
    'public/styles/components.css'
  ];

  const tarFiles = [];
  for (const rel of filePaths) {
    if (fs.existsSync(rel)) {
      tarFiles.push({
        name: rel.replace(/\\/g, '/'),
        content: fs.readFileSync(rel)
      });
      console.log(`  [+] Упакован: ${rel}`);
    }
  }

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
