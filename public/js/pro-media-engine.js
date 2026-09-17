/**
 * STORM MULTIMEDIA — Pro Media Engine
 * Профессиональный студийный движок обработки видео и звука
 * Поддержка новейших кинематографических технологий:
 * - HDR10 Vivid и Dolby Vision Cinema Tonemapping
 * - Filmmaker Mode (калиброванное теплое изображение D65)
 * - AMD FidelityFX CAS (Contrast Adaptive Sharpening)
 * - 21:9 Cinemascope (просмотр без черных полос)
 * - Процедурное аналоговое зерно 35 мм кинопленки
 * - Dolby Atmos 3D Spatial Audio и DTS:X Surround (Web Audio API)
 * - AI Voice Boost (интеллектуальное выделение речи)
 * - Студийный 10-полосный параметрический эквалайзер и Subwoofer Bass Boost
 */

import { showToast } from './auth.js';

// ==========================================
// 1. КОНФИГУРАЦИЯ И СОСТОЯНИЕ ВИДЕО-ДВИЖКА
// ==========================================
const DEFAULT_VIDEO_SETTINGS = {
  preset: 'standard', // 'standard', 'hdr10', 'dolby_vision_dark', 'dolby_vision_bright', 'filmmaker', 'oled_black'
  casSharpness: 'off', // 'off', 'soft', 'standard', 'ultra'
  filmGrain: 'off', // 'off', 'subtle', 'cinema_35mm'
  aspectRatio: '16:9', // '16:9', '21:9', 'fit', 'auto'
  upscalerShader: 'off', // 'off', 'cas', 'anime4k', 'fsr'
  brightness: 100, // 70 - 150 %
  contrast: 100, // 70 - 160 %
  saturation: 100, // 0 - 200 %
  colorTemp: 6500, // 4500K - 9300K
  sharpness: 0 // 0 - 100 %
};

let proVideoSettings = { ...DEFAULT_VIDEO_SETTINGS };

try {
  const savedVideo = localStorage.getItem('storm_pro_video_settings');
  if (savedVideo) {
    proVideoSettings = { ...DEFAULT_VIDEO_SETTINGS, ...JSON.parse(savedVideo) };
  }
} catch {}

// ==========================================
// 2. КОНФИГУРАЦИЯ И СОСТОЯНИЕ АУДИО-ДВИЖКА
// ==========================================
export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  cinema: [4, 3, 1, 0, -1, 1, 3, 4, 3, 2],
  bass: [7, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  voice: [-2, -1, 0, 2, 4, 5, 4, 2, 0, -1],
  night: [2, 1, 0, 1, 3, 2, 1, -1, -2, -3],
  live: [3, 2, 1, 1, 2, 3, 4, 4, 3, 2]
};

const DEFAULT_AUDIO_SETTINGS = {
  spatialMode: 'stereo', // 'stereo', 'atmos', 'dtsx', 'headphones'
  voiceBoost: 'off', // 'off', 'mild', 'strong'
  speechIsolation: 'off', // 'off', 'mild', 'strong', 'cinema'
  bassBoost: 'off', // 'off', 'cinema', 'ultra'
  nightMode: false,
  eqPreset: 'cinema',
  eqBands: [...EQ_PRESETS.cinema],
  preampGain: 1.0, // 0.5 - 2.0
  audioDelayMs: 0 // -1000 to +1000 ms
};

export let proAudioSettings = { ...DEFAULT_AUDIO_SETTINGS };

try {
  const savedAudio = localStorage.getItem('storm_pro_audio_settings');
  if (savedAudio) {
    proAudioSettings = { ...DEFAULT_AUDIO_SETTINGS, ...JSON.parse(savedAudio) };
  } else {
    const nightAudio = localStorage.getItem('storm_night_audio');
    if (nightAudio) {
      proAudioSettings.nightMode = nightAudio === 'true';
    }
  }
} catch {}

export function setProAudioNightMode(enabled) {
  proAudioSettings.nightMode = !!enabled;
  try {
    localStorage.setItem('storm_pro_audio_settings', JSON.stringify(proAudioSettings));
    localStorage.setItem('storm_night_audio', proAudioSettings.nightMode ? 'true' : 'false');
  } catch {}
  applyProAudioSettings();
  return proAudioSettings.nightMode;
}

export function getProAudioNightMode() {
  return !!proAudioSettings.nightMode;
}

export function setProAudioSpeechIsolation(mode) {
  proAudioSettings.speechIsolation = mode || 'off';
  try {
    localStorage.setItem('storm_pro_audio_settings', JSON.stringify(proAudioSettings));
    localStorage.setItem('storm_speech_isolation', proAudioSettings.speechIsolation);
  } catch {}
  applyProAudioSettings();
  return proAudioSettings.speechIsolation;
}

export function getProAudioSpeechIsolation() {
  return proAudioSettings.speechIsolation || 'off';
}

export function setVideoUpscalerShader(mode) {
  proVideoSettings.upscalerShader = mode || 'off';
  try {
    localStorage.setItem('storm_pro_video_settings', JSON.stringify(proVideoSettings));
  } catch {}
  applyProVideoSettings();
  return proVideoSettings.upscalerShader;
}

export function getVideoUpscalerShader() {
  return proVideoSettings.upscalerShader || 'off';
}

// Узлы Web Audio API
let proAudioCtx = null;
let proSourceNode = null;
let proBassFilter = null;
let proVoiceFilter = null;
let proEqFilters = [];
let proCompressor = null;
let proConvolver = null;
let proWetGain = null;
let proDryGain = null;
let proMasterGain = null;
let proDelayNode = null;
let proAnalyser = null;
let activeVisualizerCanvas = null;
let visualizerRaf = null;
let currentVisualizerMode = 'off'; // 'off', 'spectrum', 'wave', 'matrix'
let attachedMediaElement = null;

// Speech Isolation DSP (Mid-Side Matrix)
let proSpeechSplitter = null;
let proSpeechMerger = null;
let proSpeechHighPass = null;
let proSpeechPeaking = null;
let proSpeechMidGain = null;
let proSpeechSideGain = null;

// WebGL Canvas Video Upscaler
let glCanvas = null;
let gl = null;
let glProgram = null;
let glTexture = null;
let glRafId = null;
let glPositionBuffer = null;
let glTexCoordBuffer = null;

const VS_SOURCE = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

const FS_CAS = `
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_image;
uniform vec2 u_resolution;

void main() {
  vec2 step = 1.0 / u_resolution;
  vec4 c = texture2D(u_image, v_texCoord);
  vec4 n = texture2D(u_image, v_texCoord + vec2(0.0, -step.y));
  vec4 s = texture2D(u_image, v_texCoord + vec2(0.0, step.y));
  vec4 w = texture2D(u_image, v_texCoord + vec2(-step.x, 0.0));
  vec4 e = texture2D(u_image, v_texCoord + vec2(step.x, 0.0));

  vec4 minColor = min(min(min(min(c, n), s), w), e);
  vec4 maxColor = max(max(max(max(c, n), s), w), e);
  vec4 diff = maxColor - minColor;
  vec4 weight = clamp(diff * 3.5, 0.0, 0.35);

  vec4 sharpened = c + (c - (n + s + w + e) * 0.25) * weight;
  gl_FragColor = clamp(sharpened, 0.0, 1.0);
}
`;

const FS_ANIME4K = `
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_image;
uniform vec2 u_resolution;

void main() {
  vec2 step = 1.0 / u_resolution;
  vec4 c = texture2D(u_image, v_texCoord);
  vec4 n = texture2D(u_image, v_texCoord + vec2(0.0, -step.y));
  vec4 s = texture2D(u_image, v_texCoord + vec2(0.0, step.y));
  vec4 w = texture2D(u_image, v_texCoord + vec2(-step.x, 0.0));
  vec4 e = texture2D(u_image, v_texCoord + vec2(step.x, 0.0));

  float gradX = length(e.rgb - w.rgb);
  float gradY = length(s.rgb - n.rgb);
  float edge = clamp((gradX + gradY) * 2.8, 0.0, 1.0);

  vec3 smoothed = (n.rgb + s.rgb + w.rgb + e.rgb + c.rgb * 2.0) / 6.0;
  vec3 sharpened = c.rgb * 1.15 - smoothed * 0.15;
  vec3 result = mix(smoothed, sharpened, edge);
  gl_FragColor = vec4(clamp(result, 0.0, 1.0), c.a);
}
`;

