// =========================================================================
// STORM MULTIMEDIA 1.2.0 — FRONTEND GLOBAL ERROR BOUNDARY (Пункт 6.8)
// Изоляция сбоев отдельных виджетов без падения всего интерфейса
// =========================================================================

(function initStormErrorBoundary() {
  if (window.__STORM_ERROR_BOUNDARY_ACTIVE__) return;
  window.__STORM_ERROR_BOUNDARY_ACTIVE__ = true;

  const errorLogBuffer = [];

  function recordClientError(source, err) {
    const entry = {
      time: new Date().toISOString(),
      source,
      message: String(err?.message || err || 'Unknown Error'),
      stack: String(err?.stack || '').slice(0, 600)
    };
    errorLogBuffer.push(entry);
    if (errorLogBuffer.length > 50) errorLogBuffer.shift();
  }

  window.getStormClientErrorLogs = () => [...errorLogBuffer];

  window.withStormErrorBoundary = async function withStormErrorBoundary(containerEl, taskFn, fallbackTitle = 'Не удалось загрузить блок') {
    try {
      return await taskFn();
    } catch (err) {
      recordClientError(fallbackTitle, err);
      if (containerEl && containerEl instanceof HTMLElement) {
        containerEl.innerHTML = `
          <div class="storm-error-boundary-card" style="padding:18px 22px;margin:12px 0;border-radius:14px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.28);display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
            <div>
              <div style="font-weight:700;color:#f8fafc;font-size:14px;">⚠️ ${fallbackTitle}</div>
              <div style="color:#94a3b8;font-size:12px;margin-top:4px;">Модуль изолирован системой защиты STORM Error Boundary. Остальной интерфейс работает штатно.</div>
            </div>
            <button type="button" class="storm-btn storm-btn-secondary storm-retry-boundary-btn" style="padding:8px 14px;font-size:12px;border-radius:10px;cursor:pointer;">
              🔄 Повторить
            </button>
          </div>
        `;
        const btn = containerEl.querySelector('.storm-retry-boundary-btn');
        if (btn) {
          btn.addEventListener('click', () => {
            withStormErrorBoundary(containerEl, taskFn, fallbackTitle);
          });
        }
      }
      return null;
    }
  };

  window.addEventListener('error', (event) => {
    recordClientError('window.onerror', event?.error || event?.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    recordClientError('unhandledrejection', event?.reason);
  });
})();
