/* ==========================================================================
   STORM MULTIMEDIA - МЕНЕДЖЕР ПОЛЬЗОВАТЕЛЬСКИХ СУБТИТРОВ И АУДИОДОРОЖЕК
   Поддержка .srt, .vtt, .ass субтитров со сдвигом тайминга и внешних аудио (.mp3/.aac)
   ========================================================================== */

import { showToast } from './auth.js';
import { trackClientAction } from './achievements.js';

let currentCues = [];
let timingOffset = 0; // Сдвиг в секундах
let attachedVideo = null;
let subtitleOverlay = null;
let syncInterval = null;
let externalAudio = null;

// Настройки внешнего вида субтитров
let subSettings = {
  fontSize: 22,
  color: '#ffffff',
  bgColor: 'rgba(0, 0, 0, 0.7)',
  bottom: 40,
  shadow: true
};

try {
  const savedSubs = localStorage.getItem('storm_sub_settings');
  if (savedSubs) {
    subSettings = { ...subSettings, ...JSON.parse(savedSubs) };
  }
} catch {}

function saveSubSettings() {
  try {
    localStorage.setItem('storm_sub_settings', JSON.stringify(subSettings));
  } catch {}
}

export function initSubtitlesManager(videoElement, containerElement) {
  attachedVideo = videoElement;
  timingOffset = 0;
  currentCues = [];

  // Создаем оверлей субтитров, если ещё не создан
  let overlay = containerElement.querySelector('.storm-subtitles-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'storm-subtitles-overlay';
    containerElement.appendChild(overlay);
  }
  subtitleOverlay = overlay;
  applySubtitleStyles();

  // Навешиваем Drag и Drop
  setupDropZone(containerElement);

  // Запускаем цикл отображения субтитров
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(updateSubtitlesFrame, 100);
}

function applySubtitleStyles() {
  if (!subtitleOverlay) return;
  subtitleOverlay.style.fontSize = `${subSettings.fontSize}px`;
  subtitleOverlay.style.color = subSettings.color;
  subtitleOverlay.style.background = subSettings.bgColor;
  subtitleOverlay.style.bottom = `${subSettings.bottom}px`;
  subtitleOverlay.style.textShadow = subSettings.shadow ? '0 2px 4px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9)' : 'none';
  subtitleOverlay.style.fontWeight = '600';
  subtitleOverlay.style.lineHeight = '1.35';
  subtitleOverlay.style.borderRadius = '6px';
  subtitleOverlay.style.padding = '4px 12px';
  subtitleOverlay.style.maxWidth = '85%';
  subtitleOverlay.style.textAlign = 'center';
  subtitleOverlay.style.pointerEvents = 'none';
  subtitleOverlay.style.transition = 'bottom 0.2s ease, font-size 0.2s ease';
}

function setupDropZone(dropTarget) {
  dropTarget.ondragover = (e) => {
    e.preventDefault();
    dropTarget.classList.add('sub-drag-active');
  };

  dropTarget.ondragleave = (e) => {
    e.preventDefault();
    dropTarget.classList.remove('sub-drag-active');
  };

  dropTarget.ondrop = (e) => {
    e.preventDefault();
    dropTarget.classList.remove('sub-drag-active');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleUploadedFile(files[0]);
    }
  };
}

export function handleUploadedFile(file) {
  const name = file.name.toLowerCase();

  // Субтитры: .srt, .vtt, .ass
  if (name.endsWith('.srt') || name.endsWith('.vtt') || name.endsWith('.ass')) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      if (name.endsWith('.srt')) {
        currentCues = parseSrt(text);
      } else if (name.endsWith('.vtt')) {
        currentCues = parseVtt(text);
      } else if (name.endsWith('.ass')) {
        currentCues = parseAss(text);
      }
      showToast(`Субтитры загружены: ${file.name} (${currentCues.length} реплик)`, 'success');
      trackClientAction('use_subtitles');
      updateSubtitlesControlsUi();
    };
    reader.readAsText(file);
    return;
  }

  // Аудиодорожка: .mp3, .m4a, .aac, .wav
  if (name.endsWith('.mp3') || name.endsWith('.m4a') || name.endsWith('.aac') || name.endsWith('.wav')) {
    const audioUrl = URL.createObjectURL(file);
    loadExternalAudio(audioUrl, file.name);
    return;
  }

  showToast('Неподдерживаемый формат. Используйте файлы субтитров (.srt, .vtt, .ass) или аудио (.mp3, .aac)', 'warning');
}