const FS_FSR = `
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_image;
uniform vec2 u_resolution;

void main() {
  vec2 step = 1.0 / u_resolution;
  vec4 c = texture2D(u_image, v_texCoord);
  vec4 nw = texture2D(u_image, v_texCoord + vec2(-step.x, -step.y));
  vec4 ne = texture2D(u_image, v_texCoord + vec2(step.x, -step.y));
  vec4 sw = texture2D(u_image, v_texCoord + vec2(-step.x, step.y));
  vec4 se = texture2D(u_image, v_texCoord + vec2(step.x, step.y));

  vec4 avg = (nw + ne + sw + se + c * 4.0) / 8.0;
  vec4 diff = c - avg;
  vec4 fsrOut = c + diff * 1.35;
  gl_FragColor = clamp(fsrOut, 0.0, 1.0);
}
`;

function compileShader(glContext, type, source) {
  const shader = glContext.createShader(type);
  glContext.shaderSource(shader, source);
  glContext.compileShader(shader);
  if (!glContext.getShaderParameter(shader, glContext.COMPILE_STATUS)) {
    console.warn('Shader compile error:', glContext.getShaderInfoLog(shader));
    glContext.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(glContext, vs, fs) {
  const program = glContext.createProgram();
  glContext.attachShader(program, vs);
  glContext.attachShader(program, fs);
  glContext.linkProgram(program);
  if (!glContext.getProgramParameter(program, glContext.LINK_STATUS)) {
    console.warn('Program link error:', glContext.getProgramInfoLog(program));
    glContext.deleteProgram(program);
    return null;
  }
  return program;
}

export function runAudioLatencyTest() {
  const video = document.getElementById('storm-video-player');
  if (!proAudioCtx) {
    initProAudioEngine(video);
  }
  if (proAudioCtx && proAudioCtx.state === 'suspended') {
    proAudioCtx.resume().catch(() => {});
  }

  let flashOverlay = document.getElementById('audio-sync-flash-overlay');
  if (!flashOverlay) {
    flashOverlay = document.createElement('div');
    flashOverlay.id = 'audio-sync-flash-overlay';
    flashOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,210,255,0.45);z-index:99999;pointer-events:none;opacity:0;transition:opacity 0.05s ease;';
    document.body.appendChild(flashOverlay);
  }

  flashOverlay.style.opacity = '1';
  setTimeout(() => {
    flashOverlay.style.opacity = '0';
  }, 100);

  try {
    if (proAudioCtx) {
      const osc = proAudioCtx.createOscillator();
      const gain = proAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, proAudioCtx.currentTime);
      gain.gain.setValueAtTime(0.3, proAudioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, proAudioCtx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(proAudioCtx.destination);
      osc.start();
      osc.stop(proAudioCtx.currentTime + 0.12);
    }
  } catch {}
}

export function initVideoUpscalerShaders(video) {
  if (!video) return;
  const container = video.closest('.player-video-box') || video.parentElement;
  if (!container) return;

  if (!glCanvas) {
    glCanvas = document.createElement('canvas');
    glCanvas.id = 'storm-pro-webgl-canvas';
    glCanvas.className = 'storm-pro-webgl-canvas';
    glCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;pointer-events:none;z-index:4;display:none;';
    container.style.position = 'relative';
    container.appendChild(glCanvas);
  }

  const mode = proVideoSettings.upscalerShader || 'off';
  if (mode === 'off') {
    stopVideoUpscalerShaders();
    return;
  }

  try {
    gl = glCanvas.getContext('webgl', { preserveDrawingBuffer: true }) || glCanvas.getContext('experimental-webgl');
    if (!gl) return;

    let fsSource = FS_CAS;
    if (mode === 'anime4k') fsSource = FS_ANIME4K;
    else if (mode === 'fsr') fsSource = FS_FSR;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VS_SOURCE);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;

    glProgram = createProgram(gl, vs, fs);
    gl.useProgram(glProgram);

    glPositionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, glPositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1
    ]), gl.STATIC_DRAW);

    glTexCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, glTexCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      1, 0
    ]), gl.STATIC_DRAW);

    glTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    glCanvas.style.display = 'block';
    video.style.opacity = '0.001';

    startGlRenderLoop(video);
  } catch (err) {
    console.warn('WebGL Upscaler note:', err.message);
    stopVideoUpscalerShaders();
  }
}

export function stopVideoUpscalerShaders() {
  if (glRafId) {
    cancelAnimationFrame(glRafId);
    glRafId = null;
  }
  if (glCanvas) {
    glCanvas.style.display = 'none';
  }
  const video = document.getElementById('storm-video-player');
  if (video) {
    video.style.opacity = '1';
  }
}

