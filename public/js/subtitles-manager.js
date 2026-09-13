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
  bottom: 40
};

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

export function adjustSubtitleOffset(deltaSeconds) {
  timingOffset += deltaSeconds;
  showToast(`Сдвиг субтитров: ${timingOffset > 0 ? '+' : ''}${timingOffset.toFixed(1)} сек`, 'info');
  updateSubtitlesControlsUi();
}

export function resetSubtitleOffset() {
  timingOffset = 0;
  showToast('Сдвиг субтитров сброшен на 0', 'info');
  updateSubtitlesControlsUi();
}

export function setSubtitleFontSize(size) {
  subSettings.fontSize = size;
  applySubtitleStyles();
}

export function setSubtitleColor(color) {
  subSettings.color = color;
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
    <div class="subtitles-panel-bar">
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <label class="storm-btn storm-btn-secondary storm-btn-sm" style="margin: 0; cursor: pointer;">
          💬 Субтитры (.srt/.vtt/.ass)
          <input type="file" id="sub-file-input" accept=".srt,.vtt,.ass" style="display: none;">
        </label>
        <label class="storm-btn storm-btn-secondary storm-btn-sm" style="margin: 0; cursor: pointer;">
          🎵 Внешнее аудио (.mp3)
          <input type="file" id="audio-file-input" accept=".mp3,.m4a,.aac,.wav" style="display: none;">
        </label>

        <!-- Управление синхронизацией -->
        <div class="sub-sync-group" id="sub-sync-controls" style="${currentCues.length > 0 ? 'display:flex;' : 'display:none;'} align-items: center; gap: 4px;">
          <span style="font-size: 11px; color: var(--text-muted);">Сдвиг:</span>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="sub-offset-minus">-0.5s</button>
          <span id="sub-offset-label" style="font-size: 11px; font-weight: 800; min-width: 45px; text-align: center;">0.0s</span>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="sub-offset-plus">+0.5s</button>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="sub-offset-reset">Сброс</button>
        </div>
      </div>
    </div>
  `;

  const subInput = containerElement.querySelector('#sub-file-input');
  if (subInput) {
    subInput.onchange = (e) => {
      if (e.target.files && e.target.files[0]) {
        handleUploadedFile(e.target.files[0]);
      }
    };
  }

  const audioInput = containerElement.querySelector('#audio-file-input');
  if (audioInput) {
    audioInput.onchange = (e) => {
      if (e.target.files && e.target.files[0]) {
        handleUploadedFile(e.target.files[0]);
      }
    };
  }

  const minusBtn = containerElement.querySelector('#sub-offset-minus');
  const plusBtn = containerElement.querySelector('#sub-offset-plus');
  const resetBtn = containerElement.querySelector('#sub-offset-reset');

  if (minusBtn) minusBtn.onclick = () => adjustSubtitleOffset(-0.5);
  if (plusBtn) plusBtn.onclick = () => adjustSubtitleOffset(0.5);
  if (resetBtn) resetBtn.onclick = () => resetSubtitleOffset();
}

function updateSubtitlesControlsUi() {
  const syncGroup = document.getElementById('sub-sync-controls');
  const label = document.getElementById('sub-offset-label');
  if (syncGroup) {
    syncGroup.style.display = currentCues.length > 0 ? 'flex' : 'none';
  }
  if (label) {
    label.textContent = `${timingOffset > 0 ? '+' : ''}${timingOffset.toFixed(1)}s`;
  }
}