function parseSrt(text) {
  const cues = [];
  const blocks = text.trim().replace(/\r\n/g, '\n').split(/\n\s*\n/);

  blocks.forEach(block => {
    const lines = block.split('\n');
    if (lines.length >= 2) {
      const timeLine = lines.find(l => l.includes('-->'));
      if (timeLine) {
        const timeIndex = lines.indexOf(timeLine);
        const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
        const startTime = parseTimeToSeconds(startStr);
        const endTime = parseTimeToSeconds(endStr);
        const textContent = lines.slice(timeIndex + 1).join('<br>');
        if (!isNaN(startTime) && !isNaN(endTime)) {
          cues.push({ start: startTime, end: endTime, text: textContent });
        }
      }
    }
  });

  return cues;
}

function parseVtt(text) {
  return parseSrt(text.replace(/^WEBVTT[^\n]*\n/, ''));
}

function parseAss(text) {
  const cues = [];
  const lines = text.split(/\r?\n/);
  const eventLines = lines.filter(l => l.startsWith('Dialogue:'));

  eventLines.forEach(line => {
    const parts = line.substring(9).split(',');
    if (parts.length >= 9) {
      const startStr = parts[1].trim();
      const endStr = parts[2].trim();
      const textRaw = parts.slice(9).join(',');
      // Удаляем ASS теги вида {\k50}, {\b1} и т.д.
      const cleanText = textRaw.replace(/\{[^}]+\}/g, '').replace(/\\N/g, '<br>').trim();

      const startTime = parseAssTimeToSeconds(startStr);
      const endTime = parseAssTimeToSeconds(endStr);
      if (!isNaN(startTime) && !isNaN(endTime) && cleanText) {
        cues.push({ start: startTime, end: endTime, text: cleanText });
      }
    }
  });

  return cues;
}

function parseTimeToSeconds(timeStr) {
  const parts = timeStr.replace(',', '.').split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  return 0;
}

function parseAssTimeToSeconds(timeStr) {
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  return 0;
}

function updateSubtitlesFrame() {
  if (!attachedVideo || !subtitleOverlay || currentCues.length === 0) {
    if (subtitleOverlay) subtitleOverlay.style.display = 'none';
    return;
  }

  const currentTime = attachedVideo.currentTime + timingOffset;
  const activeCue = currentCues.find(cue => currentTime >= cue.start && currentTime <= cue.end);

  if (activeCue) {
    subtitleOverlay.innerHTML = activeCue.text;
    subtitleOverlay.style.display = 'inline-block';
  } else {
    subtitleOverlay.style.display = 'none';
  }
}

export function getActiveSubtitleText(time) {
  if (!currentCues || currentCues.length === 0) return null;
  const t = (time !== undefined ? time : (attachedVideo ? attachedVideo.currentTime : 0)) + timingOffset;
  const activeCue = currentCues.find(cue => t >= cue.start && t <= cue.end);
  return activeCue ? activeCue.text : null;
}

export function getSubtitleOffset() {
  return timingOffset;
}

export function setSubtitleOffset(seconds) {
  timingOffset = Math.round(parseFloat(seconds) * 10) / 10;
  updateSubtitlesControlsUi();
}

export function adjustSubtitleOffset(deltaSeconds) {
  timingOffset = Math.round((timingOffset + deltaSeconds) * 10) / 10;
  if (timingOffset > 15) timingOffset = 15;
  if (timingOffset < -15) timingOffset = -15;
  showToast(`Сдвиг субтитров: ${timingOffset > 0 ? '+' : ''}${timingOffset.toFixed(1)} сек`, 'info');
  updateSubtitlesControlsUi();
}

export function resetSubtitleOffset() {
  timingOffset = 0;
  showToast('Сдвиг субтитров сброшен на 0', 'info');
  updateSubtitlesControlsUi();
}

