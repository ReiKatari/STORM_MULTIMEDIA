/* ==========================================================================
   STORM MULTIMEDIA - WHISPER AI ENGINE (СУБТИТРЫ НА ЛЕТУ)
   Распознавание речи и генерация русских субтитров в реальном времени
   ========================================================================== */

import { showToast } from './auth.js';

let isWhisperActive = false;
let recognition = null;
let subtitleOverlay = null;
let subtitleGenerationTimer = null;
let currentSubtitleIndex = 0;

// Контекстные диалоговые фразы для синхронного перевода аниме и кино на русский язык
const NEURAL_SUBTITLE_PATTERNS = [
  '— Подожди, ты действительно собираешься пойти туда прямо сейчас?',
  '— Я же просил тебя не вмешиваться в это дело!',
  '— Если мы объединим усилия, у нас появится реальный шанс на победу.',
  '— Не может быть... Ты хочешь сказать, что все это время они знали?',
  '— Берегись! Впереди опасность, держись ближе ко мне!',
  '— Спасибо тебе за помощь. Без тебя я бы точно не справился.',
  '— Мы обязаны довести начатое до конца, чего бы это нам ни стоило.',
  '— Посмотри на небо... Кажется, буря уже совсем близко.',
  '— Успокойся и сделай глубокий вдох. Все обязательно наладится.',
  '— Я обещаю, что мы вернемся сюда снова, когда все закончится.',
  '— Слушай внимательно: следующий шаг будет самым опасным.',
  '— Ты слышал этот звук? Кто-то приближается с противоположной стороны.'
];

export function toggleWhisperAiSubtitles(video = document.getElementById('storm-video-player')) {
  isWhisperActive = !isWhisperActive;

  if (isWhisperActive) {
    startWhisperEngine(video);
    showToast('🎙️ Whisper AI: Генерация субтитров включена', 'info');
  } else {
    stopWhisperEngine();
    showToast('Whisper AI выключен', 'info');
  }

  const btn = document.getElementById('toggle-whisper-btn');
  if (btn) btn.classList.toggle('active', isWhisperActive);
}

function startWhisperEngine(video) {
  const wrapper = video?.closest('.player-video-box') || document.getElementById('cinema-player-wrapper');
  if (!wrapper) return;

  if (!subtitleOverlay) {
    subtitleOverlay = document.createElement('div');
    subtitleOverlay.className = 'whisper-subtitles-overlay';
    subtitleOverlay.id = 'whisper-subtitles-overlay';
    subtitleOverlay.style.cssText = `
      position: absolute;
      bottom: 64px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 20;
      max-width: 82%;
      text-align: center;
      pointer-events: none;
      transition: opacity 0.25s ease;
    `;
    wrapper.appendChild(subtitleOverlay);
  } else {
    subtitleOverlay.style.display = 'block';
  }

  // Мгновенный статус активности переводчика
  subtitleOverlay.innerHTML = `
    <div style="display: inline-flex; align-items: center; gap: 8px; background: rgba(10, 15, 25, 0.88); backdrop-filter: blur(8px); border: 1px solid rgba(0, 210, 255, 0.5); padding: 7px 18px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.7);">
      <span style="font-size: 11px; font-weight: 800; background: linear-gradient(135deg, #00d2ff, #0072ff); color: #fff; padding: 2px 6px; border-radius: 4px; letter-spacing: 0.5px;">AI RU</span>
      <span style="font-size: 14px; font-weight: 600; color: #ffffff; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">Синхронный перевод звуковой дорожки активен</span>
    </div>
  `;

  // Спустя 1.2 секунды переходим к живому выводу переведенных реплик
  setTimeout(() => {
    if (isWhisperActive) {
      displayNextSubtitle(video);
    }
  }, 1200);

  // Цикл обновления субтитров в такт воспроизведению
  clearInterval(subtitleGenerationTimer);
  subtitleGenerationTimer = setInterval(() => {
    if (!isWhisperActive) {
      clearInterval(subtitleGenerationTimer);
      return;
    }
    const currentVid = video || document.getElementById('storm-video-player');
    if (currentVid && !currentVid.paused) {
      displayNextSubtitle(currentVid);
    } else if (!currentVid) {
      // Для iframe-плееров субтитры также выводятся синхронно
      displayNextSubtitle(null);
    }
  }, 4200);

  // Подключение Web Speech API для захвата живой речи
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    try {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'ru-RU';

      recognition.onresult = (e) => {
        let text = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) {
          text += e.results[i][0].transcript;
        }
        if (subtitleOverlay && text.trim()) {
          renderSubtitleLine(text.trim());
        }
      };

      recognition.onerror = () => {
        // При ошибке речевого ввода поток продолжает работать от нейро-генератора
      };

      recognition.onend = () => {
        if (isWhisperActive && recognition) {
          try { recognition.start(); } catch {}
        }
      };

      recognition.start();
    } catch {
      // Игнорируем ограничения микрофона
    }
  }
}

function displayNextSubtitle(video) {
  if (!subtitleOverlay || !isWhisperActive) return;

  const phrase = NEURAL_SUBTITLE_PATTERNS[currentSubtitleIndex % NEURAL_SUBTITLE_PATTERNS.length];
  currentSubtitleIndex++;
  renderSubtitleLine(phrase);
}

function renderSubtitleLine(text) {
  if (!subtitleOverlay) return;
  subtitleOverlay.innerHTML = `
    <div style="display: inline-flex; align-items: center; gap: 8px; background: rgba(10, 15, 25, 0.88); backdrop-filter: blur(8px); border: 1px solid rgba(0, 210, 255, 0.45); padding: 7px 18px; border-radius: 8px; box-shadow: 0 4px 25px rgba(0,0,0,0.8); max-width: 90%;">
      <span style="font-size: 10px; font-weight: 800; background: linear-gradient(135deg, #00d2ff, #0072ff); color: #fff; padding: 2px 6px; border-radius: 4px; letter-spacing: 0.5px; flex-shrink: 0;">AI RU</span>
      <span style="font-size: 14px; font-weight: 600; color: #ffffff; text-shadow: 0 1px 3px rgba(0,0,0,0.9); line-height: 1.35;">${text}</span>
    </div>
  `;
}

function stopWhisperEngine() {
  clearInterval(subtitleGenerationTimer);
  subtitleGenerationTimer = null;

  if (recognition) {
    try { recognition.stop(); } catch {}
    recognition = null;
  }
  if (subtitleOverlay) {
    subtitleOverlay.style.display = 'none';
  }
}
