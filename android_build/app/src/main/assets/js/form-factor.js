/* ==========================================================================
   STORM MULTIMEDIA - АДАПТИВНЫЙ ТРИУМВИРАТ ИНТЕРФЕЙСОВ
   (ADAPTIVE FORM FACTOR ENGINE: DESKTOP, MOBILE TOUCH, 10-FOOT TV)
   ========================================================================== */

import { toggleTvMode } from './gamepad-tv.js';
import { showToast } from './auth.js';

let currentProfile = 'auto'; // 'auto', 'desktop', 'mobile', 'tv'
let activeEffectiveProfile = 'desktop';

export function detectNativeDeviceType() {
  const ua = (navigator.userAgent || '').toLowerCase();
  const isTv = /smart[-_]?tv|googletv|appletv|android tv|tizen|web0s|netcast|viera|roku|firetv|pov_tv|hbbtv/i.test(ua);
  if (isTv) return 'tv';

  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const isNarrow = window.innerWidth <= 768;
  const isPhoneOrTablet = isTouch && (isNarrow || window.innerHeight > window.innerWidth);
  if (isPhoneOrTablet) return 'mobile';

  return 'desktop';
}

export function getCurrentEffectiveProfile() {
  return activeEffectiveProfile;
}

export function setFormFactorProfile(profile, showNotification = true) {
  currentProfile = profile;
  localStorage.setItem('storm_form_factor', profile);

  if (profile === 'auto') {
    activeEffectiveProfile = detectNativeDeviceType();
  } else {
    activeEffectiveProfile = profile;
  }

  applyEffectiveProfile(activeEffectiveProfile, showNotification);
}

function applyEffectiveProfile(effective, notify = false) {
  document.body.classList.remove('form-factor-desktop', 'form-factor-mobile', 'form-factor-tv');
  document.body.classList.add(`form-factor-${effective}`);

  // Синхронизируем состояние ТВ-режима (10-foot Leanback)
  if (effective === 'tv') {
    toggleTvMode(true);
  } else {
    toggleTvMode(false);
  }

  // Обновляем бейджи и кнопки в интерфейсе
  updateSwitcherButtonUI(effective);

  if (notify) {
    const labels = {
      desktop: '🖥️ Активирован режим ПК (Высокая плотность и горячие клавиши)',
      mobile: '📱 Активирован режим Смартфона (Сенсорный интерфейс и шторки)',
      tv: '📺 Активирован режим Smart TV (10-Foot Leanback и пространственный фокус)'
    };
    showToast(labels[effective] || 'Режим интерфейса обновлен', 'info');
  }
}

function updateSwitcherButtonUI(effective) {
  const btn = document.getElementById('form-factor-switcher-btn');
  const iconEl = document.getElementById('form-factor-icon');
  const labelEl = document.getElementById('form-factor-label');

  const icons = { desktop: '🖥️', mobile: '📱', tv: '📺' };
  const labels = { desktop: 'ПК', mobile: 'Мобильный', tv: 'ТВ-режим' };

  if (iconEl) iconEl.textContent = icons[effective] || '🖥️';
  if (labelEl) labelEl.textContent = labels[effective] || 'ПК';
  if (btn) btn.title = `Текущий профиль: ${labels[effective]} (нажмите для смены)`;

  const tvBtn = document.getElementById('toggle-tv-mode-btn');
  if (tvBtn && effective !== 'tv') {
    tvBtn.classList.remove('active');
  }
}