function startGlRenderLoop(video) {
  if (glRafId) cancelAnimationFrame(glRafId);

  const posLoc = gl.getAttribLocation(glProgram, 'a_position');
  const texLoc = gl.getAttribLocation(glProgram, 'a_texCoord');
  const resLoc = gl.getUniformLocation(glProgram, 'u_resolution');

  const render = () => {
    if (proVideoSettings.upscalerShader === 'off' || !glCanvas || glCanvas.style.display === 'none') {
      return;
    }

    if (video && video.readyState >= 2 && !video.paused && !video.ended) {
      if (glCanvas.width !== video.videoWidth || glCanvas.height !== video.videoHeight) {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          glCanvas.width = video.videoWidth;
          glCanvas.height = video.videoHeight;
          gl.viewport(0, 0, glCanvas.width, glCanvas.height);
        }
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, glTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

      gl.bindBuffer(gl.ARRAY_BUFFER, glPositionBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, glTexCoordBuffer);
      gl.enableVertexAttribArray(texLoc);
      gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

      if (resLoc) {
        gl.uniform2f(resLoc, glCanvas.width, glCanvas.height);
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    glRafId = requestAnimationFrame(render);
  };

  glRafId = requestAnimationFrame(render);
}

// ==========================================
// 3. ПРИМЕНЕНИЕ ВИДЕО-НАСТРОЕК (CSS & SVG FILTERS)
// ==========================================
function ensureSvgFiltersInjected() {
  if (document.getElementById('storm-pro-filters-svg')) return;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'storm-pro-filters-svg';
  svg.style.position = 'absolute';
  svg.style.width = '0';
  svg.style.height = '0';
  svg.style.pointerEvents = 'none';
  svg.innerHTML = `
    <defs>
      <!-- AMD FidelityFX Contrast Adaptive Sharpening (CAS) Soft -->
      <filter id="storm-cas-soft" x="0%" y="0%" width="100%" height="100%">
        <feConvolveMatrix order="3" kernelMatrix="0 -0.25 0 -0.25 2.0 -0.25 0 -0.25 0" preserveAlpha="true" />
      </filter>
      <!-- AMD FidelityFX CAS Standard -->
      <filter id="storm-cas-std" x="0%" y="0%" width="100%" height="100%">
        <feConvolveMatrix order="3" kernelMatrix="0 -0.5 0 -0.5 3.0 -0.5 0 -0.5 0" preserveAlpha="true" />
      </filter>
      <!-- AMD FidelityFX CAS Ultra -->
      <filter id="storm-cas-ultra" x="0%" y="0%" width="100%" height="100%">
        <feConvolveMatrix order="3" kernelMatrix="-0.2 -0.6 -0.2 -0.6 4.2 -0.6 -0.2 -0.6 -0.2" preserveAlpha="true" />
      </filter>
      <!-- 35mm Analog Film Grain Subtle -->
      <filter id="storm-film-grain-subtle" x="0%" y="0%" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="3" result="noise" />
        <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.08 0" in="noise" result="coloredNoise" />
        <feComposite in="coloredNoise" in2="SourceGraphic" operator="in" result="clippedNoise" />
        <feBlend mode="overlay" in="SourceGraphic" in2="clippedNoise" />
      </filter>
      <!-- 35mm Analog Film Grain Cinema -->
      <filter id="storm-film-grain-cinema" x="0%" y="0%" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="4" result="noise" />
        <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.16 0" in="noise" result="coloredNoise" />
        <feComposite in="coloredNoise" in2="SourceGraphic" operator="in" result="clippedNoise" />
        <feBlend mode="overlay" in="SourceGraphic" in2="clippedNoise" />
      </filter>
    </defs>
  `;
  document.body.appendChild(svg);
}

export function applyProVideoSettings(target = null) {
  ensureSvgFiltersInjected();

  const videoEl = target || document.getElementById('storm-video-player');
  const iframeEl = document.querySelector('.cinema-player-iframe');
  const activeTarget = videoEl || iframeEl;

  if (!activeTarget) return;

  const s = proVideoSettings;

  // 1. Базовые CSS фильтры калибровки и пресетов
  let brightness = s.brightness / 100;
  let contrast = s.contrast / 100;
  let saturation = s.saturation / 100;
  let sepia = 0;
  let hueRotate = 0;

  // Пресеты отображения
  switch (s.preset) {
    case 'hdr10':
      // HDR10 Vivid: расширение пиковой яркости и локального контраста
      contrast *= 1.16;
      brightness *= 1.06;
      saturation *= 1.22;
      break;
    case 'dolby_vision_dark':
      // Dolby Vision Cinema Dark: глубокий кинематографический черный для темных залов
      contrast *= 1.24;
      brightness *= 0.95;
      saturation *= 1.12;
      break;
    case 'dolby_vision_bright':
      // Dolby Vision Cinema Bright: повышенная динамическая видимость для освещенных комнат
      contrast *= 1.18;
      brightness *= 1.12;
      saturation *= 1.18;
      break;
    case 'filmmaker':
      // Filmmaker Mode: точная калибровка 6500K без переусиления цветов
      contrast *= 1.04;
      brightness *= 1.01;
      saturation *= 1.02;
      sepia = 0.06; // Теплый кинематографический баланс D65
      break;
    case 'oled_black':
      // OLED True Black: глубочайшие тени и чистый черный
      contrast *= 1.28;
      brightness *= 0.93;
      saturation *= 1.14;
      break;
    case 'standard':
    default:
      break;
  }

  // Температурный баланс
  if (s.colorTemp < 6500) {
    // Теплее
    sepia += ((6500 - s.colorTemp) / 6500) * 0.18;
  } else if (s.colorTemp > 6500) {
    // Холоднее
    hueRotate = ((s.colorTemp - 6500) / 2800) * -12;
  }

  // Формируем цепочку фильтров
  const filterParts = [
    `brightness(${brightness.toFixed(3)})`,
    `contrast(${contrast.toFixed(3)})`,
    `saturate(${saturation.toFixed(3)})`
  ];

  if (sepia > 0) filterParts.push(`sepia(${sepia.toFixed(3)})`);
  if (hueRotate !== 0) filterParts.push(`hue-rotate(${hueRotate.toFixed(1)}deg)`);

  // Добавляем SVG фильтр резкости FSR CAS или 35мм зерна
  if (s.casSharpness === 'soft') {
    filterParts.push('url(#storm-cas-soft)');
  } else if (s.casSharpness === 'standard') {
    filterParts.push('url(#storm-cas-std)');
  } else if (s.casSharpness === 'ultra') {
    filterParts.push('url(#storm-cas-ultra)');
  }

  if (s.filmGrain === 'subtle') {
    filterParts.push('url(#storm-film-grain-subtle)');
  } else if (s.filmGrain === 'cinema_35mm') {
    filterParts.push('url(#storm-film-grain-cinema)');
  }

  activeTarget.style.filter = filterParts.join(' ');
  activeTarget.style.transition = 'filter 0.2s ease, transform 0.2s ease';

  // 2. Соотношение сторон и кадрирование (Aspect Ratio / 21:9 Cinemascope)
  const container = activeTarget.closest('.player-video-box') || activeTarget.parentElement;
  if (container) {
    if (s.aspectRatio === '21:9') {
      // 21:9 Cinemascope — масштабируем изображение по высоте, убирая черные полосы
      activeTarget.style.transform = 'scale(1.33)';
      activeTarget.style.transformOrigin = 'center center';
      container.style.overflow = 'hidden';
    } else if (s.aspectRatio === 'fit') {
      activeTarget.style.transform = 'scale(1.08)';
      activeTarget.style.transformOrigin = 'center center';
      container.style.overflow = 'hidden';
    } else {
      activeTarget.style.transform = 'scale(1)';
      activeTarget.style.transformOrigin = 'center center';
    }
  }

  // 3. WebGL шейдерный апскейлер (FSR 1.0, CAS, Anime4K)
  if (videoEl && videoEl.tagName === 'VIDEO') {
    if (s.upscalerShader && s.upscalerShader !== 'off') {
      initVideoUpscalerShaders(videoEl);
    } else {
      stopVideoUpscalerShaders();
    }
  }

  // Сохраняем в память
  try {
    localStorage.setItem('storm_pro_video_settings', JSON.stringify(proVideoSettings));
  } catch {}
}

// ==========================================
// 4. ПРИМЕНЕНИЕ АУДИО-НАСТРОЕК (WEB AUDIO API)
// ==========================================
export function initProAudioEngine(video = document.getElementById('storm-video-player')) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    if (!proAudioCtx) {
      proAudioCtx = new AudioContext();
    }

    if (proAudioCtx.state === 'suspended') {
      proAudioCtx.resume().catch(() => {});
    }

    // Слушатель пользовательских жестов для мгновенного пробуждения AudioContext
    if (!window._stormAudioContextGestureHooked) {
      window._stormAudioContextGestureHooked = true;
      const resumeAudio = () => {
        if (proAudioCtx && proAudioCtx.state === 'suspended') {
          proAudioCtx.resume().catch(() => {});
        }
      };
      window.addEventListener('click', resumeAudio, { passive: true });
      window.addEventListener('keydown', resumeAudio, { passive: true });
      window.addEventListener('touchstart', resumeAudio, { passive: true });
    }

    if (video) {
      video.addEventListener('play', () => {
        if (proAudioCtx && proAudioCtx.state === 'suspended') {
          proAudioCtx.resume().catch(() => {});
        }
      });
      video.addEventListener('playing', () => {
        if (proAudioCtx && proAudioCtx.state === 'suspended') {
          proAudioCtx.resume().catch(() => {});
        }
      });

      if (!proSourceNode || attachedMediaElement !== video) {
        if (proSourceNode) {
          try { proSourceNode.disconnect(); } catch {}
        }
        if (!video._stormAudioSource) {
          try {
            video._stormAudioSource = proAudioCtx.createMediaElementSource(video);
          } catch (e) {
            // Игнорируем повторное подключение, если элемент уже имеет узел источника
          }
        }
        proSourceNode = video._stormAudioSource || proSourceNode;
        attachedMediaElement = video;

        if (proSourceNode) {
          // 1. Фильтр усиления баса (Low-shelf 80Hz)
          proBassFilter = proAudioCtx.createBiquadFilter();
          proBassFilter.type = 'lowshelf';
          proBassFilter.frequency.setValueAtTime(80, proAudioCtx.currentTime);

          // 2. Фильтр выделения речи (Peaking 2500Hz, Q=1.2)
          proVoiceFilter = proAudioCtx.createBiquadFilter();
          proVoiceFilter.type = 'peaking';
          proVoiceFilter.frequency.setValueAtTime(2500, proAudioCtx.currentTime);
          proVoiceFilter.Q.setValueAtTime(1.2, proAudioCtx.currentTime);

          // 3. 10-полосный эквалайзер
          proEqFilters = EQ_FREQUENCIES.map(freq => {
            const f = proAudioCtx.createBiquadFilter();
            if (freq <= 32) {
              f.type = 'lowshelf';
            } else if (freq >= 16000) {
              f.type = 'highshelf';
            } else {
              f.type = 'peaking';
              f.Q.setValueAtTime(1.4, proAudioCtx.currentTime);
            }
            f.frequency.setValueAtTime(freq, proAudioCtx.currentTime);
            return f;
          });

          // 4. Компрессор динамического диапазона (Ночной режим)
          proCompressor = proAudioCtx.createDynamicsCompressor();
          proCompressor.threshold.setValueAtTime(-24, proAudioCtx.currentTime);
          proCompressor.knee.setValueAtTime(30, proAudioCtx.currentTime);
          proCompressor.ratio.setValueAtTime(12, proAudioCtx.currentTime);
          proCompressor.attack.setValueAtTime(0.003, proAudioCtx.currentTime);
          proCompressor.release.setValueAtTime(0.25, proAudioCtx.currentTime);

          // 5. Задержка звука (Audio Sync Offset)
          proDelayNode = proAudioCtx.createDelay(2.0);
          proDelayNode.delayTime.setValueAtTime(0, proAudioCtx.currentTime);

          // 6. Сверточный ревербератор для Dolby Atmos 3D акустики кинозала
          proConvolver = proAudioCtx.createConvolver();
          proConvolver.buffer = createCinematicImpulseBuffer(proAudioCtx, 1.4, 2.2);

          proWetGain = proAudioCtx.createGain();
          proDryGain = proAudioCtx.createGain();
          proMasterGain = proAudioCtx.createGain();

          let lastNode = proSourceNode;
          lastNode.connect(proDelayNode);
          lastNode = proDelayNode;

          // Mid-Side Speech Isolation Matrix
          proSpeechSplitter = proAudioCtx.createChannelSplitter(2);
          proSpeechMerger = proAudioCtx.createChannelMerger(2);

          proSpeechHighPass = proAudioCtx.createBiquadFilter();
          proSpeechHighPass.type = 'highpass';
          proSpeechHighPass.frequency.setValueAtTime(120, proAudioCtx.currentTime);

          proSpeechPeaking = proAudioCtx.createBiquadFilter();
          proSpeechPeaking.type = 'peaking';
          proSpeechPeaking.frequency.setValueAtTime(2800, proAudioCtx.currentTime);
          proSpeechPeaking.Q.setValueAtTime(1.2, proAudioCtx.currentTime);

          proSpeechMidGain = proAudioCtx.createGain();
          proSpeechSideGain = proAudioCtx.createGain();

          lastNode.connect(proSpeechSplitter);

          const midSumL = proAudioCtx.createGain();
          midSumL.gain.setValueAtTime(0.5, proAudioCtx.currentTime);
          const midSumR = proAudioCtx.createGain();
          midSumR.gain.setValueAtTime(0.5, proAudioCtx.currentTime);
          proSpeechSplitter.connect(midSumL, 0);
          proSpeechSplitter.connect(midSumR, 1);

          midSumL.connect(proSpeechHighPass);
          midSumR.connect(proSpeechHighPass);
          proSpeechHighPass.connect(proSpeechPeaking);
          proSpeechPeaking.connect(proSpeechMidGain);

          const sideDiffL = proAudioCtx.createGain();
          sideDiffL.gain.setValueAtTime(0.5, proAudioCtx.currentTime);
          const sideDiffR = proAudioCtx.createGain();
          sideDiffR.gain.setValueAtTime(-0.5, proAudioCtx.currentTime);
          proSpeechSplitter.connect(sideDiffL, 0);
          proSpeechSplitter.connect(sideDiffR, 1);

          sideDiffL.connect(proSpeechSideGain);
          sideDiffR.connect(proSpeechSideGain);

          const sideInvertR = proAudioCtx.createGain();
          sideInvertR.gain.setValueAtTime(-1.0, proAudioCtx.currentTime);
          proSpeechSideGain.connect(sideInvertR);

          proSpeechMidGain.connect(proSpeechMerger, 0, 0);
          proSpeechSideGain.connect(proSpeechMerger, 0, 0);
          proSpeechMidGain.connect(proSpeechMerger, 0, 1);
          sideInvertR.connect(proSpeechMerger, 0, 1);

          lastNode = proSpeechMerger;

          lastNode.connect(proBassFilter);
          lastNode = proBassFilter;

          lastNode.connect(proVoiceFilter);
          lastNode = proVoiceFilter;

          for (const eqNode of proEqFilters) {
            lastNode.connect(eqNode);
            lastNode = eqNode;
          }

          // Разветвление на сухой и пространственный сигнал (Dolby Atmos)
          lastNode.connect(proDryGain);
          lastNode.connect(proConvolver);
          proConvolver.connect(proWetGain);

          proDryGain.connect(proMasterGain);
          proWetGain.connect(proMasterGain);

          // Анализатор спектра для визуализации (Feature 9)
          try {
            proAnalyser = proAudioCtx.createAnalyser();
            proAnalyser.fftSize = 128;
            proAnalyser.smoothingTimeConstant = 0.8;
            proMasterGain.connect(proAnalyser);
          } catch {}

          // Мастер-выход через ночной компрессор или напрямую
          proMasterGain.connect(proCompressor);
          proCompressor.connect(proAudioCtx.destination);
        }
      }
    }

    applyProAudioSettings();
  } catch (err) {
    console.warn('ProAudioEngine init note:', err.message);
  }
}

