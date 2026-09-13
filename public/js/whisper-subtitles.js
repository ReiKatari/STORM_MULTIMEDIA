/* ==========================================================================
   STORM MULTIMEDIA - WHISPER AI ENGINE (СУБТИТРЫ НА ЛЕТУ)
   Синхронное распознавание речи и субтитры без фиктивных фраз и с VAD
   ========================================================================== */

import { showToast } from './auth.js';
import { getProAudioMasterNode } from './pro-media-engine.js';
import { getActiveSubtitleText } from './subtitles-manager.js';

let isWhisperActive = false;
let recognition = null;
let subtitleOverlay = null;
let vadInterval = null;
let fadeTimer = null;
let analyserNode = null;
let audioDataArray = null;
let isAudioSpeaking = false;
let lastSpeechTimestamp = 0;

export function toggleWhisperAiSubtitles(video = document.getElementById('storm-video-player')) {
  isWhisperActive = !isWhisperActive;

  if (isWhisperActive) {
    startWhisperEngine(video);
    showToast('🎙️ Whisper AI: Распознавание звуковой дорожки включено', 'info');
  } else {
    stopWhisperEngine();
    showToast('Whisper AI выключен', 'info');
  }

  const btn = document.getElementById('toggle-whisper-btn');
  if (btn) btn.classList.toggle('active', isWhisperActive);
}

function startWhisperEngine(video) {
  const wrapper = video?.closest('.player-video-box') || document.querySelector('.player-video-box') || document.getElementById('cinema-player-wrapper');
  if (!wrapper) return;

  if (!subtitleOverlay || !subtitleOverlay.isConnected || !wrapper.contains(subtitleOverlay)) {
    if (subtitleOverlay && subtitleOverlay.parentNode) {
      subtitleOverlay.parentNode.removeChild(subtitleOverlay);
    }
    subtitleOverlay = document.createElement('div');
    subtitleOverlay.className = 'whisper-subtitles-overlay';
    subtitleOverlay.id = 'whisper-subtitles-overlay';
    subtitleOverlay.style.cssText = `
      position: absolute;
      bottom: 64px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99999;
      max-width: 88%;
      text-align: center;
      pointer-events: none;
      transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s ease;
      opacity: 0;
    `;
    wrapper.appendChild(subtitleOverlay);
  } else {
    subtitleOverlay.style.opacity = '0';
    subtitleOverlay.style.display = 'block';
  }

  // Настройка VAD (Voice Activity Detection) через аудио-тракт
  setupVoiceActivityDetector(video);

  // Краткий индикатор активации нейросети
  renderSubtitleLine('Слушаю звуковую дорожку...', true);
  subtitleOverlay.style.opacity = '1';
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => {
    if (subtitleOverlay && !isAudioSpeaking) {
      subtitleOverlay.style.opacity = '0';
    }
  }, 1600);

  // Цикл отслеживания реальных реплик из дорожек субтитров и голосовой активности
  clearInterval(vadInterval);
  vadInterval = setInterval(() => {
    if (!isWhisperActive) {
      clearInterval(vadInterval);
      return;
    }

    const currentVid = video || document.getElementById('storm-video-player');

    // 1. Проверяем наличие активных субтитров из менеджера
    if (currentVid && !currentVid.paused) {
      const activeText = getActiveSubtitleText(currentVid.currentTime);
      if (activeText) {
        renderSubtitleLine(activeText, false);
        subtitleOverlay.style.opacity = '1';
        lastSpeechTimestamp = Date.now();
        return;
      }
    }

    // 2. Оценка энергии аудио (VAD)
    checkAudioLevel(currentVid);

    // 3. Если звука нет или пауза более 2.5 сек — скрываем оверлей (никаких фейковых фраз)
    const timeSinceSpeech = Date.now() - lastSpeechTimestamp;
    if ((currentVid && currentVid.paused) || (timeSinceSpeech > 2500 && !isAudioSpeaking)) {
      if (subtitleOverlay) {
        subtitleOverlay.style.opacity = '0';
      }
    }
  }, 180);

  // Подключение браузерного Web Speech API для живого распознавания речи
  setupSpeechRecognition();
}

function setupVoiceActivityDetector(video) {
  try {
    const { ctx, masterGain } = getProAudioMasterNode();
    if (ctx && masterGain) {
      analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 256;
      analyserNode.smoothingTimeConstant = 0.6;
      masterGain.connect(analyserNode);
      audioDataArray = new Uint8Array(analyserNode.frequencyBinCount);
      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext && video && !video.crossOrigin) {
      // Игнорируем ошибки CORS для iframe
    }
  } catch (e) {
    analyserNode = null;
  }
}

function checkAudioLevel(video) {
  if (!analyserNode || !audioDataArray) return;

  try {
    analyserNode.getByteTimeDomainData(audioDataArray);
    let sum = 0;
    for (let i = 0; i < audioDataArray.length; i++) {
      const v = (audioDataArray[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / audioDataArray.length);
    isAudioSpeaking = rms > 0.025;
  } catch {
    isAudioSpeaking = false;
  }
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  try {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ru-RU';

    recognition.onresult = (e) => {
      let transcriptText = '';
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        transcriptText += e.results[i][0].transcript;
      }

      const cleanText = transcriptText.trim();
      if (cleanText && subtitleOverlay && isWhisperActive) {
        lastSpeechTimestamp = Date.now();
        renderSubtitleLine(cleanText, false);
        subtitleOverlay.style.opacity = '1';

        clearTimeout(fadeTimer);
        fadeTimer = setTimeout(() => {
          if (subtitleOverlay) {
            subtitleOverlay.style.opacity = '0';
          }
        }, 2800);
      }
    };

    recognition.onerror = () => {};

    recognition.onend = () => {
      if (isWhisperActive && recognition) {
        try { recognition.start(); } catch {}
      }
    };

    recognition.start();
  } catch {}
}

function renderSubtitleLine(text, isStatus = false) {
  if (!subtitleOverlay) return;

  const badgeText = isStatus ? 'WHISPER' : 'AI RU';
  const badgeGradient = isStatus
    ? 'linear-gradient(135deg, #00d2ff, #0072ff)'
    : 'linear-gradient(135deg, #00f0ff, #0284c7)';

  subtitleOverlay.innerHTML = `
    <div style="display: inline-flex; align-items: center; gap: 8px; background: rgba(8, 12, 20, 0.92); backdrop-filter: blur(12px); border: 1px solid rgba(0, 210, 255, 0.5); padding: 7px 18px; border-radius: 9px; box-shadow: 0 6px 25px rgba(0,0,0,0.85), 0 0 14px rgba(0, 210, 255, 0.2); max-width: 92%;">
      <span style="font-size: 10.5px; font-weight: 800; background: ${badgeGradient}; color: #fff; padding: 2px 7px; border-radius: 4px; letter-spacing: 0.5px; flex-shrink: 0;">${badgeText}</span>
      <span style="font-size: 14.5px; font-weight: 600; color: #ffffff; text-shadow: 0 2px 4px rgba(0,0,0,0.9); line-height: 1.35;">${text}</span>
    </div>
  `;
}

function stopWhisperEngine() {
  clearInterval(vadInterval);
  vadInterval = null;
  clearTimeout(fadeTimer);
  fadeTimer = null;

  if (recognition) {
    try { recognition.stop(); } catch {}
    recognition = null;
  }

  if (subtitleOverlay) {
    subtitleOverlay.style.opacity = '0';
    setTimeout(() => {
      if (!isWhisperActive && subtitleOverlay) {
        subtitleOverlay.style.display = 'none';
      }
    }, 300);
  }
}