export function openFormFactorModal() {
  let modal = document.getElementById('form-factor-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'form-factor-modal';
    modal.innerHTML = `
      <div class="storm-modal form-factor-dialog" style="max-width: 520px;">
        <div class="storm-modal-header">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:22px;">📐</span>
            <h3 style="margin:0;font-size:18px;">Адаптивный триумвират интерфейсов</h3>
          </div>
          <button type="button" class="storm-modal-close" id="form-factor-close-btn">✕</button>
        </div>
        <div class="storm-modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px;">
          <p style="font-size:13px;color:var(--text-secondary);margin:0;line-height:1.5;">
            Выберите оптимизацию интерфейса под ваше устройство или включите автоматическое определение:
          </p>

          <div class="form-factor-options-grid">
            <div class="form-factor-card" data-profile="desktop">
              <div class="form-factor-card-icon">🖥️</div>
              <div class="form-factor-card-title">ПК (Desktop)</div>
              <div class="form-factor-card-desc">Высокая плотность сетки, предпросмотр при наведении, мультиоконность, горячие клавиши <b>/</b> и <b>F</b>.</div>
            </div>

            <div class="form-factor-card" data-profile="mobile">
              <div class="form-factor-card-icon">📱</div>
              <div class="form-factor-card-title">Мобильный (Touch)</div>
              <div class="form-factor-card-desc">Нижняя панель навигации, сенсорные жесты в плеере, крупные кнопки действий, тактильная отдача.</div>
            </div>

            <div class="form-factor-card" data-profile="tv">
              <div class="form-factor-card-icon">📺</div>
              <div class="form-factor-card-title">Smart TV (Leanback)</div>
              <div class="form-factor-card-desc">Крупный 10-foot шрифт, неоновое кольцо пространственного фокуса D-Pad, увеличение карточек scale(1.08).</div>
            </div>

            <div class="form-factor-card" data-profile="auto">
              <div class="form-factor-card-icon">⚡</div>
              <div class="form-factor-card-title">Автоматический режим</div>
              <div class="form-factor-card-desc">Автоподстройка под разрешение экрана, сенсорный ввод и платформу в реальном времени.</div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#form-factor-close-btn')?.addEventListener('click', () => modal.classList.remove('is-open'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('is-open'); });

    modal.querySelectorAll('.form-factor-card').forEach(card => {
      card.addEventListener('click', () => {
        const p = card.dataset.profile;
        setFormFactorProfile(p, true);
        modal.classList.remove('is-open');
      });
    });
  }

  // Подсветка активной карточки
  modal.querySelectorAll('.form-factor-card').forEach(card => {
    const isAct = card.dataset.profile === currentProfile;
    card.classList.toggle('active', isAct);
  });

  modal.classList.add('is-open');
}

export function initFormFactorEngine() {
  const saved = localStorage.getItem('storm_form_factor') || 'auto';
  currentProfile = saved;

  if (saved === 'auto') {
    activeEffectiveProfile = detectNativeDeviceType();
  } else {
    activeEffectiveProfile = saved;
  }

  applyEffectiveProfile(activeEffectiveProfile, false);

  // Слушатель кнопки переключения
  const btn = document.getElementById('form-factor-switcher-btn');
  if (btn) {
    btn.onclick = (e) => {
      e.stopPropagation();
      openFormFactorModal();
    };
  }

  const drawerFactorBtn = document.getElementById('drawer-form-factor-btn');
  if (drawerFactorBtn) {
    drawerFactorBtn.onclick = () => {
      const drawer = document.getElementById('storm-mobile-drawer');
      if (drawer) drawer.classList.remove('is-open');
      openFormFactorModal();
    };
  }

  // Горячие клавиши для режима Desktop
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    // Горячая клавиша '/' — быстрый фокус строки поиска
    if (e.key === '/' && activeEffectiveProfile === 'desktop') {
      e.preventDefault();
      const searchInput = document.getElementById('global-search-input');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }

    // Горячая клавиша 'F' — полноэкранный режим
    if ((e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (document.body.classList.contains('cinema-open') || activeEffectiveProfile === 'desktop') {
        e.preventDefault();
        try {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          } else {
            document.exitFullscreen().catch(() => {});
          }
        } catch {}
      }
    }
  });

  // Автоматическая реакция на изменение ориентации или размера окна в режиме 'auto'
  window.addEventListener('resize', () => {
    if (currentProfile === 'auto') {
      const newEffective = detectNativeDeviceType();
      if (newEffective !== activeEffectiveProfile) {
        activeEffectiveProfile = newEffective;
        applyEffectiveProfile(newEffective, false);
      }
    }
  }, { passive: true });
}
