/* ==========================================================================
   STORM MULTIMEDIA - МОДУЛЬ ЗАКЛАДОК, СТАТУСОВ И ПОЛЬЗОВАТЕЛЬСКИХ СПИСКОВ
   ========================================================================== */

import { getToken, showToast } from './auth.js';
import { t } from './i18n.js';

export async function fetchUserBookmarks(status = null, type = null) {
  const token = getToken();
  if (!token) return [];

  let url = '/api/bookmarks';
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (type) params.append('type', type);
  if (params.toString()) url += `?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.error('Ошибка получения закладок:', err);
    return [];
  }
}

export async function saveBookmarkStatus(mediaData, status) {
  const token = getToken();
  if (!token) {
    showToast('Войдите в систему для добавления в закладки', 'info');
    return null;
  }

  if (!status || status === 'none') {
    return await deleteBookmark(mediaData.id, mediaData.source);
  }

  try {
    const res = await fetch('/api/bookmarks/set', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        media_id: mediaData.id,
        source: mediaData.source,
        title: mediaData.title,
        original_title: mediaData.original_title || '',
        poster_url: mediaData.poster || '',
        media_type: mediaData.media_type || 'movie',
        year: mediaData.year || '',
        status: status
      })
    });

    if (!res.ok) throw new Error('Ошибка сохранения закладки');
    const updated = await res.json();
    showToast(t('msg_bookmark_saved'), 'success');
    window.dispatchEvent(new CustomEvent('storm:bookmarks-updated', { detail: { mediaData, status } }));
    return updated;
  } catch (err) {
    showToast(err.message, 'error');
    return null;
  }
}

export async function deleteBookmark(mediaId, source, title = '') {
  const token = getToken();
  if (!token) return false;

  try {
    const res = await fetch('/api/bookmarks/remove', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ media_id: mediaId, source, title })
    });
    if (res.ok) {
      showToast('Удалено из закладок', 'info');
      window.dispatchEvent(new CustomEvent('storm:bookmarks-updated', { detail: { mediaId, source, title, deleted: true } }));
      return { success: true, deleted: true };
    }
    return false;
  } catch (err) {
    showToast('Ошибка удаления закладки', 'error');
    return false;
  }
}

export async function syncWatchProgress(data) {
  const token = getToken();
  if (!token) return;

  try {
    await fetch('/api/media/progress', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });
  } catch (e) {
    // Бесшумное логирование прогресса
  }
}

export async function fetchContinueWatching() {
  const token = getToken();
  if (!token) return [];

  try {
    const res = await fetch('/api/media/continue-watching', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    return [];
  }
}

// -------------------------------------------------------------
// ПОЛЬЗОВАТЕЛЬСКИЕ КОЛЛЕКЦИИ И СПИСКИ
// -------------------------------------------------------------

export async function fetchCustomLists() {
  const token = getToken();
  if (!token) return [];

  try {
    const res = await fetch('/api/custom-lists', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    return [];
  }
}

export async function createCustomCollection(title, description = '', color = '#00d2ff') {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetch('/api/custom-lists/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ title, description, color })
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || 'Ошибка создания списка');
    }
    const newList = await res.json();
    showToast(t('msg_list_created'), 'success');
    return newList;
  } catch (err) {
    showToast(err.message, 'warning');
    return null;
  }
}

export async function addItemToCollection(listId, item) {
  const token = getToken();
  if (!token) return;

  try {
    const res = await fetch(`/api/custom-lists/${listId}/items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        media_id: item.id,
        source: item.source,
        title: item.title,
        poster_url: item.poster,
        media_type: item.media_type,
        year: item.year,
        rating: item.rating
      })
    });

    if (res.ok) {
      showToast(t('msg_added_to_list'), 'success');
    } else {
      const errJson = await res.json().catch(() => ({}));
      showToast(errJson.error || 'Ошибка добавления в список', 'warning');
    }
  } catch (err) {
    showToast(err.message || 'Ошибка добавления в список', 'error');
  }
}

export async function removeItemFromCollection(listId, mediaId, source) {
  const token = getToken();
  if (!token) return;

  try {
    await fetch(`/api/custom-lists/${listId}/items/${mediaId}?source=${source}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    showToast('Удалено из коллекции', 'info');
  } catch (err) {
    showToast('Ошибка при удалении', 'error');
  }
}
