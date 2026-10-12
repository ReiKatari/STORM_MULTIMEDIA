import fs from 'node:fs';
import { getAggregatedSchedule } from '../services/schedule-service.js';

async function updateData() {
  const cur = await getAggregatedSchedule('current');
  const nxt = await getAggregatedSchedule('next');

  const content = `/* ==========================================================================
   STORM MULTIMEDIA - БАЗОВЫЙ ОФФЛАЙН КЭШ РАСПИСАНИЯ РЕЛИЗОВ
   Мгновенная отрисовка (0 мс) с последующей фоновой синхронизацией
   ========================================================================== */

export const DEFAULT_CURRENT_WEEK = ${JSON.stringify(cur.items, null, 2)};

export const DEFAULT_NEXT_WEEK = ${JSON.stringify(nxt.items, null, 2)};
`;

  fs.writeFileSync('public/js/release-calendar-data.js', content, 'utf8');
  console.log('Successfully updated release-calendar-data.js! Current items:', cur.items.length, 'Next items:', nxt.items.length);
}

updateData().catch(console.error);