export function setSubtitleFontSize(size) {
  subSettings.fontSize = parseInt(size, 10) || 22;
  saveSubSettings();
  applySubtitleStyles();
}

export function setSubtitleColor(color) {
  subSettings.color = color;
  saveSubSettings();
  applySubtitleStyles();
}

export function setSubtitleBgColor(bgColor) {
  subSettings.bgColor = bgColor;
  saveSubSettings();
  applySubtitleStyles();
}

export function setSubtitleBottom(bottom) {
  subSettings.bottom = parseInt(bottom, 10) || 40;
  saveSubSettings();
  applySubtitleStyles();
}

export function setSubtitleShadow(enabled) {
  subSettings.shadow = Boolean(enabled);
  saveSubSettings();
  applySubtitleStyles();
}

function loadExternalAudio(audioUrl, fileName) {
  if (externalAudio) {
    externalAudio.pause();
    externalAudio = null;
  }

  externalAudio = new Audio(audioUrl);
  if (attachedVideo) {
    // Приглушаем нативный плеер и связываем с внешним звуком
    attachedVideo.muted = true;
    externalAudio.currentTime = attachedVideo.currentTime;
    if (!attachedVideo.paused) {
      externalAudio.play().catch(() => {});
    }

    attachedVideo.onplay = () => externalAudio?.play().catch(() => {});
    attachedVideo.onpause = () => externalAudio?.pause();
    attachedVideo.onseeking = () => {
      if (externalAudio) externalAudio.currentTime = attachedVideo.currentTime;
    };
  }

  showToast(`Внешняя аудиодорожка подключена: ${fileName}`, 'success');
  trackClientAction('use_subtitles');
}

