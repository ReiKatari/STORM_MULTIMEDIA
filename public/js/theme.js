/* ==========================================================================
   STORM MULTIMEDIA - МЕНЕДЖЕР 8 ЭТАЛОННЫХ ТЕМ ОФОРМЛЕНИЯ
   ========================================================================== */

export const THEMES = [
  'STORM DARK',
  'STORM NIGHT',
  'STORM DAY',
  'STORM MIDNIGHT',
  'STORM MATRIX',
  'STORM CYBERPUNK',
  'STORM FANTASY',
  'STORM WARHAMMER 40K'
];

let currentTheme = localStorage.getItem('storm_theme') || 'STORM DARK';

export function getTheme() {
  return currentTheme;
}

export function setTheme(themeName) {
  if (THEMES.includes(themeName)) {
    currentTheme = themeName;
    document.documentElement.setAttribute('data-theme', themeName);
    localStorage.setItem('storm_theme', themeName);

    const themeSelect = document.getElementById('header-theme-select');
    if (themeSelect && themeSelect.value !== themeName) {
      themeSelect.value = themeName;
    }
  }
}

export function initTheme() {
  setTheme(currentTheme);

  const themeSelect = document.getElementById('header-theme-select');
  if (themeSelect) {
    themeSelect.value = currentTheme;
    themeSelect.addEventListener('change', (e) => {
      setTheme(e.target.value);
    });
  }
}
