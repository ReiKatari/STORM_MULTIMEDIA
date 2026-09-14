/* ==========================================================================
   STORM MULTIMEDIA - СИСТЕМА АНИМИРОВАННЫХ ИКОНОК СТАТУСОВ
   Современные, насыщенные, векторные SVG-иконки с неоновыми градиентами
   ========================================================================== */

export const STATUS_LIST = [
  { id: 'planned', name: 'В планах', label: 'В планах', color: '#a855f7', glow: 'rgba(168, 85, 247, 0.6)' },
  { id: 'watching', name: 'Смотрю', label: 'Смотрю', color: '#00f0ff', glow: 'rgba(0, 240, 255, 0.6)' },
  { id: 'completed', name: 'Просмотрено', label: 'Просмотрено', color: '#10b981', glow: 'rgba(16, 185, 129, 0.6)' },
  { id: 'favorite', name: 'Любимое', label: 'Любимое', color: '#ff007f', glow: 'rgba(255, 0, 127, 0.6)' },
  { id: 'on_hold', name: 'Отложено', label: 'Отложено', color: '#f59e0b', glow: 'rgba(245, 158, 11, 0.6)' },
  { id: 'dropped', name: 'Заброшено', label: 'Заброшено', color: '#ef4444', glow: 'rgba(239, 68, 68, 0.6)' },
  { id: 'wont_watch', name: 'Не буду смотреть', label: 'Не буду смотреть', color: '#64748b', glow: 'rgba(100, 116, 139, 0.5)' }
];

export function normalizeStatus(status) {
  if (!status) return 'not_started';
  const s = String(status).toLowerCase();
  if (s === 'plan') return 'planned';
  if (s === 'hold') return 'on_hold';
  if (s === 'watched') return 'completed';
  return s;
}

export function getStatusLabel(status) {
  const norm = normalizeStatus(status);
  const labels = {
    planned: 'В планах',
    watching: 'Смотрю',
    completed: 'Просмотрено',
    favorite: 'Любимое',
    on_hold: 'Отложено',
    dropped: 'Заброшено',
    wont_watch: 'Не буду смотреть',
    not_started: 'Не начат'
  };
  return labels[norm] || 'Статус';
}

let iconUid = 0;

/**
 * Генерирует ультра-современную насыщенную анимированную SVG-иконку статуса
 */
