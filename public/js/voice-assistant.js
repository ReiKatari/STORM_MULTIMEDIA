/* ==========================================================================
   STORM MULTIMEDIA - ИДЕАЛЬНЫЙ ГОЛОСОВОЙ ПОИСК И КИБЕР-АССИСТЕНТ 2.0
   Мгновенное потоковое распознавание речи (interimResults) и умный поиск
   ========================================================================== */

import { showToast } from './auth.js?v=1.2.7';
import { trackClientAction } from './achievements.js?v=1.2.7';

let recognition = null;
let isListening = false;
let onSearchCallback = null;
let onTabSwitchCallback = null;
let onThemeSwitchCallback = null;
let onRandomMediaCallback = null;
let interimSearchTimer = null;
let lastDispatchedQuery = '';

function ensureVoiceLiveHud() {
  let hud = document.getElementById('storm-voice-live-hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'storm-voice-live-hud';
    hud.style.cssText = 'position:fixed;top:78px;left:50%;transform:translateX(-50%);z-index:10090;background:rgba(15,23,42,0.95);border:1px solid rgba(0,210,255,0.55);border-radius:999px;padding:10px 22px;color:#f8fafc;font-size:14px;font-weight:700;box-shadow:0 16px 40px rgba(0,0,0,0.65);backdrop-filter:blur(16px);display:none;align-items:center;gap:10px;pointer-events:none;transition:opacity 0.2s ease;';
    hud.innerHTML = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;box-shadow:0 0 12px #ef4444;animation:storm-spin 1s infinite alternate;"></span><span id="storm-voice-live-text">🎙️ Говорите название фильма, сериала или аниме...</span>`;
    document.body.appendChild(hud);
  }
  return hud;
}

function setVoiceHudText(text, visible = true) {
  const hud = ensureVoiceLiveHud();
  const txtEl = hud.querySelector('#storm-voice-live-text');
  if (txtEl && text) txtEl.textContent = text;
  hud.style.display = visible ? 'inline-flex' : 'none';
}

export function cleanVoiceTranscript(raw) {
  let s = String(raw || '')
    .replace(/[.,!?;:"«»'()\[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Убираем вводные голосовые слова поискового запроса («найди фильм Дюна» -> «Дюна»)
  s = s.replace(/^(?:пожалуйста\s+)?(?:ассистент\s+|шторм\s+|storm\s+)?(?:найди|найти|ищи|искать|поиск|включи|включить|покажи|показать|открой|открыть|смотреть|хочу посмотреть)\s+/i, '');
  s = s.replace(/^(?:мне\s+|нам\s+)?(?:фильм|сериал|мультфильм|мультик|мультсериал|аниме\s+сериал|аниме\s+фильм|аниме)\s+(.+)$/i, '$1');
  return s.trim();
}

export function initVoiceAssistant({ onSearch, onTabSwitch, onThemeSwitch, onRandomMedia }) {
  onSearchCallback = onSearch;
  onTabSwitchCallback = onTabSwitch;
  onThemeSwitchCallback = onThemeSwitch;
  onRandomMediaCallback = onRandomMedia;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Web Speech API не поддерживается данным браузером');
    return false;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'ru-RU';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;

  recognition.onstart = () => {
    isListening = true;
    lastDispatchedQuery = '';
    updateMicButtonState(true);
    setVoiceHudText('🎙️ Слушаю... Назовите фильм, сериал или аниме', true);
  };

  recognition.onresult = (event) => {
    let interimText = '';
    let finalText = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const transcript = res[0]?.transcript || '';
      if (res.isFinal) {
        finalText += transcript;
      } else {
        interimText += transcript;
      }
    }

    const activeRaw = (finalText || interimText).trim();
    if (!activeRaw) return;

    const previewClean = cleanVoiceTranscript(activeRaw);
    const searchInput = document.getElementById('global-search-input');
    if (searchInput && previewClean) {
      searchInput.value = previewClean;
    }
    setVoiceHudText(`🎙️ «${previewClean || activeRaw}»`, true);

    if (finalText) {
      if (interimSearchTimer) {
        clearTimeout(interimSearchTimer);
        interimSearchTimer = null;
      }
      setTimeout(() => setVoiceHudText('', false), 900);
      processVoiceCommand(finalText);
    } else if (previewClean.length >= 2 && onSearchCallback) {
      if (interimSearchTimer) clearTimeout(interimSearchTimer);
      interimSearchTimer = setTimeout(() => {
        if (previewClean !== lastDispatchedQuery && !isStrictNavigationCommand(activeRaw)) {
          lastDispatchedQuery = previewClean;
          onSearchCallback(previewClean);
        }
      }, 220);
    }
  };

  recognition.onerror = (event) => {
    isListening = false;
    updateMicButtonState(false);
    setVoiceHudText('', false);
    if (event.error === 'not-allowed') {
      showToast('Доступ к микрофону заблокирован в настройках браузера', 'error');
    } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
      showToast('Не удалось распознать речь, попробуйте ещё раз', 'info');
    }
  };

  recognition.onend = () => {
    isListening = false;
    updateMicButtonState(false);
    setTimeout(() => setVoiceHudText('', false), 800);
  };

  return true;
}

export function toggleVoiceListening() {
  if (!recognition) {
    showToast('Голосовой ввод не поддерживается этим браузером. Используйте поле поиска.', 'info');
    document.getElementById('global-search-input')?.focus();
    return;
  }

  if (isListening) {
    try { recognition.stop(); } catch (_) {}
  } else {
    try {
      recognition.start();
      trackClientAction('use_voice');
    } catch (err) {
      try {
        recognition.abort();
        setTimeout(() => recognition.start(), 120);
      } catch (_) {}
    }
  }
}

