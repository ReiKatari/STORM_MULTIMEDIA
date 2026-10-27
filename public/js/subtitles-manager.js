/**
 * Модуль продвинутого управления субтитрами, двойными субтитрами (RU + EN)
 * и интерактивным живым словарем (STORM Subtitles Studio 2.0)
 */

import { showToast } from './auth.js?v=1.2.5';

let currentVideo = null;
let parsedCues = [];
let secondaryCues = [];
let subtitleOffsetSec = 0; // Сдвиг тайминга в секундах (например, +0.5 или -1.0)
let overlayElement = null;
let dictPopupElement = null;
let animationFrameId = null;
let dualSubtitlesEnabled = localStorage.getItem('storm_dual_subtitles') === 'true';
let liveDictEnabled = localStorage.getItem('storm_live_dict') !== 'false';
let autoPauseOnHover = localStorage.getItem('storm_sub_autopause') !== 'false';
let wasPlayingBeforeHover = false;

let subtitleStyle = {
  fontSize: parseInt(localStorage.getItem('storm_sub_size') || '22', 10),
  color: localStorage.getItem('storm_sub_color') || '#ffffff',
  bgOpacity: parseFloat(localStorage.getItem('storm_sub_bg') || '0.65'),
  bottomOffset: parseInt(localStorage.getItem('storm_sub_bottom') || '45', 10)
};

export function initSubtitlesManager(videoElement, playerContainer) {
  currentVideo = videoElement;
  parsedCues = [];
  secondaryCues = [];
  subtitleOffsetSec = 0;

  if (overlayElement) {
    overlayElement.remove();
  }
  if (dictPopupElement) {
    dictPopupElement.remove();
  }

  overlayElement = document.createElement('div');
  overlayElement.className = 'storm-custom-subtitles-overlay';
  applyOverlayStyles();
  playerContainer.appendChild(overlayElement);

  dictPopupElement = document.createElement('div');
  dictPopupElement.className = 'storm-sub-dict-popup';
  dictPopupElement.style.cssText = `
    position: absolute;
    bottom: ${subtitleStyle.bottomOffset + 64}px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(10, 14, 24, 0.96);
    border: 1px solid var(--accent, #00d2ff);
    border-radius: 12px;
    padding: 12px 16px;
    color: #fff;
    z-index: 60;
    min-width: 260px;
    max-width: 420px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(12px);
    display: none;
    pointer-events: auto;
    font-size: 13px;
    line-height: 1.45;
  `;
  playerContainer.appendChild(dictPopupElement);

  startSubtitleRenderLoop();
}

function applyOverlayStyles() {
  if (!overlayElement) return;
  overlayElement.style.cssText = `
    position: absolute;
    bottom: ${subtitleStyle.bottomOffset}px;
    left: 50%;
    transform: translateX(-50%);
    max-width: 86%;
    text-align: center;
    font-size: ${subtitleStyle.fontSize}px;
    font-weight: 700;
    color: ${subtitleStyle.color};
    background: rgba(0, 0, 0, ${subtitleStyle.bgOpacity});
    padding: 6px 16px;
    border-radius: 8px;
    pointer-events: ${liveDictEnabled ? 'auto' : 'none'};
    z-index: 35;
    text-shadow: 0 2px 4px rgba(0,0,0,0.9);
    display: none;
    line-height: 1.4;
    transition: bottom 0.2s ease;
  `;
}

