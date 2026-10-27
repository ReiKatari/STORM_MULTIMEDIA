/* ==========================================================================
   STORM MULTIMEDIA - МЕНЕДЖЕР 10 ЭТАЛОННЫХ ТЕМ, 13 АКЦЕНТОВ И 10 ШРИФТОВ (STORM AURORA FLUID)
   ========================================================================== */

import { trackClientAction } from './achievements.js?v=1.2.7';

export const THEMES = [
  'STORM MIDNIGHT',
  'STORM NIGHT',
  'STORM DARK',
  'STORM DAY',
  'STORM FANTASY',
  'STORM CYBERPUNK',
  'STORM WARHAMMER 40K',
  'STORM ELEMENTAL',
  'STORM',
  'STORM MATRIX'
];

export const THEME_META_COLORS = {
  'STORM MIDNIGHT': '#a855f7',
  'STORM NIGHT': '#00f0ff',
  'STORM DARK': '#00d2ff',
  'STORM DAY': '#0284c7',
  'STORM FANTASY': '#f59e0b',
  'STORM CYBERPUNK': '#ff007f',
  'STORM WARHAMMER 40K': '#d4af37',
  'STORM ELEMENTAL': '#14b8a6',
  'STORM': '#e11d48',
  'STORM MATRIX': '#00ff66'
};

export const ACCENTS = [
  'default',
  'violet',
  'cyan',
  'blue',
  'indigo',
  'teal',
  'emerald',
  'lime',
  'amber',
  'orange',
  'crimson',
  'rose',
  'magenta',
  'platinum'
];

export const ACCENT_META_COLORS = {
  violet: '#8b5cf6',
  cyan: '#06b6d4',
  blue: '#3b82f6',
  indigo: '#6366f1',
  teal: '#14b8a6',
  emerald: '#10b981',
  lime: '#84cc16',
  amber: '#f59e0b',
  orange: '#f97316',
  crimson: '#ef4444',
  rose: '#f43f5e',
  magenta: '#ec4899',
  platinum: '#e2e8f0'
};

export const FONTS = [
  'Inter',
  'PlusJakartaSans',
  'GeistSans',
  'Manrope',
  'Outfit',
  'Montserrat',
  'Rubik',
  'Orbitron',
  'JetBrainsMono',
  'FiraCode'
];

function safeGetStorage(key, fallback = '') {
  try {
    return localStorage.getItem(key) || fallback;
  } catch (_) {
    return fallback;
  }
}

function safeSetStorage(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch (_) {}
}

let currentTheme = safeGetStorage('storm_theme', 'STORM MIDNIGHT');
let currentAccent = safeGetStorage('storm_accent', 'default');
let currentFont = safeGetStorage('storm_font', 'Inter');
let currentUiScale = safeGetStorage('storm_ui_scale', '1');
let _delegatedListenersBound = false;

export function getTheme() {
  return currentTheme;
}

export function getAccent() {
  return currentAccent;
}

export function getFont() {
  return currentFont;
}

export function getUiScale() {
  return currentUiScale;
}

function updateMetaThemeColor() {
  try {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    if (currentAccent && currentAccent !== 'default' && ACCENT_META_COLORS[currentAccent]) {
      meta.setAttribute('content', ACCENT_META_COLORS[currentAccent]);
    } else {
      meta.setAttribute('content', THEME_META_COLORS[currentTheme] || '#a855f7');
    }
  } catch (_) {}
}

function recordThemeHistoryAndAchievement(themeName) {
  try {
    const rawSingle = safeGetStorage('storm_theme_history', '[]');
    const rawPlural = safeGetStorage('storm_themes_history', '[]');
    const listA = JSON.parse(rawSingle || '[]');
    const listB = JSON.parse(rawPlural || '[]');
    const merged = Array.from(new Set([...(Array.isArray(listA) ? listA : []), ...(Array.isArray(listB) ? listB : []), themeName])).filter(Boolean);
    const jsonStr = JSON.stringify(merged);
    safeSetStorage('storm_theme_history', jsonStr);
    safeSetStorage('storm_themes_history', jsonStr);
    trackClientAction('switch_theme', { themes_count: merged.length, theme: themeName });
  } catch (_) {}
}

export function syncThemeControlsUI(themeName = currentTheme) {
  const profileThemeSelect = document.getElementById('profile-theme-select');
  if (profileThemeSelect && profileThemeSelect.value !== themeName) {
    profileThemeSelect.value = themeName;
  }

  const headerThemeSelect = document.getElementById('header-theme-select');
  if (headerThemeSelect && headerThemeSelect.value !== themeName) {
    headerThemeSelect.value = themeName;
  }

  document.querySelectorAll('.profile-theme-swatch-card, .drawer-theme-card').forEach(card => {
    const cardTheme = card.getAttribute('data-theme-swatch') || card.getAttribute('data-drawer-theme') || card.dataset.themeName;
    const isMatch = cardTheme === themeName;
    card.classList.toggle('is-active', isMatch);
    card.classList.toggle('active', isMatch);
    card.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
  });
}

export function syncAccentControlsUI(accentName = currentAccent) {
  const select = document.getElementById('profile-accent-select');
  if (select && select.value !== accentName) {
    select.value = accentName;
  }

  document.querySelectorAll('.profile-accent-dot').forEach(dot => {
    const dotAccent = dot.getAttribute('data-accent-dot') || dot.dataset.accent;
    const isMatch = dotAccent === accentName;
    dot.classList.toggle('is-active', isMatch);
    dot.classList.toggle('active', isMatch);
    dot.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
  });
}

