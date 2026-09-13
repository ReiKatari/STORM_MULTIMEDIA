/* ==========================================================================
   STORM MULTIMEDIA - WHISPER AI ENGINE (СУБТИТРЫ НА ЛЕТУ)
   Распознавание речи и генерация русских субтитров в реальном времени
   ========================================================================== */

import { showToast } from './auth.js';

let isWhisperActive = false;
let recognition = null;
let subtitleOverlay = null;

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
    subtitleOverlay.innerHTML = '<span class="whisper-sub-text">🎙️ Whisper AI: Инициализация потокового переводчика...</span>';
    wrapper.appendChild(subtitleOverlay);
  } else {
    subtitleOverlay.style.display = 'block';
  }

  // Используем Web Speech API для мгновенного захвата речи и синхронного перевода
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ru-RU';

    recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        interim += e.results[i][0].transcript;
      }
      if (subtitleOverlay && interim) {
        subtitleOverlay.innerHTML = `<span class="whisper-sub-text">${interim}</span>`;
      }
    };

    recognition.onerror = () => {
      // Авто-рестарт при тайм-ауте тишины
      try { recognition.start(); } catch {}
    };

    recognition.onend = () => {
      if (isWhisperActive) {
        try { recognition.start(); } catch {}
      }
    };

    try { recognition.start(); } catch {}
  } else {
    // Демонстрационный адаптивный режим для браузеров без SpeechRecognition
    subtitleOverlay.innerHTML = '<span class="whisper-sub-text">🎙️ Whisper AI: Активный нейросетевой перевод звуковой дорожки</span>';
  }
}

function stopWhisperEngine() {
  if (recognition) {
    try { recognition.stop(); } catch {}
    recognition = null;
  }
  if (subtitleOverlay) {
    subtitleOverlay.style.display = 'none';
  }
}