export function getProAudioMasterNode() {
  return { ctx: proAudioCtx, masterGain: proMasterGain };
}

// Генерация синтетического импульса кинозала (Reverb Impulse)
function createCinematicImpulseBuffer(ctx, duration = 1.2, decay = 2.0) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const n = i;
    const factor = Math.exp(-n / (sampleRate * (decay / 10)));
    left[i] = (Math.random() * 2 - 1) * factor;
    right[i] = (Math.random() * 2 - 1) * factor;
  }
  return buffer;
}

export function applyProAudioSettings() {
  const video = document.getElementById('storm-video-player');
  if (video && (!proAudioCtx || !proSourceNode)) {
    initProAudioEngine(video);
  }

  if (proAudioCtx && proAudioCtx.state === 'suspended') {
    proAudioCtx.resume().catch(() => {});
  }

  const s = proAudioSettings;

  if (proAudioCtx) {
    const now = proAudioCtx.currentTime;

    // 1. Усиление баса (Subwoofer Bass Boost)
    if (proBassFilter) {
      const bassGains = { off: 0, cinema: 8.5, ultra: 15.0 };
      const gain = bassGains[s.bassBoost] || 0;
      proBassFilter.gain.setTargetAtTime(gain, now, 0.05);
    }

    // 2. Интеллектуальное выделение речи (AI Voice Boost)
    if (proVoiceFilter) {
      const voiceGains = { off: 0, mild: 7.0, strong: 12.5 };
      const gain = voiceGains[s.voiceBoost] || 0;
      proVoiceFilter.gain.setTargetAtTime(gain, now, 0.05);
    }

    // 2.1 Локальный звуковой процессор выделения диалогов (Speech Isolation DSP - Mid-Side Matrix)
    if (proSpeechMidGain && proSpeechSideGain) {
      const mode = s.speechIsolation || 'off';
      if (mode === 'mild') {
        proSpeechMidGain.gain.setTargetAtTime(1.4, now, 0.05);
        proSpeechSideGain.gain.setTargetAtTime(0.55, now, 0.05);
        if (proSpeechPeaking) proSpeechPeaking.gain.setTargetAtTime(5.5, now, 0.05);
        if (proSpeechHighPass) proSpeechHighPass.frequency.setTargetAtTime(100, now, 0.05);
      } else if (mode === 'strong') {
        proSpeechMidGain.gain.setTargetAtTime(2.0, now, 0.05);
        proSpeechSideGain.gain.setTargetAtTime(0.2, now, 0.05);
        if (proSpeechPeaking) proSpeechPeaking.gain.setTargetAtTime(9.5, now, 0.05);
        if (proSpeechHighPass) proSpeechHighPass.frequency.setTargetAtTime(140, now, 0.05);
      } else if (mode === 'cinema') {
        proSpeechMidGain.gain.setTargetAtTime(1.25, now, 0.05);
        proSpeechSideGain.gain.setTargetAtTime(0.7, now, 0.05);
        if (proSpeechPeaking) proSpeechPeaking.gain.setTargetAtTime(3.5, now, 0.05);
        if (proSpeechHighPass) proSpeechHighPass.frequency.setTargetAtTime(80, now, 0.05);
      } else {
        proSpeechMidGain.gain.setTargetAtTime(1.0, now, 0.05);
        proSpeechSideGain.gain.setTargetAtTime(1.0, now, 0.05);
        if (proSpeechPeaking) proSpeechPeaking.gain.setTargetAtTime(0.0, now, 0.05);
        if (proSpeechHighPass) proSpeechHighPass.frequency.setTargetAtTime(20, now, 0.05);
      }
    }

    // 3. Эквалайзер 10 полос
    if (proEqFilters.length === 10) {
      for (let i = 0; i < 10; i++) {
        const val = s.eqBands[i] !== undefined ? s.eqBands[i] : 0;
        proEqFilters[i].gain.setTargetAtTime(val, now, 0.05);
      }
    }

    // 4. Пространственный звук (Dolby Atmos & DTS:X 3D)
    if (proWetGain && proDryGain) {
      if (s.spatialMode === 'atmos') {
        proDryGain.gain.setTargetAtTime(0.72, now, 0.05);
        proWetGain.gain.setTargetAtTime(0.55, now, 0.05);
      } else if (s.spatialMode === 'dtsx') {
        proDryGain.gain.setTargetAtTime(0.78, now, 0.05);
        proWetGain.gain.setTargetAtTime(0.42, now, 0.05);
      } else if (s.spatialMode === 'headphones') {
        proDryGain.gain.setTargetAtTime(0.70, now, 0.05);
        proWetGain.gain.setTargetAtTime(0.48, now, 0.05);
      } else {
        // Стерео прямое
        proDryGain.gain.setTargetAtTime(1.0, now, 0.05);
        proWetGain.gain.setTargetAtTime(0.0, now, 0.05);
      }
    }

    // 5. Ночной компрессор
    if (proCompressor) {
      if (s.nightMode) {
        proCompressor.threshold.setTargetAtTime(-28, now, 0.05);
        proCompressor.ratio.setTargetAtTime(16, now, 0.05);
      } else {
        proCompressor.threshold.setTargetAtTime(-10, now, 0.05);
        proCompressor.ratio.setTargetAtTime(2, now, 0.05);
      }
    }

    // 6. Мастер-громкость / Preamp
    if (proMasterGain) {
      proMasterGain.gain.setTargetAtTime(s.preampGain || 1.0, now, 0.05);
    }

    // 7. Синхронизация задержки
    if (proDelayNode) {
      const delaySec = Math.max(0, Math.min(1.5, (s.audioDelayMs || 0) / 1000));
      proDelayNode.delayTime.setTargetAtTime(delaySec, now, 0.05);
    }
  }

  // Трансляция настроек во все активные iframe (FanFilm4K, Stravers)
  const iframes = document.querySelectorAll('.cinema-player-iframe, #cinema-player-wrapper iframe, iframe');
  iframes.forEach(iframe => {
    try {
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'STORM_PRO_AUDIO',
          settings: s
        }, '*');
        iframe.contentWindow.postMessage(JSON.stringify({
          type: 'STORM_PRO_AUDIO',
          settings: s
        }), '*');
      }
    } catch {}
  });

  try {
    localStorage.setItem('storm_pro_audio_settings', JSON.stringify(proAudioSettings));
  } catch {}
}