export function speakResponse(text) {
  if (!window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU';
    utterance.rate = 1.1;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch (_) {}
}

function isStrictNavigationCommand(rawText) {
  const norm = String(rawText || '').toLowerCase().replace(/[.,!?;:"«»]+/g, '').trim();
  return /^(?:открой\s+|перейди\s+в\s+|включи\s+|раздел\s+|вкладка\s+)?(новинки|фильмы|сериалы|мультфильмы|мультики|мультсериалы|аниме|аниме\s+фильмы|аниме\s+сериалы|закладки|мои\s+списки|продолжить\s+просмотр|главная|домой|тв\s+режим|режим\s+тв|обычный\s+режим|случайный\s+фильм|рандом)$/i.test(norm);
}

function processVoiceCommand(rawText) {
  const norm = String(rawText || '')
    .toLowerCase()
    .replace(/[.,!?;:"«»'()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!norm) return;

  // 1. Управление ТВ-режимом голосом
  if (/^(?:включи\s+|открой\s+)?(?:тв\s*режим|режим\s*тв|smart\s*tv)$/i.test(norm)) {
    if (typeof window.toggleTvMode === 'function') window.toggleTvMode(true);
    return;
  }
  if (/^(?:выключи\s+|закрой\s+)(?:тв\s*режим|режим\s*тв)|обычный\s+режим$/i.test(norm)) {
    if (typeof window.toggleTvMode === 'function') window.toggleTvMode(false);
    return;
  }

  // 2. Строгие команды переключения вкладок (ТОЛЬКО если фраза является командой перехода в раздел, а не названием фильма!)
  const navMatch = norm.match(/^(?:открой\s+|перейди\s+в\s+|покажи\s+раздел\s+|вкладка\s+|раздел\s+|каталог\s+)?(новинки|фильмы|сериалы|мультфильмы|мультики|мультсериалы|аниме\s+фильмы|аниме\s+сериалы|аниме|закладки|мои\s+списки|продолжить\s+просмотр|главная|домой)$/i);
  if (navMatch) {
    const target = navMatch[1].toLowerCase();
    const input = document.getElementById('global-search-input');
    if (input) input.value = '';
    if (target === 'новинки') return onTabSwitchCallback?.('new');
    if (target === 'фильмы') return onTabSwitchCallback?.('movies');
    if (target === 'сериалы') return onTabSwitchCallback?.('series');
    if (target === 'мультсериалы') return onTabSwitchCallback?.('cartoon-series');
    if (target === 'мультфильмы' || target === 'мультики') return onTabSwitchCallback?.('cartoons');
    if (target === 'аниме фильмы') return onTabSwitchCallback?.('anime-movies');
    if (target === 'аниме' || target === 'аниме сериалы') return onTabSwitchCallback?.('anime-series');
    if (target === 'закладки' || target === 'мои списки') return onTabSwitchCallback?.('bookmarks');
    if (target === 'продолжить просмотр') return onTabSwitchCallback?.('continue');
    if (target === 'главная' || target === 'домой') return onTabSwitchCallback?.('home');
  }

  // 3. Строгие команды смены темы (ТОЛЬКО если явно произнесено слово «тема» или «тему»)
  if (/\bтем[ауы]\b/i.test(norm)) {
    if (norm.includes('киберпанк')) return onThemeSwitchCallback?.('STORM CYBERPUNK');
    if (norm.includes('матриц')) return onThemeSwitchCallback?.('STORM MATRIX');
    if (norm.includes('вархаммер') || norm.includes('готик')) return onThemeSwitchCallback?.('STORM WARHAMMER 40K');
    if (norm.includes('ночн') || norm.includes('олед') || norm.includes('черн')) return onThemeSwitchCallback?.('STORM NIGHT');
    if (norm.includes('светл') || norm.includes('день')) return onThemeSwitchCallback?.('STORM DAY');
    if (norm.includes('аметист') || norm.includes('фиолетов')) return onThemeSwitchCallback?.('STORM MIDNIGHT');
    if (norm.includes('золот') || norm.includes('фэнтези')) return onThemeSwitchCallback?.('STORM FANTASY');
    if (norm.includes('темн') || norm.includes('стандартн')) return onThemeSwitchCallback?.('STORM DARK');
  }

  // 4. Случайный фильм
  if (/^(?:включи\s+|выбери\s+)?(?:случайный\s+фильм|случайное\s+видео|случайный\s+релиз|рандом)$/i.test(norm)) {
    if (onRandomMediaCallback) onRandomMediaCallback();
    return;
  }

  // 5. Идеальный быстрый поиск фильма / сериала / аниме / мультфильма
  const cleanQuery = cleanVoiceTranscript(rawText);
  if (cleanQuery) {
    showToast(`🔍 Голосовой поиск: «${cleanQuery}»`, 'success');
    if (onSearchCallback && cleanQuery !== lastDispatchedQuery) {
      lastDispatchedQuery = cleanQuery;
      onSearchCallback(cleanQuery);
    }
  }
}

function updateMicButtonState(active) {
  const btn = document.getElementById('voice-search-btn');
  if (btn) {
    btn.classList.toggle('is-listening', active);
    btn.title = active ? 'Голосовой поиск слушает... Нажмите для остановки' : 'Голосовой поиск фильмов, сериалов и аниме';
  }
}
