/* ==========================================================================
   STORM MULTIMEDIA - ГОЛОСОВАЯ СТУДИЯ И КИБЕР-АССИСТЕНТ 3.0
   Выбор микрофона (Browser WebAudio + Windows Native WinMM), живой эквалайзер
   уровня сигнала (VU-Meter), потоковое и серверное распознавание речи 16 кГц
   ========================================================================== */

import { showToast } from './auth.js?v=1.3.1';
import { trackClientAction } from './achievements.js?v=1.3.1';

let recognition = null;
let isListening = false;
let onSearchCallback = null;
let onTabSwitchCallback = null;
let onThemeSwitchCallback = null;
let onRandomMediaCallback = null;
let interimSearchTimer = null;
let lastDispatchedQuery = '';

// Состояние WebAudio записи и выбора микрофона
let availableMics = [];
let selectedMicId = localStorage.getItem('storm_selected_mic_id') || '';
let activeMediaStream = null;
let activeAudioCtx = null;
let activeAnalyser = null;
let activeProcessor = null;
let vuAnimFrame = null;
let recordedPcmChunks = [];
let recordingSampleRate = 16000;
let speechDetectedInSession = false;
let silenceDurationSec = 0;
let sessionStartTime = 0;
let webSpeechGotResult = false;
let nativeListenAbort = null;
let finalizeInProgress = false;

const LOCAL_BRIDGE_ORIGINS = (() => {
  const list = [''];
  const host = window.location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    list.push('http://localhost:3900');
    list.push('http://127.0.0.1:3900');
  }
  return list;
})();