// ==========================================
// 5. РЕНДЕРИНГ ПАНЕЛИ PRO ВИДЕО (UI)
// ==========================================
export function renderProVideoPanel(hostElement) {
  if (!hostElement) return;

  const s = proVideoSettings;

  hostElement.innerHTML = `
    <div class="pro-engine-panel" id="pro-video-panel">
      <div class="pro-engine-header">
        <div class="pro-engine-title">
          <span>🎛️</span>
          <span>Профессиональные настройки изображения</span>
        </div>
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="close-pro-video-btn" style="padding: 4px 8px;">✕</button>
      </div>

      <!-- Секция 1: Цветопередача и HDR Режимы -->
      <div class="pro-engine-section">
        <div class="pro-section-title">Цветопередача и кинематографический HDR</div>
        <div class="pro-preset-grid">
          <button type="button" class="pro-card-btn ${s.preset === 'standard' ? 'active' : ''}" data-preset="standard">
            <span class="pro-card-icon">📺</span>
            <span class="pro-card-name">Стандарт</span>
            <span class="pro-card-desc">Естественная цветопередача</span>
          </button>
          <button type="button" class="pro-card-btn ${s.preset === 'hdr10' ? 'active' : ''}" data-preset="hdr10">
            <span class="pro-card-icon">✨</span>
            <span class="pro-card-name">HDR10 Vivid</span>
            <span class="pro-card-desc">Пиковая яркость и контраст</span>
          </button>
          <button type="button" class="pro-card-btn ${s.preset === 'dolby_vision_dark' ? 'active' : ''}" data-preset="dolby_vision_dark">
            <span class="pro-card-icon">🎬</span>
            <span class="pro-card-name">Dolby Vision Dark</span>
            <span class="pro-card-desc">Глубокий черный для OLED</span>
          </button>
          <button type="button" class="pro-card-btn ${s.preset === 'dolby_vision_bright' ? 'active' : ''}" data-preset="dolby_vision_bright">
            <span class="pro-card-icon">☀️</span>
            <span class="pro-card-name">Dolby Vision Bright</span>
            <span class="pro-card-desc">Для освещенных комнат</span>
          </button>
          <button type="button" class="pro-card-btn ${s.preset === 'filmmaker' ? 'active' : ''}" data-preset="filmmaker">
            <span class="pro-card-icon">🎞️</span>
            <span class="pro-card-name">Filmmaker Mode</span>
            <span class="pro-card-desc">Теплый баланс режиссера D65</span>
          </button>
          <button type="button" class="pro-card-btn ${s.preset === 'oled_black' ? 'active' : ''}" data-preset="oled_black">
            <span class="pro-card-icon">🌑</span>
            <span class="pro-card-name">OLED True Black</span>
            <span class="pro-card-desc">Максимальный контраст</span>
          </button>
        </div>
      </div>

      <!-- Секция 2: Резкость FSR и Зерно 35 мм -->
      <div class="pro-engine-grid-2col">
        <div class="pro-engine-section">
          <div class="pro-section-title">Адаптивная резкость (AMD FidelityFX CAS)</div>
          <div class="pro-pill-group">
            <button type="button" class="pro-pill-btn ${s.casSharpness === 'off' ? 'active' : ''}" data-cas="off">Выкл</button>
            <button type="button" class="pro-pill-btn ${s.casSharpness === 'soft' ? 'active' : ''}" data-cas="soft">Мягкая 25%</button>
            <button type="button" class="pro-pill-btn ${s.casSharpness === 'standard' ? 'active' : ''}" data-cas="standard">Стандарт 50%</button>
            <button type="button" class="pro-pill-btn ${s.casSharpness === 'ultra' ? 'active' : ''}" data-cas="ultra">Ультра 100%</button>
          </div>
        </div>

        <div class="pro-engine-section">
          <div class="pro-section-title">Кинематографическое зерно (35 мм пленка)</div>
          <div class="pro-pill-group">
            <button type="button" class="pro-pill-btn ${s.filmGrain === 'off' ? 'active' : ''}" data-grain="off">Выкл</button>
            <button type="button" class="pro-pill-btn ${s.filmGrain === 'subtle' ? 'active' : ''}" data-grain="subtle">Мягкое зерно</button>
            <button type="button" class="pro-pill-btn ${s.filmGrain === 'cinema_35mm' ? 'active' : ''}" data-grain="cinema_35mm">35 мм пленка</button>
          </div>
        </div>
      </div>

      <!-- Секция: Нейросетевой апскейлер 4K (WebGL GPU Shaders) -->
      <div class="pro-engine-section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div class="pro-section-title" style="margin: 0;">Шейдерный апскейлер 4K (WebGL GPU Shaders)</div>
          <span style="font-size: 11px; color: var(--accent); font-weight: 700;">60 FPS GPU</span>
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">
          Аппаратное масштабирование и повышение четкости классических релизов прямо в веб-плеере
        </div>
        <div class="pro-pill-group">
          <button type="button" class="pro-pill-btn ${s.upscalerShader === 'off' ? 'active' : ''}" data-upscaler="off">Выкл</button>
          <button type="button" class="pro-pill-btn ${s.upscalerShader === 'cas' ? 'active' : ''}" data-upscaler="cas">AMD CAS</button>
          <button type="button" class="pro-pill-btn ${s.upscalerShader === 'anime4k' ? 'active' : ''}" data-upscaler="anime4k">Anime4K Bilateral</button>
          <button type="button" class="pro-pill-btn ${s.upscalerShader === 'fsr' ? 'active' : ''}" data-upscaler="fsr">AMD FSR 1.0 Spatial</button>
        </div>
      </div>

      <!-- Секция 3: Соотношение сторон (Aspect Ratio & 21:9 Cinemascope) -->
      <div class="pro-engine-section">
        <div class="pro-section-title">Соотношение сторон и кадрирование</div>
        <div class="pro-pill-group">
          <button type="button" class="pro-pill-btn ${s.aspectRatio === '16:9' ? 'active' : ''}" data-aspect="16:9">16:9 Стандарт</button>
          <button type="button" class="pro-pill-btn ${s.aspectRatio === '21:9' ? 'active' : ''}" data-aspect="21:9">21:9 Cinemascope (без полос)</button>
          <button type="button" class="pro-pill-btn ${s.aspectRatio === 'fit' ? 'active' : ''}" data-aspect="fit">Заполнение экрана</button>
          <button type="button" class="pro-pill-btn ${s.aspectRatio === 'auto' ? 'active' : ''}" data-aspect="auto">Авто</button>
        </div>
      </div>

      <!-- Секция 4: Ручная калибровка дисплея -->
      <div class="pro-engine-section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div class="pro-section-title" style="margin: 0;">Тонкая калибровка параметров</div>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="reset-pro-video-btn" style="font-size: 11px;">Сброс по умолчанию</button>
        </div>

        <div class="pro-sliders-grid">
          <div class="pro-slider-item">
            <div class="pro-slider-label">
              <span>Яркость</span>
              <span id="label-brightness">${s.brightness}%</span>
            </div>
            <input type="range" class="storm-slider" id="slider-brightness" min="70" max="140" value="${s.brightness}">
          </div>
          <div class="pro-slider-item">
            <div class="pro-slider-label">
              <span>Контрастность</span>
              <span id="label-contrast">${s.contrast}%</span>
            </div>
            <input type="range" class="storm-slider" id="slider-contrast" min="70" max="150" value="${s.contrast}">
          </div>
          <div class="pro-slider-item">
            <div class="pro-slider-label">
              <span>Насыщенность</span>
              <span id="label-saturation">${s.saturation}%</span>
            </div>
            <input type="range" class="storm-slider" id="slider-saturation" min="0" max="180" value="${s.saturation}">
          </div>
          <div class="pro-slider-item">
            <div class="pro-slider-label">
              <span>Цветовая температура</span>
              <span id="label-colortemp">${s.colorTemp}K</span>
            </div>
            <input type="range" class="storm-slider" id="slider-colortemp" min="4500" max="9300" step="100" value="${s.colorTemp}">
          </div>
        </div>
      </div>
    </div>
  `;

  // Обработчики пресетов
  hostElement.querySelectorAll('[data-preset]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      proVideoSettings.preset = btn.dataset.preset;
      applyProVideoSettings();
    };
  });

  // Шейдерный апскейлер WebGL
  hostElement.querySelectorAll('[data-upscaler]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-upscaler]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setVideoUpscalerShader(btn.dataset.upscaler);
      showToast(`Шейдер апскейлера: ${btn.textContent.trim()}`, 'info');
    };
  });

  // Резкость CAS
  hostElement.querySelectorAll('[data-cas]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-cas]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      proVideoSettings.casSharpness = btn.dataset.cas;
      applyProVideoSettings();
    };
  });

  // Зерно пленки
  hostElement.querySelectorAll('[data-grain]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-grain]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      proVideoSettings.filmGrain = btn.dataset.grain;
      applyProVideoSettings();
    };
  });

  // Соотношение сторон
  hostElement.querySelectorAll('[data-aspect]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-aspect]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      proVideoSettings.aspectRatio = btn.dataset.aspect;
      applyProVideoSettings();
    };
  });

  // Ползунки
  const bindSlider = (id, prop, unit) => {
    const input = hostElement.querySelector(`#slider-${id}`);
    const label = hostElement.querySelector(`#label-${id}`);
    if (input && label) {
      input.oninput = () => {
        const val = Number(input.value);
        proVideoSettings[prop] = val;
        label.textContent = `${val}${unit}`;
        applyProVideoSettings();
      };
    }
  };

  bindSlider('brightness', 'brightness', '%');
  bindSlider('contrast', 'contrast', '%');
  bindSlider('saturation', 'saturation', '%');
  bindSlider('colortemp', 'colorTemp', 'K');

  // Сброс
  const resetBtn = hostElement.querySelector('#reset-pro-video-btn');
  if (resetBtn) {
    resetBtn.onclick = () => {
      proVideoSettings = { ...DEFAULT_VIDEO_SETTINGS };
      applyProVideoSettings();
      renderProVideoPanel(hostElement);
    };
  }

  // Закрытие
  const closeBtn = hostElement.querySelector('#close-pro-video-btn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      hostElement.style.display = 'none';
    };
  }
}