export function getStatusIconSvg(status, { size = 16, animated = true, className = '' } = {}) {
  const norm = normalizeStatus(status);
  const uid = ++iconUid;
  const animClass = animated ? 'storm-status-anim' : '';
  const fullClass = `storm-status-svg storm-status-${norm} ${animClass} ${className}`.trim();

  switch (norm) {
    case 'watching':
      // Неоновый бирюзовый радар / Play с пульсирующей волной
      return `
        <svg class="${fullClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="st-grad-watching-${uid}" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#00f0ff" />
              <stop offset="100%" stop-color="#0284c7" />
            </linearGradient>
            <filter id="st-glow-watching-${uid}" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#00f0ff" flood-opacity="0.8" />
            </filter>
          </defs>
          <circle class="storm-svg-radar" cx="12" cy="12" r="9" stroke="url(#st-grad-watching-${uid})" stroke-width="2" stroke-opacity="0.5" />
          <circle cx="12" cy="12" r="9" fill="url(#st-grad-watching-${uid})" fill-opacity="0.18" />
          <polygon class="storm-svg-play" points="10,8 17,12 10,16" fill="url(#st-grad-watching-${uid})" filter="url(#st-glow-watching-${uid})" />
        </svg>
      `.trim();

    case 'planned':
      // Аметистово-фиолетовая закладка со светящимся кристаллом
      return `
        <svg class="${fullClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="st-grad-planned-${uid}" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#c084fc" />
              <stop offset="100%" stop-color="#7c3aed" />
            </linearGradient>
            <filter id="st-glow-planned-${uid}" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#a855f7" flood-opacity="0.75" />
            </filter>
          </defs>
          <path class="storm-svg-bookmark" d="M6 3C4.89543 3 4 3.89543 4 5V21L12 16.5L20 21V5C20 3.89543 19.1046 3 18 3H6Z" fill="url(#st-grad-planned-${uid})" filter="url(#st-glow-planned-${uid})" />
          <path d="M9 8H15M9 11H13" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      `.trim();

    case 'completed':
      // Насыщенный изумрудный щит с неоновой галочкой
      return `
        <svg class="${fullClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="st-grad-completed-${uid}" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#34d399" />
              <stop offset="100%" stop-color="#059669" />
            </linearGradient>
            <filter id="st-glow-completed-${uid}" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#10b981" flood-opacity="0.8" />
            </filter>
          </defs>
          <circle cx="12" cy="12" r="10" fill="url(#st-grad-completed-${uid})" filter="url(#st-glow-completed-${uid})" />
          <path class="storm-svg-check" d="M7 12.5L10.5 16L17 8.5" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      `.trim();

    case 'favorite':
      // Неоновое рубиновое пульсирующее сердце
      return `
        <svg class="${fullClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="st-grad-favorite-${uid}" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#ff1a8c" />
              <stop offset="100%" stop-color="#dc2626" />
            </linearGradient>
            <filter id="st-glow-favorite-${uid}" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="2.5" flood-color="#ff007f" flood-opacity="0.85" />
            </filter>
          </defs>
          <path class="storm-svg-heart" d="M12 21.35L10.55 20.03C5.4 15.36 2 12.28 2 8.5C2 5.42 4.42 3 7.5 3C9.24 3 10.91 3.81 12 5.09C13.09 3.81 14.76 3 16.5 3C19.58 3 22 5.42 22 8.5C22 12.28 18.6 15.36 13.45 20.04L12 21.35Z" fill="url(#st-grad-favorite-${uid})" filter="url(#st-glow-favorite-${uid})" />
        </svg>
      `.trim();

    case 'on_hold':
      // Янтарные светящиеся капсулы паузы / ожидания
      return `
        <svg class="${fullClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="st-grad-hold-${uid}" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#fbbf24" />
              <stop offset="100%" stop-color="#d97706" />
            </linearGradient>
            <filter id="st-glow-hold-${uid}" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#f59e0b" flood-opacity="0.8" />
            </filter>
          </defs>
          <circle cx="12" cy="12" r="10" fill="url(#st-grad-hold-${uid})" fill-opacity="0.2" stroke="url(#st-grad-hold-${uid})" stroke-width="2" />
          <rect class="storm-svg-pause-bar" x="9" y="8" width="2.4" height="8" rx="1.2" fill="url(#st-grad-hold-${uid})" filter="url(#st-glow-hold-${uid})" />
          <rect class="storm-svg-pause-bar" x="13.6" y="8" width="2.4" height="8" rx="1.2" fill="url(#st-grad-hold-${uid})" filter="url(#st-glow-hold-${uid})" />
        </svg>
      `.trim();

    case 'dropped':
      // Огненно-красный стоп-шестиугольник с неоновым крестом
      return `
        <svg class="${fullClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="st-grad-dropped-${uid}" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#f87171" />
              <stop offset="100%" stop-color="#dc2626" />
            </linearGradient>
            <filter id="st-glow-dropped-${uid}" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#ef4444" flood-opacity="0.8" />
            </filter>
          </defs>
          <path d="M7.86 2H16.14L22 7.86V16.14L16.14 22H7.86L2 16.14V7.86L7.86 2Z" fill="url(#st-grad-dropped-${uid})" filter="url(#st-glow-dropped-${uid})" />
          <path class="storm-svg-cross" d="M9 9L15 15M15 9L9 15" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" />
        </svg>
      `.trim();

    case 'wont_watch':
    case 'not_started':
    default:
      // Графитовый технологичный индикатор
      return `
        <svg class="${fullClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="st-grad-wont-${uid}" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#94a3b8" />
              <stop offset="100%" stop-color="#475569" />
            </linearGradient>
          </defs>
          <circle cx="12" cy="12" r="9" stroke="url(#st-grad-wont-${uid})" stroke-width="2" stroke-dasharray="3 3" />
          <circle cx="12" cy="12" r="3.5" fill="url(#st-grad-wont-${uid})" />
        </svg>
      `.trim();
  }
}
