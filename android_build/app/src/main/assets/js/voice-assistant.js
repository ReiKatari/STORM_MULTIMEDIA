/* ==========================================================================
   STORM MULTIMEDIA - ГОЛОСОВОЙ КИБЕР-АССИСТЕНТ И ПОИСК
   Распознавание команд через Web Speech API и голосовые ответы
   ========================================================================== */

import { showToast } from './auth.js';
import { trackClientAction } from './achievements.js';

let recognition = null;
let isListening = false;
let onSearchCallback = null;
let onTabSwitchCallback = null;
let onThemeSwitchCallback = null;
let onRandomMediaCallback = null;

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
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    updateMicButtonState(true);
    showToast('🎙️ Голосовой ассистент слушает команду...', 'info');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    showToast(`Распознано: «${transcript}»`, 'info');
    processVoiceCommand(transcript);
  };

  recognition.onerror = (event) => {
    console.error('Ошибка распознавания речи:', event.error);
    isListening = false;
    updateMicButtonState(false);
    if (event.error === 'not-allowed') {
      showToast('Доступ к микрофону заблокирован в браузере', 'warning');
    }
  };

  recognition.onend = () => {
    isListening = false;
    updateMicButtonState(false);
  };

  return true;
}

export function toggleVoiceListening() {
  if (!recognition) {
    showToast('Голосовое управление не поддерживается вашим браузером', 'warning');
    return;
  }

  if (isListening) {
    recognition.stop();
  } else {
    try {
      recognition.start();
      trackClientAction('use_voice');
    } catch (err) {
      console.error('Ошибка запуска микрофона:', err);
    }
  }
}

export function speakResponse(text) {
  if (!window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU';
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Игнорируем ошибки синтезатора
  }
}

function processVoiceCommand(rawText) {
  const text = rawText.toLowerCase().trim();

  // 1. Поиск: «найди [название]», «ищи [название]», «поиск [название]»
  const searchMatch = text.match(/^(?:найди|ищи|поиск|включи поиск|найти)\s+(.+)$/);
  if (searchMatch) {
    const query = searchMatch[1].trim();
    speakResponse(`Ищу ${query}`);
    if (onSearchCallback) onSearchCallback(query);
    return;
  }

  // 2. Навигация по вкладкам: «новинки», «фильмы», «сериалы», «мультфильмы», «аниме», «закладки»
  if (text.includes('новинк')) {
    speakResponse('Открываю новинки');
    if (onTabSwitchCallback) onTabSwitchCallback('new');
    return;
  }
  if (text.includes('фильм') && !text.includes('аниме')) {
    speakResponse('Перехожу в каталог фильмов');
    if (onTabSwitchCallback) onTabSwitchCallback('movies');
    return;
  }
  if (text.includes('сериал') && !text.includes('мульт') && !text.includes('аниме')) {
    speakResponse('Открываю сериалы');
    if (onTabSwitchCallback) onTabSwitchCallback('series');
    return;
  }
  if (text.includes('мультсериал')) {
    speakResponse('Открываю мультсериалы');
    if (onTabSwitchCallback) onTabSwitchCallback('cartoon-series');
    return;
  }
  if (text.includes('мультфильм') || text.includes('мультик')) {
    speakResponse('Перехожу в мультфильмы');
    if (onTabSwitchCallback) onTabSwitchCallback('cartoons');
    return;
  }
  if (text.includes('аниме фильм') || text.includes('полнометражное аниме')) {
    speakResponse('Открываю аниме-фильмы');
    if (onTabSwitchCallback) onTabSwitchCallback('anime-movies');
    return;
  }
  if (text.includes('аниме')) {
    speakResponse('Перехожу в раздел аниме');
    if (onTabSwitchCallback) onTabSwitchCallback('anime-series');
    return;
  }
  if (text.includes('закладк') || text.includes('списк') || text.includes('коллекци')) {
    speakResponse('Открываю ваши списки и закладки');
    if (onTabSwitchCallback) onTabSwitchCallback('bookmarks');
    return;
  }
  if (text.includes('продолжить') || text.includes('истори')) {
    speakResponse('Открываю продолжить просмотр');
    if (onTabSwitchCallback) onTabSwitchCallback('continue');
    return;
  }
  if (text.includes('главн') || text.includes('домой')) {
    speakResponse('Перехожу на главную');
    if (onTabSwitchCallback) onTabSwitchCallback('home');
    return;
  }

  // 3. Темы оформления
  if (text.includes('киберпанк')) {
    speakResponse('Включаю тему Неон Найт-Сити');
    if (onThemeSwitchCallback) onThemeSwitchCallback('STORM CYBERPUNK');
    return;
  }
  if (text.includes('матриц')) {
    speakResponse('Включаю Матричный зеленый');
    if (onThemeSwitchCallback) onThemeSwitchCallback('STORM MATRIX');
    return;
  }
  if (text.includes('вархаммер') || text.includes('готик')) {
    speakResponse('Активирую тему Вархаммер 40К');
    if (onThemeSwitchCallback) onThemeSwitchCallback('STORM WARHAMMER 40K');
    return;
  }
  if (text.includes('ночн') || text.includes('олед') || text.includes('черн')) {
    speakResponse('Включаю Черный OLED');
    if (onThemeSwitchCallback) onThemeSwitchCallback('STORM NIGHT');
    return;
  }
  if (text.includes('светл') || text.includes('день')) {
    speakResponse('Включаю светлую тему');
    if (onThemeSwitchCallback) onThemeSwitchCallback('STORM DAY');
    return;
  }
  if (text.includes('аметист') || text.includes('фиолетов')) {
    speakResponse('Включаю Аметистовую ночь');
    if (onThemeSwitchCallback) onThemeSwitchCallback('STORM MIDNIGHT');
    return;
  }
  if (text.includes('золот') || text.includes('фэнтези')) {
    speakResponse('Включаю Королевское золото');
    if (onThemeSwitchCallback) onThemeSwitchCallback('STORM FANTASY');
    return;
  }
  if (text.includes('темн') || text.includes('стандартн')) {
    speakResponse('Включаю Темный кибер');
    if (onThemeSwitchCallback) onThemeSwitchCallback('STORM DARK');
    return;
  }

  // 4. Случайный выбор
  if (text.includes('случайн') || text.includes('рандом')) {
    speakResponse('Выбираю случайный релиз');
    if (onRandomMediaCallback) onRandomMediaCallback();
    return;
  }

  // Если команда не распознана как специальная, выполняем поиск по всей фразе
  speakResponse(`Ищу ${text}`);
  if (onSearchCallback) onSearchCallback(text);
}

function updateMicButtonState(active) {
  const btn = document.getElementById('voice-search-btn');
  if (btn) {
    btn.classList.toggle('is-listening', active);
    btn.title = active ? 'Голосовой ассистент слушает... Нажмите для отмены' : 'Голосовой поиск и команды';
  }
}