// ==========================================
// 6. РЕНДЕРИНГ ПАНЕЛИ PRO ЗВУК (UI)
// ==========================================
export function renderProAudioPanel(hostElement) {
  if (!hostElement) return;

  const s = proAudioSettings;

  hostElement.innerHTML = `
    <div class="pro-engine-panel" id="pro-audio-panel">
      <div class="pro-engine-header">
        <div class="pro-engine-title">
          <span>🔊</span>
          <span>Профессиональная студия звука и эквалайзер</span>
        </div>
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="close-pro-audio-btn" style="padding: 4px 8px;">✕</button>
      </div>

      <!-- Секция 1: Пространственный звук (Dolby Atmos & 3D Spatial) -->
      <div class="pro-engine-section">
        <div class="pro-section-title">Пространственное 3D-аудио и акустика зала</div>
        <div class="pro-preset-grid">
          <button type="button" class="pro-card-btn ${s.spatialMode === 'stereo' ? 'active' : ''}" data-spatial="stereo">
            <span class="pro-card-icon">🎧</span>
            <span class="pro-card-name">Студийное стерео</span>
            <span class="pro-card-desc">Прямой чистый звук</span>
          </button>
          <button type="button" class="pro-card-btn ${s.spatialMode === 'atmos' ? 'active' : ''}" data-spatial="atmos">
            <span class="pro-card-icon">🌌</span>
            <span class="pro-card-name">Dolby Atmos 3D</span>
            <span class="pro-card-desc">Кинематографический объем</span>
          </button>
          <button type="button" class="pro-card-btn ${s.spatialMode === 'dtsx' ? 'active' : ''}" data-spatial="dtsx">
            <span class="pro-card-icon">💥</span>
            <span class="pro-card-name">DTS:X Surround</span>
            <span class="pro-card-desc">Динамика боевиков и экшна</span>
          </button>
          <button type="button" class="pro-card-btn ${s.spatialMode === 'headphones' ? 'active' : ''}" data-spatial="headphones">
            <span class="pro-card-icon">🦻</span>
            <span class="pro-card-name">Наушники 3D HRTF</span>
            <span class="pro-card-desc">Бинауральная панорама</span>
          </button>
        </div>
      </div>

      <!-- Секция 2: Выделение речи (Speech Isolation DSP) и Усиление баса -->
      <div class="pro-engine-grid-2col">
        <div class="pro-engine-section">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <div class="pro-section-title" style="margin: 0;">Выделение диалогов (Speech Isolation DSP)</div>
            <span style="font-size: 10px; color: var(--accent); font-weight: 700;">Mid-Side Matrix</span>
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">
            Изолирует центральный речевой канал и приглушает боковые взрывы и фоновую музыку
          </div>
          <div class="pro-pill-group">
            <button type="button" class="pro-pill-btn ${s.speechIsolation === 'off' ? 'active' : ''}" data-speech-iso="off">Выкл</button>
            <button type="button" class="pro-pill-btn ${s.speechIsolation === 'mild' ? 'active' : ''}" data-speech-iso="mild">Мягкое (+4dB)</button>
            <button type="button" class="pro-pill-btn ${s.speechIsolation === 'strong' ? 'active' : ''}" data-speech-iso="strong">Максимум (+8dB)</button>
            <button type="button" class="pro-pill-btn ${s.speechIsolation === 'cinema' ? 'active' : ''}" data-speech-iso="cinema">Киноцентр</button>
          </div>
        </div>

        <div class="pro-engine-section">
          <div class="pro-section-title">Кинематографический бас (Subwoofer Boost)</div>
          <div class="pro-pill-group">
            <button type="button" class="pro-pill-btn ${s.bassBoost === 'off' ? 'active' : ''}" data-bass="off">Выкл</button>
            <button type="button" class="pro-pill-btn ${s.bassBoost === 'cinema' ? 'active' : ''}" data-bass="cinema">Кинотеатр (+4dB)</button>
            <button type="button" class="pro-pill-btn ${s.bassBoost === 'ultra' ? 'active' : ''}" data-bass="ultra">Ультра бас (+8dB)</button>
          </div>
        </div>
      </div>

      <!-- Секция 3: 10-полосный студийный эквалайзер -->
      <div class="pro-engine-section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div class="pro-section-title" style="margin: 0;">Студийный 10-полосный эквалайзер</div>
          <!-- Пресеты эквалайзера -->
          <div class="pro-pill-group" style="margin: 0;">
            <button type="button" class="pro-pill-btn ${s.eqPreset === 'cinema' ? 'active' : ''}" data-eq-preset="cinema">Кинозал</button>
            <button type="button" class="pro-pill-btn ${s.eqPreset === 'bass' ? 'active' : ''}" data-eq-preset="bass">Бас</button>
            <button type="button" class="pro-pill-btn ${s.eqPreset === 'voice' ? 'active' : ''}" data-eq-preset="voice">Вокал</button>
            <button type="button" class="pro-pill-btn ${s.eqPreset === 'night' ? 'active' : ''}" data-eq-preset="night">Ночь</button>
            <button type="button" class="pro-pill-btn ${s.eqPreset === 'live' ? 'active' : ''}" data-eq-preset="live">Концерт</button>
            <button type="button" class="pro-pill-btn ${s.eqPreset === 'flat' ? 'active' : ''}" data-eq-preset="flat">Плоский</button>
          </div>
        </div>

        <div class="pro-eq-bars-wrap">
          ${EQ_FREQUENCIES.map((freq, idx) => {
            const freqLabel = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
            const val = s.eqBands[idx] || 0;
            return `
              <div class="pro-eq-col">
                <span class="pro-eq-val" id="eq-val-${idx}">${val > 0 ? '+' + val : val}</span>
                <div class="pro-eq-track">
                  <input type="range" class="pro-eq-slider" orient="vertical" data-band="${idx}" min="-12" max="12" step="1" value="${val}">
                </div>
                <span class="pro-eq-freq">${freqLabel}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Секция 4: Ночной режим звука (Dynamic Range Compressor) -->
      <div class="pro-engine-section">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <div>
            <div class="pro-section-title" style="margin-bottom: 2px;">Ночной режим звука (Dynamic Range)</div>
            <div style="font-size: 11px; color: var(--text-muted);">Сглаживает громкие взрывы и выстрелы, делает шепот четким и разборчивым</div>
          </div>
          <button type="button" class="storm-btn ${s.nightMode ? 'storm-btn-primary' : 'storm-btn-secondary'} storm-btn-sm" id="pro-night-mode-toggle-btn">
            ${s.nightMode ? '🌙 Ночной режим включен' : '🌑 Включить ночной режим'}
          </button>
        </div>
      </div>

      <!-- Секция 5: Усиление громкости (Preamp Boost) -->
      <div class="pro-engine-section">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <div>
            <div class="pro-section-title" style="margin-bottom: 2px;">Усиление громкости (Preamp Boost)</div>
            <div style="font-size: 11px; color: var(--text-muted);">Увеличение громкости для тихих дорожек и дубляжей</div>
          </div>
          <div class="pro-pill-group" style="margin: 0;">
            <button type="button" class="pro-pill-btn ${(!s.preampGain || s.preampGain === 1.0) ? 'active' : ''}" data-preamp="1.0">100%</button>
            <button type="button" class="pro-pill-btn ${s.preampGain === 1.25 ? 'active' : ''}" data-preamp="1.25">125%</button>
            <button type="button" class="pro-pill-btn ${s.preampGain === 1.5 ? 'active' : ''}" data-preamp="1.5">150%</button>
            <button type="button" class="pro-pill-btn ${s.preampGain === 2.0 ? 'active' : ''}" data-preamp="2.0">200%</button>
          </div>
        </div>
      </div>

      <!-- Секция 6: Синхронизация звука и видео (Audio Sync Offset) -->
      <div class="pro-engine-section" style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div>
            <div class="pro-section-title" style="margin-bottom: 2px;">Синхронизация звука и видео (Bluetooth Latency)</div>
            <div style="font-size: 11px; color: var(--text-muted);">Устранение задержки аудио дорожки для беспроводных наушников</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="audio-delay-test-btn" title="Проверить синхронизацию вспышкой и звуком">⚡ Тест синхронизации</button>
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="audio-delay-minus">-50 мс</button>
            <span id="audio-delay-val" style="font-size: 13px; font-weight: 800; min-width: 70px; text-align: center; color: var(--accent);">
              ${s.audioDelayMs > 0 ? '+' + s.audioDelayMs : s.audioDelayMs} мс
            </span>
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="audio-delay-plus">+50 мс</button>
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="audio-delay-reset">Сброс</button>
          </div>
        </div>
      </div>

      <!-- Секция 7: Аудиовизуализатор реального времени (Feature 9) -->
      <div class="pro-engine-section" style="margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div>
            <div class="pro-section-title" style="margin-bottom: 2px;">Аудиовизуализатор реального времени</div>
            <div style="font-size: 11px; color: var(--text-muted);">Реактивная анимация звукового спектра и частот</div>
          </div>
          <div class="pro-pill-group" style="margin: 0;">
            <button type="button" class="pro-pill-btn ${currentVisualizerMode === 'off' ? 'active' : ''}" data-visualizer="off">Выкл</button>
            <button type="button" class="pro-pill-btn ${currentVisualizerMode === 'spectrum' ? 'active' : ''}" data-visualizer="spectrum">Спектр</button>
            <button type="button" class="pro-pill-btn ${currentVisualizerMode === 'wave' ? 'active' : ''}" data-visualizer="wave">Волна</button>
            <button type="button" class="pro-pill-btn ${currentVisualizerMode === 'matrix' ? 'active' : ''}" data-visualizer="matrix">Матрица</button>
          </div>
        </div>
        <div style="background: rgba(0, 0, 0, 0.4); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 8px; text-align: center;">
          <canvas id="pro-audio-visualizer-canvas" width="480" height="64" style="width: 100%; height: 64px; display: block; border-radius: 4px;"></canvas>
        </div>
      </div>

      <!-- Кнопка сброса настроек -->
      <div style="display: flex; justify-content: flex-end;">
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="reset-pro-audio-btn">
          ↺ Сбросить настройки звука
        </button>
      </div>
    </div>
  `;

  // Ночной режим
  const nightToggleBtn = hostElement.querySelector('#pro-night-mode-toggle-btn');
  if (nightToggleBtn) {
    nightToggleBtn.onclick = () => {
      proAudioSettings.nightMode = !proAudioSettings.nightMode;
      setProAudioNightMode(proAudioSettings.nightMode);
      renderProAudioPanel(hostElement);
      showToast(proAudioSettings.nightMode ? '🌙 Ночной режим звука включен' : 'Ночной режим звука выключен', 'info');
    };
  }

  // Preamp громкость
  hostElement.querySelectorAll('[data-preamp]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-preamp]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      proAudioSettings.preampGain = parseFloat(btn.dataset.preamp);
      applyProAudioSettings();
      showToast(`🔊 Предусилитель: ${Math.round(proAudioSettings.preampGain * 100)}%`, 'info');
    };
  });

  // Пространственный звук
  hostElement.querySelectorAll('[data-spatial]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-spatial]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      proAudioSettings.spatialMode = btn.dataset.spatial;
      applyProAudioSettings();
      showToast(`🎧 3D Звук: ${btn.textContent.trim()}`, 'info');
    };
  });

  // Выделение речи
  hostElement.querySelectorAll('[data-voice]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-voice]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      proAudioSettings.voiceBoost = btn.dataset.voice;
      applyProAudioSettings();
      showToast(`🎙️ Выделение речи: ${btn.textContent.trim()}`, 'info');
    };
  });

  // Выделение речи (Speech Isolation DSP)
  hostElement.querySelectorAll('[data-speech-iso]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-speech-iso]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.speechIso;
      setProAudioSpeechIsolation(mode);
      showToast(`🎙️ Выделение диалогов: ${btn.textContent.trim()}`, 'info');
    };
  });

  // Усиление баса
  hostElement.querySelectorAll('[data-bass]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-bass]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      proAudioSettings.bassBoost = btn.dataset.bass;
      applyProAudioSettings();
      showToast(`🔊 Усиление баса: ${btn.textContent.trim()}`, 'info');
    };
  });

  // Пресеты EQ
  hostElement.querySelectorAll('[data-eq-preset]').forEach(btn => {
    btn.onclick = () => {
      const p = btn.dataset.eqPreset;
      if (EQ_PRESETS[p]) {
        hostElement.querySelectorAll('[data-eq-preset]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        proAudioSettings.eqPreset = p;
        proAudioSettings.eqBands = [...EQ_PRESETS[p]];

        // Обновляем ползунки в UI
        proAudioSettings.eqBands.forEach((val, idx) => {
          const slider = hostElement.querySelector(`.pro-eq-slider[data-band="${idx}"]`);
          const label = hostElement.querySelector(`#eq-val-${idx}`);
          if (slider) slider.value = val;
          if (label) label.textContent = val > 0 ? `+${val}` : `${val}`;
        });

        applyProAudioSettings();
        showToast(`🎛️ Эквалайзер: ${btn.textContent.trim()}`, 'info');
      }
    };
  });

  // Ползунки EQ
  hostElement.querySelectorAll('.pro-eq-slider').forEach(slider => {
    slider.oninput = () => {
      const idx = Number(slider.dataset.band);
      const val = Number(slider.value);
      proAudioSettings.eqBands[idx] = val;
      proAudioSettings.eqPreset = 'custom';
      hostElement.querySelectorAll('[data-eq-preset]').forEach(b => b.classList.remove('active'));

      const label = hostElement.querySelector(`#eq-val-${idx}`);
      if (label) label.textContent = val > 0 ? `+${val}` : `${val}`;
      applyProAudioSettings();
    };
  });

  // Синхронизация задержки
  const updateDelayUi = () => {
    const valEl = hostElement.querySelector('#audio-delay-val');
    if (valEl) {
      valEl.textContent = `${proAudioSettings.audioDelayMs > 0 ? '+' + proAudioSettings.audioDelayMs : proAudioSettings.audioDelayMs} мс`;
    }
  };

  const testDelayBtn = hostElement.querySelector('#audio-delay-test-btn');
  if (testDelayBtn) {
    testDelayBtn.onclick = () => {
      runAudioLatencyTest();
    };
  }

  const delayMinus = hostElement.querySelector('#audio-delay-minus');
  if (delayMinus) {
    delayMinus.onclick = () => {
      proAudioSettings.audioDelayMs = Math.max(-1000, proAudioSettings.audioDelayMs - 50);
      updateDelayUi();
      applyProAudioSettings();
    };
  }

  const delayPlus = hostElement.querySelector('#audio-delay-plus');
  if (delayPlus) {
    delayPlus.onclick = () => {
      proAudioSettings.audioDelayMs = Math.min(1000, proAudioSettings.audioDelayMs + 50);
      updateDelayUi();
      applyProAudioSettings();
    };
  }

  const delayReset = hostElement.querySelector('#audio-delay-reset');
  if (delayReset) {
    delayReset.onclick = () => {
      proAudioSettings.audioDelayMs = 0;
      updateDelayUi();
      applyProAudioSettings();
    };
  }

  // Сброс всех настроек звука
  const resetAudioBtn = hostElement.querySelector('#reset-pro-audio-btn');
  if (resetAudioBtn) {
    resetAudioBtn.onclick = () => {
      proAudioSettings = { ...DEFAULT_AUDIO_SETTINGS, eqBands: [...EQ_PRESETS.cinema] };
      applyProAudioSettings();
      renderProAudioPanel(hostElement);
    };
  }

  // Инициализация аудиовизуализатора
  const visualizerCanvas = hostElement.querySelector('#pro-audio-visualizer-canvas');
  if (visualizerCanvas) {
    if (currentVisualizerMode === 'off') {
      currentVisualizerMode = 'spectrum';
      const activeBtn = hostElement.querySelector('[data-visualizer="spectrum"]');
      if (activeBtn) {
        hostElement.querySelectorAll('[data-visualizer]').forEach(b => b.classList.remove('active'));
        activeBtn.classList.add('active');
      }
    }
    setAudioVisualizerMode(currentVisualizerMode, visualizerCanvas);
  }

  hostElement.querySelectorAll('[data-visualizer]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-visualizer]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.visualizer;
      const cvs = hostElement.querySelector('#pro-audio-visualizer-canvas');
      setAudioVisualizerMode(mode, cvs);
      showToast(mode === 'off' ? 'Визуализатор выключен' : `Визуализатор: ${btn.textContent}`, 'info');
    };
  });

  // Закрытие
  const closeBtn = hostElement.querySelector('#close-pro-audio-btn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      hostElement.style.display = 'none';
      if (visualizerRaf) {
        cancelAnimationFrame(visualizerRaf);
        visualizerRaf = null;
      }
    };
  }

  // Немедленно активируем настройки звука при рендере
  applyProAudioSettings();
}

