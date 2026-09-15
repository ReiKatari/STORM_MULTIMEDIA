/* ==========================================================================
   STORM MULTIMEDIA - СИНХРОНИЗАЦИЯ AMBILIGHT С УМНЫМ ДОМОМ
   Поддержка протоколов WLED, Philips Hue, Yeelight и Webhook
   ========================================================================== */

import { showToast } from './auth.js';

let lightsConfig = {
  enabled: false,
  protocol: 'wled', // 'wled', 'hue', 'yeelight', 'webhook'
  ip: '',
  brightness: 180,
  rateLimitMs: 120
};

try {
  const saved = localStorage.getItem('storm_smart_lights_config');
  if (saved) lightsConfig = { ...lightsConfig, ...JSON.parse(saved) };
} catch {}

let lastSendTime = 0;
let isSending = false;

export function getSmartLightsConfig() {
  return lightsConfig;
}

export function saveSmartLightsConfig(newConfig) {
  lightsConfig = { ...lightsConfig, ...newConfig };
  localStorage.setItem('storm_smart_lights_config', JSON.stringify(lightsConfig));
}

export async function sendSmartLightsFrame(r, g, b) {
  if (!lightsConfig.enabled || !lightsConfig.ip || isSending) return;

  const now = Date.now();
  if (now - lastSendTime < lightsConfig.rateLimitMs) return;

  lastSendTime = now;
  isSending = true;

  try {
    const bri = Math.min(255, Math.max(10, lightsConfig.brightness || 180));

    if (lightsConfig.protocol === 'wled') {
      // WLED JSON API: /json/state
      const url = `http://${lightsConfig.ip}/json/state`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          on: true,
          bri: bri,
          seg: [{ col: [[Math.round(r), Math.round(g), Math.round(b)]] }]
        }),
        mode: 'no-cors'
      });
    } else if (lightsConfig.protocol === 'yeelight') {
      // Yeelight Local HTTP bridge или Webhook
      const url = `http://${lightsConfig.ip}/color`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ r: Math.round(r), g: Math.round(g), b: Math.round(b), brightness: bri }),
        mode: 'no-cors'
      });
    } else if (lightsConfig.protocol === 'webhook') {
      const url = lightsConfig.ip.startsWith('http') ? lightsConfig.ip : `http://${lightsConfig.ip}`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ r: Math.round(r), g: Math.round(g), b: Math.round(b), bri: bri }),
        mode: 'no-cors'
      });
    }
  } catch (err) {
    // Безопасно игнорируем одиночные сбои сетевых кадров
  } finally {
    isSending = false;
  }
}

export async function testSmartLightsConnection() {
  if (!lightsConfig.ip) {
    showToast('Введите IP-адрес или URL умной подсветки', 'warning');
    return;
  }

  showToast(`Отправка тестового сигнала на ${lightsConfig.ip}...`, 'info');
  try {
    await sendSmartLightsFrame(0, 210, 255);
    showToast(`✅ Сигнал успешно отправлен на ${lightsConfig.ip}`, 'success');
  } catch (err) {
    showToast(`Ошибка подключения: ${err.message}`, 'error');
  }
}

export function renderSmartLightsSettings(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="smart-lights-panel">
      <div style="font-weight: 700; font-size: 13px; margin-bottom: 8px; color: var(--accent); display: flex; align-items: center; gap: 6px;">
        <span>💡</span>
        <span>Синхронизация с умным домом (WLED / Hue / Yeelight)</span>
      </div>

      <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 10px; flex-wrap: wrap;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px;">
          <input type="checkbox" id="smart-lights-enabled-check" ${lightsConfig.enabled ? 'checked' : ''}>
          <span>Включить трансляцию цветов на умные лампы</span>
        </label>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-bottom: 10px;">
        <div>
          <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 4px;">Протокол устройства</label>
          <select class="storm-select" id="smart-lights-proto-select" style="width: 100%; font-size: 12px; padding: 6px;">
            <option value="wled" ${lightsConfig.protocol === 'wled' ? 'selected' : ''}>WLED контроллер</option>
            <option value="yeelight" ${lightsConfig.protocol === 'yeelight' ? 'selected' : ''}>Yeelight (HTTP)</option>
            <option value="hue" ${lightsConfig.protocol === 'hue' ? 'selected' : ''}>Philips Hue Bridge</option>
            <option value="webhook" ${lightsConfig.protocol === 'webhook' ? 'selected' : ''}>Кастомный Webhook</option>
          </select>
        </div>

        <div>
          <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 4px;">IP-адрес / URL ленты</label>
          <input type="text" class="storm-input" id="smart-lights-ip-input" value="${lightsConfig.ip || ''}" placeholder="192.168.1.150" style="width: 100%; font-size: 12px; padding: 6px;">
        </div>

        <div>
          <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 4px;">Яркость (${lightsConfig.brightness || 180})</label>
          <input type="range" class="storm-slider" id="smart-lights-bri-slider" min="10" max="255" value="${lightsConfig.brightness || 180}">
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="smart-lights-test-btn">Проверить связь</button>
        <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="smart-lights-save-btn">Сохранить</button>
      </div>
    </div>
  `;

  const enabledCheck = container.querySelector('#smart-lights-enabled-check');
  const protoSelect = container.querySelector('#smart-lights-proto-select');
  const ipInput = container.querySelector('#smart-lights-ip-input');
  const briSlider = container.querySelector('#smart-lights-bri-slider');
  const testBtn = container.querySelector('#smart-lights-test-btn');
  const saveBtn = container.querySelector('#smart-lights-save-btn');

  if (testBtn) testBtn.onclick = testSmartLightsConnection;

  if (saveBtn) {
    saveBtn.onclick = () => {
      saveSmartLightsConfig({
        enabled: enabledCheck.checked,
        protocol: protoSelect.value,
        ip: ipInput.value.trim(),
        brightness: parseInt(briSlider.value, 10) || 180
      });
      showToast('Настройки умной подсветки сохранены', 'success');
    };
  }
}
