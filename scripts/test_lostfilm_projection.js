import * as cheerio from 'cheerio';

async function testLostFilm(isNext = false) {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + diffToMonday + (isNext ? 7 : 0));
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  weekEnd.setMilliseconds(-1);

  const res = await fetch('https://lostfilm.tv/schedule/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    },
    signal: AbortSignal.timeout(4000)
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  const table = $('table.schedule-list-table');

  const rawEntries = [];
  const latestWeekEntries = [];
  let currentWeekDates = [];

  table.find('tr').each((_, tr) => {
    const $tr = $(tr);
    const ths = $tr.find('th');
    if (ths.length > 0) {
      currentWeekDates = [];
      ths.slice(1, -1).each((idx, th) => {
        const text = $(th).text().replace(/Сегодня/gi, '').trim();
        const m = text.match(/([А-Яа-я]+)\s*(\d{2})\.(\d{2})/);
        if (m) {
          const currentYear = new Date().getFullYear();
          const airDate = new Date(currentYear, parseInt(m[3], 10) - 1, parseInt(m[2], 10), 21, 0, 0);
          const dayOfWeek = (idx + 1) % 7;
          const dateFormatted = `${m[2]}.${m[3]}.${currentYear}`;
          currentWeekDates.push({ airDate, dayOfWeek, dateFormatted, timestamp: airDate.getTime() });
        } else {
          currentWeekDates.push(null);
        }
      });
    } else {
      const tds = $tr.find('td');
      tds.slice(1, -1).each((colIdx, td) => {
        const dateInfo = currentWeekDates[colIdx];
        if (!dateInfo) return;

        const $a = $(td).find('a.title');
        if (!$a.length) return;

        const href = $a.attr('href') || '';
        const fullHtml = $a.html() || '';
        const title = fullHtml.split(/<br\s*\/?>/i)[0].replace(/<[^>]+>/g, '').trim();
        if (!title) return;

        const spanText = $a.find('span').text().trim();
        let season = 1;
        let episode = 1;
        let episodeStr = 'Новая серия';
        const epMatch = spanText.match(/(\d+)[xх](\d+)/i);
        if (epMatch) {
          season = parseInt(epMatch[1], 10);
          episode = parseInt(epMatch[2], 10);
          episodeStr = `Сезон ${season}, Серия ${episode}`;
        }

        let slug = '';
        let origTitle = '';
        const slugMatch = href.match(/\/series\/([^\/]+)/i) || href.match(/\/movies\/([^\/]+)/i);
        if (slugMatch) {
          slug = slugMatch[1];
          origTitle = slug.replace(/_/g, ' ').trim();
        }

        const isMovie = href.includes('/movies/');
        const entry = {
          title,
          original_title: origTitle,
          slug,
          season,
          episode,
          episodeStr,
          dayOfWeek: dateInfo.dayOfWeek,
          dateFormatted: dateInfo.dateFormatted,
          timestamp: dateInfo.timestamp,
          airDate: dateInfo.airDate,
          isMovie
        };

        latestWeekEntries.push(entry);

        if (dateInfo.airDate.getTime() >= weekStart.getTime() && dateInfo.airDate.getTime() <= weekEnd.getTime()) {
          rawEntries.push(entry);
        }
      });
    }
  });

  if (rawEntries.length === 0 && isNext && latestWeekEntries.length > 0) {
    // Project ongoing series to next week
    const seen = new Set();
    latestWeekEntries.forEach(it => {
      if (it.isMovie || seen.has(it.title)) return;
      seen.add(it.title);

      const epDate = new Date(weekStart);
      const dayOffset = (it.dayOfWeek === 0 ? 6 : it.dayOfWeek - 1);
      epDate.setDate(weekStart.getDate() + dayOffset);
      epDate.setHours(21, 0, 0, 0);

      const dateFormatted = `${String(epDate.getDate()).padStart(2, '0')}.${String(epDate.getMonth() + 1).padStart(2, '0')}.${epDate.getFullYear()}`;
      rawEntries.push({
        title: it.title,
        original_title: it.original_title,
        slug: it.slug,
        season: it.season,
        episode: it.episode + 1,
        episodeStr: `Сезон ${it.season}, Серия ${it.episode + 1} (Анонс)`,
        dayOfWeek: it.dayOfWeek,
        dateFormatted,
        timestamp: epDate.getTime(),
        airDate: epDate,
        isMovie: false,
        projected: true
      });
    });
  }

  console.log((isNext ? 'NEXT' : 'CURRENT') + ' count:', rawEntries.length);
  console.log('Sample:', rawEntries.slice(0, 3).map(x => `${x.title} (${x.episodeStr}) - ${x.dateFormatted} (day ${x.dayOfWeek})`));
}

async function run() {
  await testLostFilm(false);
  await testLostFilm(true);
}

run().catch(console.error);