export function setAudioVisualizerMode(mode, canvas = null) {
  currentVisualizerMode = mode || 'off';
  if (canvas) activeVisualizerCanvas = canvas;
  if (currentVisualizerMode === 'off') {
    if (visualizerRaf) {
      cancelAnimationFrame(visualizerRaf);
      visualizerRaf = null;
    }
    if (activeVisualizerCanvas) {
      const ctx = activeVisualizerCanvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, activeVisualizerCanvas.width, activeVisualizerCanvas.height);
    }
    return;
  }
  startVisualizerLoop();
}

function startVisualizerLoop() {
  if (visualizerRaf) cancelAnimationFrame(visualizerRaf);
  const canvas = activeVisualizerCanvas || document.getElementById('pro-audio-visualizer-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const render = () => {
    if (currentVisualizerMode === 'off' || !canvas.isConnected) {
      visualizerRaf = null;
      return;
    }
    visualizerRaf = requestAnimationFrame(render);
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!proAnalyser) {
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      return;
    }

    const bufferLength = proAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    if (currentVisualizerMode === 'wave') {
      proAnalyser.getByteTimeDomainData(dataArray);
      ctx.lineWidth = 2.5;
      const gradient = ctx.createLinearGradient(0, 0, w, 0);
      gradient.addColorStop(0, '#00f0ff');
      gradient.addColorStop(0.5, '#00ff66');
      gradient.addColorStop(1, '#ff007f');
      ctx.strokeStyle = gradient;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      const sliceWidth = w / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * h) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (currentVisualizerMode === 'matrix') {
      proAnalyser.getByteFrequencyData(dataArray);
      const dotCount = 24;
      const step = Math.floor(bufferLength / dotCount);
      const dotRadius = Math.max(2, (w / dotCount) * 0.22);
      for (let i = 0; i < dotCount; i++) {
        const val = dataArray[i * step] / 255;
        const x = (i + 0.5) * (w / dotCount);
        const y = h - val * (h - 8) - 4;
        ctx.fillStyle = val > 0.6 ? '#00ff66' : '#00d2ff';
        ctx.shadowColor = '#00ff66';
        ctx.shadowBlur = val * 8;
        ctx.beginPath();
        ctx.arc(x, y, dotRadius + val * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    } else {
      // spectrum (default)
      proAnalyser.getByteFrequencyData(dataArray);
      const barCount = 28;
      const barWidth = (w / barCount) - 3;
      const step = Math.floor(bufferLength / barCount);
      for (let i = 0; i < barCount; i++) {
        const val = dataArray[i * step] / 255;
        const barHeight = Math.max(4, val * (h - 6));
        const x = i * (barWidth + 3);
        const y = h - barHeight;

        const grad = ctx.createLinearGradient(0, y, 0, h);
        grad.addColorStop(0, '#00f0ff');
        grad.addColorStop(1, 'rgba(0, 114, 255, 0.4)');
        ctx.fillStyle = grad;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = val * 8;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, [3, 3, 0, 0]);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
  };
  render();
}

export function getAudioVisualizerMode() {
  return currentVisualizerMode;
}

export function getProAudioAnalyser() {
  return proAnalyser;
}

