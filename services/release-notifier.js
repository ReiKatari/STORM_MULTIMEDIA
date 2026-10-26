/**
 * STORM MULTIMEDIA 1.2.0 — Диспетчер уведомлений о цифровых релизах и сериях (Пункт 2.9)
 * Поддерживает Web-уведомления и отправку через Telegram Bot API.
 */
import { getAllActiveReleaseSubscriptions, markReleaseSubscriptionNotified } from '../db.js';

export async function dispatchTelegramNotification(chatId, text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!botToken || !chatId || !text) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      }),
      signal: AbortSignal.timeout(4000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function processVerifiedItemsForReleaseSubscriptions(verifiedItems = []) {
  if (!Array.isArray(verifiedItems) || verifiedItems.length === 0) return 0;
  const activeSubs = getAllActiveReleaseSubscriptions();
  if (!activeSubs || activeSubs.length === 0) return 0;

  let notifiedCount = 0;
  for (const sub of activeSubs) {
    const match = verifiedItems.find(it =>
      it &&
      it.stream_verified &&
      !it.is_upcoming &&
      (String(it.id) === String(sub.media_id) ||
       String(it.title || '').toLowerCase() === String(sub.title || '').toLowerCase())
    );
    if (!match) continue;

    const msg = `🎬 Премьера в 4K/FHD доступна: «${sub.title}» уже можно смотреть в STORM MULTIMEDIA!`;
    markReleaseSubscriptionNotified(sub.id, 'released', msg);
    if (sub.notify_telegram && sub.telegram_chat_id) {
      await dispatchTelegramNotification(sub.telegram_chat_id, msg);
    }
    notifiedCount++;
  }
  return notifiedCount;
}

export const checkSubscriptionsAndNotify = processVerifiedItemsForReleaseSubscriptions;