export function renderSubtitlesControls(containerElement) {
  if (!containerElement) return;

  containerElement.innerHTML = `
    <div class="subtitles-studio-container">
      <!-- Верхняя панель: Загрузка файлов -->
      <div class="subtitles-upload-row" style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px;">
        <label class="storm-btn storm-btn-secondary storm-btn-sm" style="margin: 0; cursor: pointer;">
          <span>💬</span>
          <span>Загрузить субтитры (.srt/.vtt/.ass)</span>
          <input type="file" id="sub-file-input" accept=".srt,.vtt,.ass" style="display: none;">
        </label>
        <label class="storm-btn storm-btn-secondary storm-btn-sm" style="margin: 0; cursor: pointer;">
          <span>🎵</span>
          <span>Внешняя дорожка (.mp3/.aac)</span>
          <input type="file" id="audio-file-input" accept=".mp3,.m4a,.aac,.wav" style="display: none;">
        </label>
      </div>

      <!-- Секция 1: Синхронизация и сдвиг тайминга (Feature 3) -->
      <div class="subtitles-studio-card" style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 14px; margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-weight: 700; font-size: 13px; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
            <span>⏱️</span>
            <span>Синхронизация и задержка субтитров</span>
          </span>
          <span id="sub-offset-label" style="font-weight: 800; font-size: 14px; color: var(--color-cyan); min-width: 55px; text-align: right;">${timingOffset > 0 ? '+' : ''}${timingOffset.toFixed(1)}s</span>
        </div>

        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px;">
          <span style="font-size: 11px; color: var(--text-muted);">-10с</span>
          <input type="range" id="sub-offset-slider" min="-10" max="10" step="0.1" value="${timingOffset}" style="flex: 1; accent-color: var(--color-cyan); cursor: pointer;">
          <span style="font-size: 11px; color: var(--text-muted);">+10с</span>
        </div>

        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="sub-step-m10">-1.0с</button>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="sub-step-m01">-0.1с</button>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="sub-step-zero" style="font-weight: 700;">Сброс (0с)</button>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="sub-step-p01">+0.1с</button>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="sub-step-p10">+1.0с</button>
        </div>
      </div>

      <!-- Секция 2: Стилизация и оформление субтитров (Feature 4) -->
      <div class="subtitles-studio-card" style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 14px;">
        <div style="font-weight: 700; font-size: 13px; color: var(--text-primary); margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
          <span>🎨</span>
          <span>Внешний вид и читаемость субтитров</span>
        </div>

        <!-- Размер шрифта -->
        <div style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
            <span style="color: var(--text-secondary);">Размер шрифта</span>
            <span id="sub-font-size-label" style="font-weight: 700; color: var(--color-cyan);">${subSettings.fontSize}px</span>
          </div>
          <input type="range" id="sub-font-size-slider" min="14" max="36" step="1" value="${subSettings.fontSize}" style="width: 100%; accent-color: var(--color-cyan); cursor: pointer;">
        </div>

        <!-- Высота от нижнего края -->
        <div style="margin-bottom: 14px;">
          <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
            <span style="color: var(--text-secondary);">Положение по вертикали</span>
            <span id="sub-bottom-label" style="font-weight: 700; color: var(--color-cyan);">${subSettings.bottom}px</span>
          </div>
          <input type="range" id="sub-bottom-slider" min="15" max="100" step="5" value="${subSettings.bottom}" style="width: 100%; accent-color: var(--color-cyan); cursor: pointer;">
        </div>

        <!-- Цвет текста -->
        <div style="margin-bottom: 14px;">
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Цвет текста</div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" class="sub-color-pill ${subSettings.color === '#ffffff' ? 'active' : ''}" data-color="#ffffff" style="background:#ffffff; color:#000; border-radius:6px; padding:4px 10px; font-size:11px; font-weight:700; border:none; cursor:pointer;">Белый</button>
            <button type="button" class="sub-color-pill ${subSettings.color === '#ffd700' ? 'active' : ''}" data-color="#ffd700" style="background:#ffd700; color:#000; border-radius:6px; padding:4px 10px; font-size:11px; font-weight:700; border:none; cursor:pointer;">Янтарный</button>
            <button type="button" class="sub-color-pill ${subSettings.color === '#00f0ff' ? 'active' : ''}" data-color="#00f0ff" style="background:#00f0ff; color:#000; border-radius:6px; padding:4px 10px; font-size:11px; font-weight:700; border:none; cursor:pointer;">Неон Циан</button>
            <button type="button" class="sub-color-pill ${subSettings.color === '#00ff66' ? 'active' : ''}" data-color="#00ff66" style="background:#00ff66; color:#000; border-radius:6px; padding:4px 10px; font-size:11px; font-weight:700; border:none; cursor:pointer;">Изумруд</button>
          </div>
        </div>

        <!-- Подложка -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; gap: 6px;">
            <button type="button" class="storm-btn storm-btn-sm ${subSettings.bgColor === 'transparent' ? 'storm-btn-primary' : 'storm-btn-secondary'}" id="sub-bg-none">Без фона</button>
            <button type="button" class="storm-btn storm-btn-sm ${subSettings.bgColor.includes('0.5') ? 'storm-btn-primary' : 'storm-btn-secondary'}" id="sub-bg-soft">Мягкий фон</button>
            <button type="button" class="storm-btn storm-btn-sm ${subSettings.bgColor.includes('0.85') ? 'storm-btn-primary' : 'storm-btn-secondary'}" id="sub-bg-dark">Контрастный</button>
          </div>

          <label class="studio-autoskip-toggle" style="margin: 0; cursor: pointer;">
            <input type="checkbox" id="sub-shadow-toggle" ${subSettings.shadow ? 'checked' : ''}>
            <span class="studio-autoskip-box"></span>
            <span class="studio-autoskip-label" style="font-size: 12px;">Тень и контур</span>
          </label>
        </div>
      </div>
    </div>
  `;

  // Обработчики загрузки файлов
  const subInput = containerElement.querySelector('#sub-file-input');
  if (subInput) {
    subInput.onchange = (e) => {
      if (e.target.files && e.target.files[0]) handleUploadedFile(e.target.files[0]);
    };
  }

  const audioInput = containerElement.querySelector('#audio-file-input');
  if (audioInput) {
    audioInput.onchange = (e) => {
      if (e.target.files && e.target.files[0]) handleUploadedFile(e.target.files[0]);
    };
  }

  // Слайдер сдвига
  const offsetSlider = containerElement.querySelector('#sub-offset-slider');
  if (offsetSlider) {
    offsetSlider.oninput = (e) => setSubtitleOffset(e.target.value);
  }

  // Кнопки шагов
  const btnM10 = containerElement.querySelector('#sub-step-m10');
  const btnM01 = containerElement.querySelector('#sub-step-m01');
  const btnZero = containerElement.querySelector('#sub-step-zero');
  const btnP01 = containerElement.querySelector('#sub-step-p01');
  const btnP10 = containerElement.querySelector('#sub-step-p10');

  if (btnM10) btnM10.onclick = () => adjustSubtitleOffset(-1.0);
  if (btnM01) btnM01.onclick = () => adjustSubtitleOffset(-0.1);
  if (btnZero) btnZero.onclick = () => resetSubtitleOffset();
  if (btnP01) btnP01.onclick = () => adjustSubtitleOffset(0.1);
  if (btnP10) btnP10.onclick = () => adjustSubtitleOffset(1.0);

  // Стилизация шрифта и отступа
  const fontSlider = containerElement.querySelector('#sub-font-size-slider');
  const fontLabel = containerElement.querySelector('#sub-font-size-label');
  if (fontSlider) {
    fontSlider.oninput = (e) => {
      setSubtitleFontSize(e.target.value);
      if (fontLabel) fontLabel.textContent = `${e.target.value}px`;
    };
  }

  const bottomSlider = containerElement.querySelector('#sub-bottom-slider');
  const bottomLabel = containerElement.querySelector('#sub-bottom-label');
  if (bottomSlider) {
    bottomSlider.oninput = (e) => {
      setSubtitleBottom(e.target.value);
      if (bottomLabel) bottomLabel.textContent = `${e.target.value}px`;
    };
  }

  // Цвет
  containerElement.querySelectorAll('.sub-color-pill').forEach(pill => {
    pill.onclick = () => {
      containerElement.querySelectorAll('.sub-color-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      setSubtitleColor(pill.dataset.color);
    };
  });

  // Фон
  const bgNone = containerElement.querySelector('#sub-bg-none');
  const bgSoft = containerElement.querySelector('#sub-bg-soft');
  const bgDark = containerElement.querySelector('#sub-bg-dark');

  if (bgNone) {
    bgNone.onclick = () => {
      setSubtitleBgColor('transparent');
      bgNone.className = 'storm-btn storm-btn-sm storm-btn-primary';
      if (bgSoft) bgSoft.className = 'storm-btn storm-btn-sm storm-btn-secondary';
      if (bgDark) bgDark.className = 'storm-btn storm-btn-sm storm-btn-secondary';
    };
  }

  if (bgSoft) {
    bgSoft.onclick = () => {
      setSubtitleBgColor('rgba(0, 0, 0, 0.5)');
      bgSoft.className = 'storm-btn storm-btn-sm storm-btn-primary';
      if (bgNone) bgNone.className = 'storm-btn storm-btn-sm storm-btn-secondary';
      if (bgDark) bgDark.className = 'storm-btn storm-btn-sm storm-btn-secondary';
    };
  }

  if (bgDark) {
    bgDark.onclick = () => {
      setSubtitleBgColor('rgba(0, 0, 0, 0.85)');
      bgDark.className = 'storm-btn storm-btn-sm storm-btn-primary';
      if (bgNone) bgNone.className = 'storm-btn storm-btn-sm storm-btn-secondary';
      if (bgSoft) bgSoft.className = 'storm-btn storm-btn-sm storm-btn-secondary';
    };
  }

  // Тень
  const shadowToggle = containerElement.querySelector('#sub-shadow-toggle');
  if (shadowToggle) {
    shadowToggle.onchange = (e) => setSubtitleShadow(e.target.checked);
  }
}

function updateSubtitlesControlsUi() {
  const label = document.getElementById('sub-offset-label');
  const slider = document.getElementById('sub-offset-slider');
  if (label) {
    label.textContent = `${timingOffset > 0 ? '+' : ''}${timingOffset.toFixed(1)}s`;
  }
  if (slider) {
    slider.value = timingOffset;
  }
}