function tokenizeCueHtml(text, isSecondary = false) {
  if (!liveDictEnabled) return text;
  const clean = String(text || '').replace(/<[^>]+>/g, '');
  return clean.split(/(\s+)/).map(part => {
    if (/^\s+$/.test(part)) return part;
    const rawW = part.replace(/[^\p{L}\p{N}\-']/gu, '');
    if (rawW.length < 2) return part;
    return `<span class="storm-sub-word" data-word="${rawW.replace(/"/g, '&quot;')}" style="cursor:pointer;border-bottom:1px dotted ${isSecondary ? 'rgba(56,189,248,0.6)' : 'rgba(255,255,255,0.4)'};padding:0 1px;border-radius:3px;transition:background 0.15s;">${part}</span>`;
  }).join('');
}

async function showWordTranslationPopup(word, contextSentence) {
  if (!dictPopupElement) return;
  dictPopupElement.style.display = 'block';
  dictPopupElement.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
      <strong style="color:var(--accent,#00d2ff);font-size:15px;">📖 ${word}</strong>
      <button type="button" id="storm-dict-close-btn" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;">✕</button>
    </div>
    <div style="color:#94a3b8;font-size:12px;">⏳ Перевод слова в контексте сцены...</div>
  `;
  const closeBtn = dictPopupElement.querySelector('#storm-dict-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      dictPopupElement.style.display = 'none';
    };
  }

  try {
    const res = await fetch(`/api/subtitles/translate-word?word=${encodeURIComponent(word)}&context=${encodeURIComponent(contextSentence || '')}`);
    const data = await res.json();
    if (!data || !data.success) throw new Error('Не удалось перевести');

    dictPopupElement.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;">
        <div>
          <strong style="color:var(--accent,#00d2ff);font-size:15px;">📖 ${data.word}</strong>
          <span style="font-size:11px;color:#94a3b8;margin-left:6px;">${data.partOfSpeech || ''}</span>
        </div>
        <button type="button" id="storm-dict-close-btn" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;">✕</button>
      </div>
      <div style="font-size:14px;font-weight:700;color:#10b981;margin-bottom:6px;">${data.translation}</div>
      ${data.contextTranslation ? `<div style="font-size:11.5px;color:#cbd5e1;background:rgba(255,255,255,0.05);padding:6px 8px;border-radius:6px;margin-bottom:6px;">💬 <i>${data.contextTranslation}</i></div>` : ''}
      ${data.example ? `<div style="font-size:11px;color:#94a3b8;">💡 ${data.example}</div>` : ''}
      <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:8px;">
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="storm-dict-speak-btn" style="padding:3px 8px;font-size:11px;">🔊 Произношение</button>
        <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="storm-dict-save-btn" style="padding:3px 8px;font-size:11px;">⭐ В словарь</button>
      </div>
    `;
    const cBtn = dictPopupElement.querySelector('#storm-dict-close-btn');
    if (cBtn) cBtn.onclick = () => { dictPopupElement.style.display = 'none'; };

    const speakBtn = dictPopupElement.querySelector('#storm-dict-speak-btn');
    if (speakBtn && 'speechSynthesis' in window) {
      speakBtn.onclick = () => {
        const u = new SpeechSynthesisUtterance(data.cleanWord || word);
        u.lang = /[а-яё]/i.test(word) ? 'ru-RU' : 'en-US';
        window.speechSynthesis.speak(u);
      };
    }

    const saveBtn = dictPopupElement.querySelector('#storm-dict-save-btn');
    if (saveBtn) {
      saveBtn.onclick = () => {
        try {
          const saved = JSON.parse(localStorage.getItem('storm_saved_vocab') || '[]');
          saved.unshift({ word: data.word, translation: data.translation, date: new Date().toLocaleDateString('ru-RU') });
          localStorage.setItem('storm_saved_vocab', JSON.stringify(saved.slice(0, 200)));
          showToast(`Слово «${data.word}» сохранено в личный словарь`, 'success');
        } catch (_) {}
      };
    }
  } catch (err) {
    dictPopupElement.innerHTML = `<div style="color:#f87171;font-size:12px;">Ошибка перевода: ${err.message}</div>`;
  }
}

let lastRenderedPrimaryText = '';
let lastRenderedSecondaryText = '';

function startSubtitleRenderLoop() {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);

  function render() {
    if (!overlayElement) {
      const box = document.querySelector('.player-video-box') || document.getElementById('cinema-player-wrapper');
      if (box) {
        overlayElement = document.createElement('div');
        overlayElement.className = 'storm-custom-subtitles-overlay';
        applyOverlayStyles();
        box.appendChild(overlayElement);
      }
    }
    const rawTime = currentVideo ? currentVideo.currentTime : (Number(window.currentWatchProgressSec) || 0);
    if (overlayElement && (parsedCues.length > 0 || secondaryCues.length > 0)) {
      const adjustedTime = rawTime - subtitleOffsetSec;
      const activePrimary = parsedCues.find(c => adjustedTime >= c.start && adjustedTime <= c.end);
      const activeSecondary = dualSubtitlesEnabled
        ? secondaryCues.find(c => adjustedTime >= c.start && adjustedTime <= c.end)
        : null;

      const pText = activePrimary ? activePrimary.text : '';
      const sText = activeSecondary ? activeSecondary.text : '';

      if (pText || sText) {
        overlayElement.style.display = 'block';
        if (pText !== lastRenderedPrimaryText || sText !== lastRenderedSecondaryText) {
          lastRenderedPrimaryText = pText;
          lastRenderedSecondaryText = sText;
          let html = '';
          if (pText) {
            html += `<div class="storm-sub-line-primary">${tokenizeCueHtml(pText, false)}</div>`;
          }
          if (sText) {
            html += `<div class="storm-sub-line-secondary" style="font-size:${Math.max(13, Math.round(subtitleStyle.fontSize * 0.78))}px;color:#38bdf8;margin-top:4px;font-weight:600;">${tokenizeCueHtml(sText, true)}</div>`;
          }
          overlayElement.innerHTML = html;

          if (liveDictEnabled) {
            overlayElement.querySelectorAll('.storm-sub-word').forEach(span => {
              span.onmouseenter = () => {
                span.style.background = 'rgba(0, 210, 255, 0.28)';
                if (autoPauseOnHover && currentVideo && !currentVideo.paused) {
                  wasPlayingBeforeHover = true;
                  currentVideo.pause();
                }
              };
              span.onmouseleave = () => {
                span.style.background = 'transparent';
              };
              span.onclick = (e) => {
                e.stopPropagation();
                const w = span.dataset.word;
                const ctx = (sText || pText || '').replace(/<[^>]+>/g, '');
                showWordTranslationPopup(w, ctx);
              };
            });

            overlayElement.onmouseleave = () => {
              if (autoPauseOnHover && wasPlayingBeforeHover && currentVideo && currentVideo.paused && (!dictPopupElement || dictPopupElement.style.display === 'none')) {
                wasPlayingBeforeHover = false;
                currentVideo.play().catch(() => {});
              }
            };
          }
        }
      } else {
        overlayElement.style.display = 'none';
        lastRenderedPrimaryText = '';
        lastRenderedSecondaryText = '';
      }
    }
    animationFrameId = requestAnimationFrame(render);
  }

  animationFrameId = requestAnimationFrame(render);
}