function ensureVoiceLiveHud() {
  let hud = document.getElementById('storm-voice-live-hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'storm-voice-live-hud';
    hud.style.cssText = [
      'position:fixed',
      'top:74px',
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:10095',
      'width:min(540px, calc(100vw - 24px))',
      'background:linear-gradient(145deg, rgba(13, 18, 34, 0.97), rgba(8, 11, 22, 0.98))',
      'border:1px solid rgba(0, 210, 255, 0.5)',
      'border-radius:18px',
      'padding:14px 18px',
      'color:#f8fafc',
      'box-shadow:0 22px 55px rgba(0,0,0,0.78), 0 0 28px rgba(0,210,255,0.18)',
      'backdrop-filter:blur(20px)',
      'display:none',
      'flex-direction:column',
      'gap:12px',
      'pointer-events:auto',
      'transition:all 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
    ].join(';');

    const barsHtml = Array.from({ length: 14 }, (_, i) =>
      `<span class="storm-vu-bar" data-idx="${i}" style="width:4px;height:6px;border-radius:99px;background:var(--accent,#00d2ff);transition:height 0.06s ease,background 0.1s ease;opacity:0.85;"></span>`
    ).join('');

    hud.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
          <span id="storm-voice-pulse-dot" style="display:inline-block;width:11px;height:11px;border-radius:50%;background:#ef4444;box-shadow:0 0 12px #ef4444;flex-shrink:0;"></span>
          <span id="storm-voice-live-text" style="font-size:13.5px;font-weight:700;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Говорите название фильма, сериала или аниме...</span>
        </div>
        <div id="storm-voice-vu-bars" style="display:flex;align-items:center;gap:3px;height:24px;padding:0 6px;">
          ${barsHtml}
        </div>
        <button type="button" id="storm-voice-hud-close" title="Закрыть голосовой ввод" style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);color:#94a3b8;width:28px;height:28px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:13px;">✕</button>
      </div>

      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">
        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:200px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent,#00d2ff)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="22"></line>
          </svg>
          <select id="storm-voice-mic-select" title="Выберите микрофон для голосового поиска" style="flex:1;background:rgba(15,23,42,0.9);color:#e2e8f0;border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;outline:none;cursor:pointer;min-width:0;">
            <option value="">Микрофон по умолчанию</option>
          </select>
          <button type="button" id="storm-voice-refresh-mics" title="Обновить список микрофонов" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);color:#cbd5e1;border-radius:8px;padding:5px 8px;font-size:11.5px;cursor:pointer;">↻</button>
        </div>
        <button type="button" id="storm-voice-finish-btn" class="storm-btn storm-btn-primary storm-btn-sm" style="padding:6px 14px;font-size:12px;font-weight:700;border-radius:8px;">
          Распознать
        </button>
      </div>
    `;
    document.body.appendChild(hud);

    const closeBtn = hud.querySelector('#storm-voice-hud-close');
    if (closeBtn) {
      closeBtn.onclick = () => stopAllVoiceListening(true);
    }

    const finishBtn = hud.querySelector('#storm-voice-finish-btn');
    if (finishBtn) {
      finishBtn.onclick = () => finalizeVoiceCaptureAndRecognize();
    }

    const refreshBtn = hud.querySelector('#storm-voice-refresh-mics');
    if (refreshBtn) {
      refreshBtn.onclick = async () => {
        await enumerateAllAvailableMicrophones(true);
        showToast('Список доступных микрофонов обновлён', 'info');
      };
    }

    const micSelect = hud.querySelector('#storm-voice-mic-select');
    if (micSelect) {
      micSelect.onchange = async () => {
        selectedMicId = micSelect.value || '';
        localStorage.setItem('storm_selected_mic_id', selectedMicId);
        const pickedLabel = micSelect.options[micSelect.selectedIndex]?.text || 'Микрофон по умолчанию';
        showToast(`Выбран микрофон: ${pickedLabel}`, 'info');
        if (isListening) {
          await restartListeningWithSelectedMic();
        }
      };
    }
  }
  return hud;
}

function setVoiceHudText(text, visible = true, isProcessing = false) {
  const hud = ensureVoiceLiveHud();
  const txtEl = hud.querySelector('#storm-voice-live-text');
  const dotEl = hud.querySelector('#storm-voice-pulse-dot');
  if (txtEl && text) txtEl.textContent = text;
  if (dotEl) {
    dotEl.style.background = isProcessing ? '#00d2ff' : '#ef4444';
    dotEl.style.boxShadow = isProcessing ? '0 0 12px #00d2ff' : '0 0 12px #ef4444';
  }
  hud.style.display = visible ? 'flex' : 'none';
}

function updateVuBars(rmsNorm = 0) {
  const hud = document.getElementById('storm-voice-live-hud');
  if (!hud || hud.style.display === 'none') return;
  const bars = hud.querySelectorAll('.storm-vu-bar');
  const total = bars.length;
  bars.forEach((bar, i) => {
    const centerDist = Math.abs(i - (total - 1) / 2) / (total / 2);
    const wave = Math.max(0.15, (1 - centerDist * 0.65) * rmsNorm * (0.75 + Math.random() * 0.5));
    const h = Math.round(4 + Math.min(1, wave) * 18);
    bar.style.height = `${h}px`;
    bar.style.background = rmsNorm > 0.25 ? '#00ff66' : 'var(--accent,#00d2ff)';
  });
}

export async function enumerateAllAvailableMicrophones(requestPermission = false) {
  const hud = ensureVoiceLiveHud();
  const selectEl = hud.querySelector('#storm-voice-mic-select');
  const devicesOut = [];
  const seenLabels = new Set();

  // 1. Браузерные аудиоустройства (WebAudio / MediaDevices)
  if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
    try {
      if (requestPermission && typeof navigator.mediaDevices.getUserMedia === 'function') {
        const tmpStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        if (tmpStream) tmpStream.getTracks().forEach(t => t.stop());
      }
      const list = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = list.filter(d => d.kind === 'audioinput');
      audioInputs.forEach((d, idx) => {
        const lbl = (d.label || `Микрофон браузера #${idx + 1}`).trim();
        const key = lbl.toLowerCase().slice(0, 26);
        seenLabels.add(key);
        devicesOut.push({
          id: `web:${d.deviceId}`,
          rawDeviceId: d.deviceId,
          label: lbl,
          type: 'web'
        });
      });
    } catch (_) {}
  }

  // 2. Аппаратные микрофоны Windows ПК (через локальный мост или текущий сервер)
  for (const base of LOCAL_BRIDGE_ORIGINS) {
    try {
      const res = await fetch(`${base}/api/voice/devices`, { signal: AbortSignal.timeout(2200) });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.devices) && data.devices.length > 0) {
          for (const nd of data.devices) {
            const lbl = String(nd.label || `Микрофон ПК #${nd.index + 1}`).trim();
            const key = lbl.toLowerCase().slice(0, 26);
            // Если браузер не вернул имена (например на HTTP LAN IP) или это устройство ещё не в списке
            if (devicesOut.length === 0 || !seenLabels.has(key)) {
              seenLabels.add(key);
              devicesOut.push({
                id: `${base ? base + '|' : ''}${nd.id}`,
                rawDeviceId: nd.id,
                bridgeBase: base,
                label: `${lbl}`,
                type: 'native'
              });
            }
          }
          break;
        }
      }
    } catch (_) {}
  }

  availableMics = devicesOut;

  if (selectEl) {
    const prevVal = selectedMicId || localStorage.getItem('storm_selected_mic_id') || '';
    selectEl.innerHTML = `<option value="">Автоматический выбор микрофона</option>` +
      devicesOut.map(d => `<option value="${d.id}">${d.label}</option>`).join('');
    if (prevVal && devicesOut.some(d => d.id === prevVal)) {
      selectEl.value = prevVal;
      selectedMicId = prevVal;
    } else if (devicesOut.length > 0 && !prevVal) {
      selectEl.value = devicesOut[0].id;
      selectedMicId = devicesOut[0].id;
    }
  }

  return devicesOut;
}