export function setTheme(themeName, options = {}) {
  if (!THEMES.includes(themeName)) return;
  const prevTheme = currentTheme;
  currentTheme = themeName;
  document.documentElement.setAttribute('data-theme', themeName);
  safeSetStorage('storm_theme', themeName);

  // Если пользователь вручную переключает тему, сбрасываем кастомный акцент на фирменный акцент выбранной темы,
  // чтобы палитра новой темы отображалась на 100% аутентично
  if (options.fromUser && currentAccent !== 'default') {
    currentAccent = 'default';
    document.documentElement.removeAttribute('data-accent');
    safeSetStorage('storm_accent', 'default');
    syncAccentControlsUI('default');
  }

  syncThemeControlsUI(themeName);
  updateMetaThemeColor();

  if (options.fromUser || prevTheme !== themeName) {
    recordThemeHistoryAndAchievement(themeName);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('storm:theme-changed', { detail: { theme: themeName, accent: currentAccent } }));
  }
}

export function setAccent(accentName, options = {}) {
  const cleanAccent = ACCENTS.includes(accentName) ? accentName : 'default';
  currentAccent = cleanAccent;
  if (cleanAccent === 'default') {
    document.documentElement.removeAttribute('data-accent');
  } else {
    document.documentElement.setAttribute('data-accent', cleanAccent);
  }
  safeSetStorage('storm_accent', cleanAccent);
  syncAccentControlsUI(cleanAccent);
  updateMetaThemeColor();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('storm:accent-changed', { detail: { accent: cleanAccent, theme: currentTheme, fromUser: Boolean(options.fromUser) } }));
  }
}

export function setFont(fontName) {
  if (FONTS.includes(fontName)) {
    currentFont = fontName;
    document.documentElement.setAttribute('data-font', fontName);
    safeSetStorage('storm_font', fontName);
    const select = document.getElementById('profile-font-select');
    if (select && select.value !== fontName) select.value = fontName;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('storm:font-changed', { detail: { font: fontName } }));
    }
  }
}

export function setUiScale(scaleVal) {
  const num = parseFloat(scaleVal);
  if (!isNaN(num) && num >= 0.75 && num <= 2.0) {
    currentUiScale = String(num);
    document.documentElement.style.setProperty('--storm-ui-scale', currentUiScale);
    safeSetStorage('storm_ui_scale', currentUiScale);
    const select = document.getElementById('profile-scale-select');
    if (select && select.value !== currentUiScale) select.value = currentUiScale;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('storm:scale-changed', { detail: { scale: currentUiScale } }));
    }
  }
}

export function triggerHapticFeedback(intensity = 10) {
  try {
    if (window.StormNativeApp && typeof window.StormNativeApp.hapticFeedback === 'function') {
      window.StormNativeApp.hapticFeedback();
      return;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(intensity);
    }
  } catch (_) {}
}

export function initTheme() {
  setTheme(currentTheme, { fromUser: false });
  setAccent(currentAccent, { fromUser: false });
  setFont(currentFont);
  setUiScale(currentUiScale);

  // Записываем стартовую тему в историю тем (минимум 1 тема)
  try {
    const raw = safeGetStorage('storm_theme_history', '[]');
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed) || parsed.length === 0) {
      safeSetStorage('storm_theme_history', JSON.stringify([currentTheme]));
      safeSetStorage('storm_themes_history', JSON.stringify([currentTheme]));
    }
  } catch (_) {}

  if (!_delegatedListenersBound && typeof document !== 'undefined') {
    _delegatedListenersBound = true;

    // Глобальный делегированный обработчик кликов по карточкам тем и точкам акцентов
    document.addEventListener('click', (e) => {
      const swatchBtn = e.target?.closest?.('.profile-theme-swatch-card');
      if (swatchBtn) {
        const tName = swatchBtn.getAttribute('data-theme-swatch') || swatchBtn.dataset.themeName;
        if (tName && THEMES.includes(tName)) {
          setTheme(tName, { fromUser: true });
          triggerHapticFeedback(12);
          import('./auth.js?v=1.2.7').then(m => m.showToast?.(`🎨 Тема оформления: ${tName}`, 'info')).catch(() => {});
        }
        return;
      }

      const drawerCard = e.target?.closest?.('.drawer-theme-card');
      if (drawerCard) {
        const tName = drawerCard.getAttribute('data-drawer-theme') || drawerCard.dataset.themeName;
        if (tName && THEMES.includes(tName)) {
          setTheme(tName, { fromUser: true });
          triggerHapticFeedback(12);
          import('./auth.js?v=1.2.7').then(m => m.showToast?.(`🎨 Тема оформления: ${tName}`, 'info')).catch(() => {});
        }
        return;
      }

      const accentDot = e.target?.closest?.('.profile-accent-dot');
      if (accentDot) {
        const aName = accentDot.getAttribute('data-accent-dot') || accentDot.dataset.accent;
        if (aName && ACCENTS.includes(aName)) {
          setAccent(aName, { fromUser: true });
          triggerHapticFeedback(12);
          const label = accentDot.getAttribute('title') || aName;
          import('./auth.js?v=1.2.7').then(m => m.showToast?.(`✨ Акцент подсветки: ${label}`, 'info')).catch(() => {});
        }
      }
    });

    // Глобальный тактильный отклик (Haptic Feedback) на всех 3D кнопках и элементах управления
    document.addEventListener('pointerdown', (e) => {
      const interactive = e.target && e.target.closest && e.target.closest('button, .storm-btn, .storm-tab-btn, .mobile-bottom-nav-item, .storm-dropdown-trigger, .media-card, .profile-interactive-stat-card');
      if (interactive) {
        triggerHapticFeedback(8);
      }
    }, { passive: true });
  }
}
