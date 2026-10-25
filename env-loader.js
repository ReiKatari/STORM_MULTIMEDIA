/**
 * STORM MULTIMEDIA — Автономный загрузчик переменных окружения (.env) без внешних зависимостей
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '.env');

export function loadStormEnv(customPath = envPath) {
  try {
    if (!fs.existsSync(customPath)) return false;
    if (typeof process.loadEnvFile === 'function') {
      try {
        process.loadEnvFile(customPath);
        return true;
      } catch (_) {}
    }
    const content = fs.readFileSync(customPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
    return true;
  } catch (_) {
    return false;
  }
}

loadStormEnv();
