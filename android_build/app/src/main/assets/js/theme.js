/* ==========================================================================
   STORM MULTIMEDIA - МЕНЕДЖЕР 9 ЭТАЛОННЫХ ТЕМ, 13 АКЦЕНТОВ И 10 ШРИФТОВ (STORM AURORA FLUID)
   ========================================================================== */

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

export function setTheme(themeName) {
  if (THEMES.includes(themeName)) {
    currentTheme = themeName;
    document.documentElement.setAttribute('data-theme', themeName);
    safeSetStorage('storm_theme', themeName);

    const profileThemeSelect = document.getElementById('profile-theme-select');
    if (profileThemeSelect && profileThemeSelect.value !== themeName) {
      profileThemeSelect.value = themeName;
    }

    const headerThemeSelect = document.getElementById('header-theme-select');
    if (headerThemeSelect && headerThemeSelect.value !== themeName) {
      headerThemeSelect.value = themeName;
    }

    document.querySelectorAll('.drawer-theme-card, .profile-theme-swatch-card').forEach(card => {
      card.classList.toggle('active', card.dataset.themeName === themeName);
    });
  }
}

export function setAccent(accentName) {
  if (ACCENTS.includes(accentName)) {
    currentAccent = accentName;
    if (accentName === 'default') {
      document.documentElement.removeAttribute('data-accent');
    } else {
      document.documentElement.setAttribute('data-accent', accentName);
    }
    safeSetStorage('storm_accent', accentName);
    const select = document.getElementById('profile-accent-select');
    if (select && select.value !== accentName) select.value = accentName;

    document.querySelectorAll('.profile-accent-dot').forEach(dot => {
      dot.classList.toggle('active', dot.dataset.accent === accentName);
    });
  }
}

export function setFont(fontName) {
  if (FONTS.includes(fontName)) {
    currentFont = fontName;
    document.documentElement.setAttribute('data-font', fontName);
    safeSetStorage('storm_font', fontName);
    const select = document.getElementById('profile-font-select');
    if (select && select.value !== fontName) select.value = fontName;
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
  setTheme(currentTheme);
  setAccent(currentAccent);
  setFont(currentFont);
  setUiScale(currentUiScale);

  const profileThemeSelect = document.getElementById('profile-theme-select');
  if (profileThemeSelect) {
    profileThemeSelect.value = currentTheme;
    profileThemeSelect.addEventListener('change', (e) => {
      setTheme(e.target.value);
      triggerHapticFeedback(12);
    });
  }

  const headerThemeSelect = document.getElementById('header-theme-select');
  if (headerThemeSelect) {
    headerThemeSelect.value = currentTheme;
    headerThemeSelect.addEventListener('change', (e) => {
      setTheme(e.target.value);
      triggerHapticFeedback(12);
    });
  }

  const profileAccentSelect = document.getElementById('profile-accent-select');
  if (profileAccentSelect) {
    profileAccentSelect.value = currentAccent;
    profileAccentSelect.addEventListener('change', (e) => {
      setAccent(e.target.value);
      triggerHapticFeedback(12);
    });
  }

  const profileFontSelect = document.getElementById('profile-font-select');
  if (profileFontSelect) {
    profileFontSelect.value = currentFont;
    profileFontSelect.addEventListener('change', (e) => {
      setFont(e.target.value);
      triggerHapticFeedback(12);
    });
  }

  const profileScaleSelect = document.getElementById('profile-scale-select');
  if (profileScaleSelect) {
    profileScaleSelect.value = currentUiScale;
    profileScaleSelect.addEventListener('change', (e) => {
      setUiScale(e.target.value);
      triggerHapticFeedback(12);
    });
  }

  // Глобальный тактильный отклик (Haptic Feedback) на всех 3D кнопках и элементах управления
  document.addEventListener('pointerdown', (e) => {
    const interactive = e.target && e.target.closest && e.target.closest('button, .storm-btn, .storm-tab-btn, .mobile-bottom-nav-item, .storm-dropdown-trigger, .media-card, .profile-interactive-stat-card');
    if (interactive) {
      triggerHapticFeedback(8);
    }
  }, { passive: true });
}
