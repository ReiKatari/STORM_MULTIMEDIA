import * as cheerio from 'cheerio';

async function main() {
  const res = await fetch('https://lostfilm.tv/schedule/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    }
  });
  console.log('Status:', res.status);
  const html = await res.text();
  const $ = cheerio.load(html);
  const table = $('table.schedule-list-table');
  console.log('Table found:', table.length);
  table.find('tr').each((i, tr) => {
    const ths = $(tr).find('th');
    if (ths.length > 0) {
      console.log('Row ths:', ths.map((_, th) => $(th).text().trim()).get());
    } else {
      const tds = $(tr).find('td');
      tds.each((j, td) => {
        const a = $(td).find('a.title');
        if (a.length) {
          console.log(`  col ${j}: ${a.text().replace(/\s+/g, ' ').trim()}`);
        }
      });
    }
  });
}

main().catch(console.error);