/**
 * Парсинг локальных и внешних файлов .srt, .vtt и .ass
 */
export function loadExternalSubtitleFile(file, isSecondary = false) {
  if (!file) return;
  const reader = new FileReader();
  const ext = file.name.split('.').pop().toLowerCase();

  reader.onload = (e) => {
    const content = e.target.result;
    let cues = [];
    if (ext === 'ass' || ext === 'ssa') {
      cues = parseAssContent(content);
    } else {
      cues = parseSrtOrVtt(content);
    }
    if (isSecondary) {
      secondaryCues = cues;
      dualSubtitlesEnabled = true;
      localStorage.setItem('storm_dual_subtitles', 'true');
      showToast(`Вторая дорожка субтитров загружена (${cues.length} фраз)`, 'success');
    } else {
      parsedCues = cues;
      showToast(`Субтитры «${file.name}» загружены (${cues.length} фраз)`, 'success');
    }
  };

  reader.readAsText(file, 'utf-8');
}

export async function loadSubtitleFromUrl(url, label = 'Субтитры', isSecondary = false) {
  if (!url) return;
  try {
    const proxyUrl = url.startsWith('/api/') ? url : `/api/player/lift-subtitle.vtt?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const cues = parseSrtOrVtt(text);
    if (isSecondary) {
      secondaryCues = cues;
      dualSubtitlesEnabled = true;
      localStorage.setItem('storm_dual_subtitles', 'true');
      showToast(`Вторая дорожка «${label}» подключена (${cues.length} фраз)`, 'success');
    } else {
      parsedCues = cues;
      showToast(`Субтитры «${label}» подключены (${cues.length} фраз)`, 'success');
    }
  } catch (err) {
    showToast(`Не удалось загрузить субтитры: ${err.message}`, 'warning');
  }
}

function parseSrtOrVtt(text) {
  const cues = [];
  const blocks = text.replace(/\r\n/g, '\n').split('\n\n');

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    let timeLineIdx = lines.findIndex(l => l.includes('-->'));
    if (timeLineIdx === -1) continue;

    const timeParts = lines[timeLineIdx].split('-->');
    const start = parseTimecode(timeParts[0].trim());
    const end = parseTimecode(timeParts[1].trim().split(' ')[0]);
    const cueText = lines.slice(timeLineIdx + 1).join('<br>').replace(/\{.*?\}/g, '');

    if (!isNaN(start) && !isNaN(end)) {
      cues.push({ start, end, text: cueText });
    }
  }
  return cues;
}

function parseAssContent(text) {
  const cues = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  for (const line of lines) {
    if (line.startsWith('Dialogue:')) {
      const parts = line.substring(9).split(',');
      if (parts.length >= 10) {
        const start = parseTimecode(parts[1].trim());
        const end = parseTimecode(parts[2].trim());
        const rawText = parts.slice(9).join(',')
          .replace(/\{.*?\}/g, '')
          .replace(/\\N/gi, '<br>')
          .trim();

        if (!isNaN(start) && !isNaN(end) && rawText) {
          cues.push({ start, end, text: rawText });
        }
      }
    }
  }
  return cues;
}

function parseTimecode(str) {
  const clean = str.replace(',', '.');
  const parts = clean.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

/**
 * Сдвиг синхронизации субтитров (+0.5с / -0.5с)
 */
export function adjustSubtitleOffset(deltaSeconds) {
  subtitleOffsetSec = Math.round((subtitleOffsetSec + deltaSeconds) * 10) / 10;
  const sign = subtitleOffsetSec > 0 ? '+' : '';
  showToast(`Сдвиг субтитров: ${sign}${subtitleOffsetSec} сек.`, 'info');
  return subtitleOffsetSec;
}

export function updateSubtitleStyle(newStyle) {
  subtitleStyle = { ...subtitleStyle, ...newStyle };
  if (newStyle.fontSize) localStorage.setItem('storm_sub_size', String(subtitleStyle.fontSize));
  if (newStyle.color) localStorage.setItem('storm_sub_color', subtitleStyle.color);
  if (newStyle.bgOpacity !== undefined) localStorage.setItem('storm_sub_bg', String(subtitleStyle.bgOpacity));
  applyOverlayStyles();
}

export function renderSubtitlesControls(container) {
  if (!container) return;

  const savedVocab = (() => {
    try { return JSON.parse(localStorage.getItem('storm_saved_vocab') || '[]'); } catch { return []; }
  })();

  container.innerHTML = `
    <div class="subtitles-studio-panel" style="background: var(--bg-tertiary); padding: 14px; border-radius: 12px; border: 1px solid var(--border-color); margin-top: 8px; display: flex; flex-direction: column; gap: 12px;">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
        <span style="font-weight: 800; font-size: 13.5px;">💬 Студия субтитров 2.0 (Двойные субтитры RU + EN и Живой словарь)</span>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <label class="storm-btn storm-btn-primary storm-btn-sm" style="cursor: pointer; margin: 0;">
            📁 Основная дорожка (.srt / .vtt / .ass)
            <input type="file" id="ext-sub-file-input" accept=".srt,.vtt,.ass,.ssa" style="display: none;">
          </label>
          <label class="storm-btn storm-btn-secondary storm-btn-sm" style="cursor: pointer; margin: 0; border-color: rgba(56,189,248,0.45);">
            🌐 Вторая дорожка (Dual EN / Оригинал)
            <input type="file" id="ext-sub-secondary-input" accept=".srt,.vtt,.ass,.ssa" style="display: none;">
          </label>
        </div>
      </div>

      <!-- Тумблеры Dual Subtitles и Live Dictionary -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px; background: rgba(15,23,42,0.55); padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.06);">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;font-weight:700;">
          <input type="checkbox" id="toggle-dual-subs" ${dualSubtitlesEnabled ? 'checked' : ''}>
          <span>🌐 Двойные субтитры (RU + EN)</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;font-weight:700;">
          <input type="checkbox" id="toggle-live-dict" ${liveDictEnabled ? 'checked' : ''}>
          <span>📖 Живой перевод слов по клику</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;font-weight:700;">
          <input type="checkbox" id="toggle-sub-autopause" ${autoPauseOnHover ? 'checked' : ''}>
          <span>⏸️ Авто-пауза при наведении</span>
        </label>
      </div>

      <!-- Сдвиг тайминга и стиль -->
      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: space-between;">
        <div style="display: flex; gap: 6px; align-items: center;">
          <span style="font-size: 12px; color: var(--text-secondary);">Синхронизация:</span>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="sub-delay-minus">-0.5с</button>
          <span id="sub-offset-val" style="font-size: 12px; font-weight: 800; min-width: 48px; text-align: center;">0.0с</span>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="sub-delay-plus">+0.5с</button>
        </div>

        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <span style="font-size: 12px; color: var(--text-secondary);">Размер:</span>
          <input type="range" id="sub-size-slider" min="16" max="38" value="${subtitleStyle.fontSize}" style="width: 90px;">
          <span style="font-size: 12px; color: var(--text-secondary);">Цвет:</span>
          <input type="color" id="sub-color-picker" value="${subtitleStyle.color}" style="width: 28px; height: 26px; border: none; background: none; cursor: pointer;">
        </div>
      </div>

      ${savedVocab.length > 0 ? `
        <div style="border-top: 1px solid var(--border-subtle); padding-top: 10px;">
          <div style="font-size: 11.5px; font-weight: 800; color: var(--accent); margin-bottom: 6px;">⭐ Сохраненные слова из фильмов (${savedVocab.length}):</div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px; max-height: 90px; overflow-y: auto;">
            ${savedVocab.slice(0, 20).map(v => `
              <span style="font-size: 11px; background: rgba(0,210,255,0.1); border: 1px solid rgba(0,210,255,0.25); padding: 3px 8px; border-radius: 6px;">
                <b>${v.word}</b> — ${v.translation}
              </span>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  const fileInput = container.querySelector('#ext-sub-file-input');
  if (fileInput) {
    fileInput.onchange = (e) => {
      if (e.target.files[0]) loadExternalSubtitleFile(e.target.files[0], false);
    };
  }

  const secInput = container.querySelector('#ext-sub-secondary-input');
  if (secInput) {
    secInput.onchange = (e) => {
      if (e.target.files[0]) loadExternalSubtitleFile(e.target.files[0], true);
    };
  }

  const dualToggle = container.querySelector('#toggle-dual-subs');
  if (dualToggle) {
    dualToggle.onchange = (e) => {
      dualSubtitlesEnabled = e.target.checked;
      localStorage.setItem('storm_dual_subtitles', dualSubtitlesEnabled ? 'true' : 'false');
      lastRenderedPrimaryText = '';
      lastRenderedSecondaryText = '';
      showToast(`Двойные субтитры: ${dualSubtitlesEnabled ? 'Включены' : 'Выключены'}`, 'info');
    };
  }

  const dictToggle = container.querySelector('#toggle-live-dict');
  if (dictToggle) {
    dictToggle.onchange = (e) => {
      liveDictEnabled = e.target.checked;
      localStorage.setItem('storm_live_dict', liveDictEnabled ? 'true' : 'false');
      applyOverlayStyles();
      lastRenderedPrimaryText = '';
      showToast(`Живой словарь по клику: ${liveDictEnabled ? 'Включен' : 'Выключен'}`, 'info');
    };
  }

  const pauseToggle = container.querySelector('#toggle-sub-autopause');
  if (pauseToggle) {
    pauseToggle.onchange = (e) => {
      autoPauseOnHover = e.target.checked;
      localStorage.setItem('storm_sub_autopause', autoPauseOnHover ? 'true' : 'false');
    };
  }

  const minusBtn = container.querySelector('#sub-delay-minus');
  const plusBtn = container.querySelector('#sub-delay-plus');
  const offsetVal = container.querySelector('#sub-offset-val');

  if (minusBtn && offsetVal) {
    minusBtn.onclick = () => {
      const val = adjustSubtitleOffset(-0.5);
      offsetVal.textContent = `${val > 0 ? '+' : ''}${val}с`;
    };
  }

  if (plusBtn && offsetVal) {
    plusBtn.onclick = () => {
      const val = adjustSubtitleOffset(0.5);
      offsetVal.textContent = `${val > 0 ? '+' : ''}${val}с`;
    };
  }

  const sizeSlider = container.querySelector('#sub-size-slider');
  if (sizeSlider) {
    sizeSlider.oninput = (e) => {
      updateSubtitleStyle({ fontSize: parseInt(e.target.value, 10) });
    };
  }

  const colorPicker = container.querySelector('#sub-color-picker');
  if (colorPicker) {
    colorPicker.oninput = (e) => {
      updateSubtitleStyle({ color: e.target.value });
    };
  }
}

export function getActiveSubtitleText() {
  try {
    if (currentVideo && Array.isArray(parsedCues) && parsedCues.length > 0) {
      const t = (currentVideo.currentTime || 0) - subtitleOffsetSec;
      const cue = parsedCues.find(c => t >= c.start && t <= c.end);
      if (cue && cue.text) return String(cue.text).replace(/<[^>]+>/g, '').trim();
    }
    if (currentVideo && currentVideo.textTracks) {
      for (let i = 0; i < currentVideo.textTracks.length; i++) {
        const tr = currentVideo.textTracks[i];
        if (tr.mode === 'showing' && tr.activeCues && tr.activeCues.length > 0) {
          const txt = Array.from(tr.activeCues).map(c => c.text || '').join(' ').replace(/<[^>]+>/g, '').trim();
          if (txt) return txt;
        }
      }
    }
    if (typeof lastRenderedPrimaryText === 'string' && lastRenderedPrimaryText.trim()) {
      return lastRenderedPrimaryText.replace(/<[^>]+>/g, '').trim();
    }
  } catch (_) {}
  return '';
}