export function cleanVoiceTranscript(raw) {
  let s = String(raw || '')
    .replace(/[.,!?;:"«»'()\[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^(?:пожалуйста\s+)?(?:ассистент\s+|шторм\s+|storm\s+)?(?:найди|найти|ищи|искать|поиск|включи|включить|покажи|показать|открой|открыть|смотреть|хочу посмотреть)\s+/i, '');
  s = s.replace(/^(?:мне\s+|нам\s+)?(?:фильм|сериал|мультфильм|мультик|мультсериал|аниме\s+сериал|аниме\s+фильм|аниме)\s+(.+)$/i, '$1');
  return s.trim();
}

function downsampleFloat32ToInt16(float32Arr, inSampleRate, outSampleRate = 16000) {
  if (!float32Arr || float32Arr.length === 0) return new Int16Array(0);
  if (inSampleRate === outSampleRate) {
    const out = new Int16Array(float32Arr.length);
    for (let i = 0; i < float32Arr.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Arr[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  }
  const ratio = inSampleRate / outSampleRate;
  const newLength = Math.round(float32Arr.length / ratio);
  const result = new Int16Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < float32Arr.length; i++) {
      accum += float32Arr[i];
      count++;
    }
    const avg = count > 0 ? accum / count : 0;
    const clamped = Math.max(-1, Math.min(1, avg));
    result[offsetResult] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function int16ChunksToBase64(chunks) {
  let totalSamples = 0;
  for (const c of chunks) totalSamples += c.length;
  const merged = new Int16Array(totalSamples);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  const bytes = new Uint8Array(merged.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function initVoiceAssistant({ onSearch, onTabSwitch, onThemeSwitch, onRandomMedia }) {
  onSearchCallback = onSearch;
  onTabSwitchCallback = onTabSwitch;
  onThemeSwitchCallback = onThemeSwitch;
  onRandomMediaCallback = onRandomMedia;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

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
      webSpeechGotResult = true;

      const previewClean = cleanVoiceTranscript(activeRaw);
      const searchInput = document.getElementById('global-search-input');
      if (searchInput && previewClean) {
        searchInput.value = previewClean;
      }
      setVoiceHudText(`«${previewClean || activeRaw}»`, true, false);

      if (finalText) {
        if (interimSearchTimer) {
          clearTimeout(interimSearchTimer);
          interimSearchTimer = null;
        }
        stopAllVoiceListening(false);
        setTimeout(() => setVoiceHudText('', false), 700);
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

    // Никогда не обрываем запись ложной ошибкой WebSpeech API — работает резервный канал микрофона!
    recognition.onerror = () => {};
    recognition.onend = () => {};
  }

  // Предварительное заполнение списка микрофонов
  setTimeout(() => {
    enumerateAllAvailableMicrophones(false).catch(() => {});
  }, 800);

  return true;
}

function cleanupWebAudioCapture() {
  if (vuAnimFrame) {
    cancelAnimationFrame(vuAnimFrame);
    vuAnimFrame = null;
  }
  if (activeProcessor) {
    try { activeProcessor.disconnect(); } catch (_) {}
    activeProcessor = null;
  }
  if (activeAnalyser) {
    try { activeAnalyser.disconnect(); } catch (_) {}
    activeAnalyser = null;
  }
  if (activeAudioCtx) {
    try { activeAudioCtx.close(); } catch (_) {}
    activeAudioCtx = null;
  }
  if (activeMediaStream) {
    try { activeMediaStream.getTracks().forEach(t => t.stop()); } catch (_) {}
    activeMediaStream = null;
  }
}

export function stopAllVoiceListening(hideHud = true) {
  isListening = false;
  finalizeInProgress = false;
  updateMicButtonState(false);
  try { if (recognition) recognition.abort(); } catch (_) {}
  if (nativeListenAbort) {
    try { nativeListenAbort.abort(); } catch (_) {}
    nativeListenAbort = null;
  }
  cleanupWebAudioCapture();
  if (hideHud) setVoiceHudText('', false);
}

async function startBrowserWebAudioCapture(rawDeviceId) {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return false;
  }
  cleanupWebAudioCapture();
  const audioConstraints = rawDeviceId
    ? { deviceId: { exact: rawDeviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
  } catch (_) {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
  }
  if (!stream) return false;

  activeMediaStream = stream;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  activeAudioCtx = new AudioCtx();
  recordingSampleRate = activeAudioCtx.sampleRate || 48000;

  const source = activeAudioCtx.createMediaStreamSource(stream);
  activeAnalyser = activeAudioCtx.createAnalyser();
  activeAnalyser.fftSize = 256;
  source.connect(activeAnalyser);

  activeProcessor = activeAudioCtx.createScriptProcessor(4096, 1, 1);
  recordedPcmChunks = [];
  speechDetectedInSession = false;
  silenceDurationSec = 0;
  sessionStartTime = Date.now();

  activeProcessor.onaudioprocess = (e) => {
    if (!isListening || finalizeInProgress) return;
    const input = e.inputBuffer.getChannelData(0);
    let sumSq = 0;
    for (let i = 0; i < input.length; i++) {
      sumSq += input[i] * input[i];
    }
    const rms = Math.sqrt(sumSq / input.length);
    const rmsNorm = Math.min(1, rms * 14);
    updateVuBars(rmsNorm);

    const pcm16 = downsampleFloat32ToInt16(input, recordingSampleRate, 16000);
    recordedPcmChunks.push(pcm16);

    const chunkDur = input.length / recordingSampleRate;
    if (rms > 0.018) {
      speechDetectedInSession = true;
      silenceDurationSec = 0;
      if (!webSpeechGotResult) {
        setVoiceHudText('Слышу ваш голос... Говорите название', true, false);
      }
    } else if (speechDetectedInSession) {
      silenceDurationSec += chunkDur;
      if (silenceDurationSec >= 1.15 && (Date.now() - sessionStartTime) > 1300 && !webSpeechGotResult) {
        finalizeVoiceCaptureAndRecognize();
      }
    }

    if ((Date.now() - sessionStartTime) > 7500 && !finalizeInProgress) {
      finalizeVoiceCaptureAndRecognize();
    }
  };

  source.connect(activeProcessor);
  activeProcessor.connect(activeAudioCtx.destination);
  return true;
}

async function startNativeWindowsMicCapture(micOptionId) {
  let bridgeBase = '';
  let devId = 'winmm:0';
  if (micOptionId && micOptionId.includes('|')) {
    const parts = micOptionId.split('|');
    bridgeBase = parts[0];
    devId = parts[1] || 'winmm:0';
  } else if (micOptionId && micOptionId.startsWith('winmm:')) {
    devId = micOptionId;
    for (const b of LOCAL_BRIDGE_ORIGINS) {
      if (b) { bridgeBase = b; break; }
    }
  } else {
    for (const b of LOCAL_BRIDGE_ORIGINS) {
      if (b) { bridgeBase = b; break; }
    }
  }

  nativeListenAbort = new AbortController();
  const fakeVuInterval = setInterval(() => {
    if (!isListening) { clearInterval(fakeVuInterval); return; }
    updateVuBars(0.25 + Math.random() * 0.45);
  }, 90);

  try {
    const tryBases = bridgeBase ? [bridgeBase, ''] : LOCAL_BRIDGE_ORIGINS;
    for (const base of tryBases) {
      try {
        const res = await fetch(`${base}/api/voice/listen-native`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: devId, durationSec: 3.6 }),
          signal: nativeListenAbort.signal
        });
        if (!res.ok) continue;
        const data = await res.json();
        clearInterval(fakeVuInterval);
        if (!isListening) return;
        stopAllVoiceListening(false);
        if (data && data.transcript) {
          setVoiceHudText(`«${cleanVoiceTranscript(data.transcript) || data.transcript}»`, true, true);
          setTimeout(() => setVoiceHudText('', false), 800);
          processVoiceCommand(data.transcript);
          return;
        } else {
          setVoiceHudText('Речь не расслышана. Проверьте выбранный микрофон в списке ниже.', true, false);
          return;
        }
      } catch (e) {
        if (e.name === 'AbortError') {
          clearInterval(fakeVuInterval);
          return;
        }
      }
    }
    clearInterval(fakeVuInterval);
    setVoiceHudText('Выберите активный микрофон в выпадающем списке', true, false);
  } catch (_) {
    clearInterval(fakeVuInterval);
  }
}

async function finalizeVoiceCaptureAndRecognize() {
  if (finalizeInProgress) return;
  finalizeInProgress = true;

  if (webSpeechGotResult) {
    stopAllVoiceListening(true);
    return;
  }

  const chunks = recordedPcmChunks.slice();
  recordedPcmChunks = [];
  cleanupWebAudioCapture();
  try { if (recognition) recognition.abort(); } catch (_) {}

  if (!chunks || chunks.length === 0) {
    stopAllVoiceListening(true);
    return;
  }

  setVoiceHudText('Распознавание речи...', true, true);
  try {
    const pcmBase64 = int16ChunksToBase64(chunks);
    const res = await fetch('/api/voice/recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pcmBase64, lang: 'ru-RU' })
    });
    const data = await res.json().catch(() => ({}));
    stopAllVoiceListening(false);
    if (data && data.transcript) {
      const clean = cleanVoiceTranscript(data.transcript) || data.transcript;
      const searchInput = document.getElementById('global-search-input');
      if (searchInput) searchInput.value = clean;
      setVoiceHudText(`«${clean}»`, true, true);
      setTimeout(() => setVoiceHudText('', false), 850);
      processVoiceCommand(data.transcript);
    } else {
      setVoiceHudText('Голос не распознан. Проверьте выбранный микрофон или скажите громче.', true, false);
      setTimeout(() => { if (!isListening) setVoiceHudText('', false); }, 2600);
    }
  } catch (err) {
    stopAllVoiceListening(true);
    showToast('Ошибка связи с сервером распознавания речи', 'error');
  }
}

async function restartListeningWithSelectedMic() {
  stopAllVoiceListening(false);
  await startVoiceListeningSession();
}

async function startVoiceListeningSession() {
  isListening = true;
  finalizeInProgress = false;
  webSpeechGotResult = false;
  lastDispatchedQuery = '';
  updateMicButtonState(true);
  setVoiceHudText('Слушаю... Назовите фильм, сериал или аниме', true, false);

  await enumerateAllAvailableMicrophones(true);

  const chosen = availableMics.find(m => m.id === selectedMicId) || availableMics[0] || null;
  if (chosen && chosen.type === 'web') {
    const startedWeb = await startBrowserWebAudioCapture(chosen.rawDeviceId);
    if (startedWeb) {
      await enumerateAllAvailableMicrophones(false);
      try { if (recognition) recognition.start(); } catch (_) {}
      return;
    }
  }

  // Если выбран или доступен аппаратный микрофон Windows ПК (или браузер на HTTP LAN без mediaDevices)
  const webStartedFallback = await startBrowserWebAudioCapture('');
  if (webStartedFallback) {
    await enumerateAllAvailableMicrophones(false);
    try { if (recognition) recognition.start(); } catch (_) {}
    return;
  }

  await startNativeWindowsMicCapture(selectedMicId || (chosen ? chosen.id : 'winmm:0'));
}

export function toggleVoiceListening() {
  if (isListening) {
    if (recordedPcmChunks.length > 4 && !webSpeechGotResult) {
      finalizeVoiceCaptureAndRecognize();
    } else {
      stopAllVoiceListening(true);
    }
    return;
  }
  trackClientAction('use_voice');
  startVoiceListeningSession();
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
    .replace(/[.,!?;:"«»'()\[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!norm) return;

  if (/^(?:включи\s+|открой\s+)?(?:тв\s+режим|режим\s+тв|телевизор)$/i.test(norm)) {
    document.body.classList.add('tv-mode');
    window.stormOnTvModeChanged?.(true);
    showToast('Включен режим Smart TV', 'info');
    return;
  }
  if (/^(?:выключи\s+тв\s+режим|обычный\s+режим)$/i.test(norm)) {
    document.body.classList.remove('tv-mode');
    window.stormOnTvModeChanged?.(false);
    showToast('Включен стандартный интерфейс', 'info');
    return;
  }

  const navMatch = norm.match(/^(?:открой\s+|перейди\s+в\s+|включи\s+раздел\s+|раздел\s+|вкладка\s+)?(новинки|фильмы|сериалы|мультфильмы|мультики|мультсериалы|аниме\s+фильмы|аниме\s+сериалы|аниме|закладки|мои\s+списки|продолжить\s+просмотр|главная|домой)$/i);
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

  if (/^(?:включи\s+|выбери\s+)?(?:случайный\s+фильм|случайное\s+видео|случайный\s+релиз|рандом)$/i.test(norm)) {
    if (onRandomMediaCallback) onRandomMediaCallback();
    return;
  }

  const cleanQuery = cleanVoiceTranscript(rawText);
  if (cleanQuery) {
    showToast(`Голосовой поиск: «${cleanQuery}»`, 'success');
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
    btn.title = active
      ? 'Голосовой поиск слушает (доступен выбор микрофона)... Нажмите для завершения'
      : 'Голосовой поиск и выбор микрофона';
  }
}
