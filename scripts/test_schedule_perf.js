import * as cheerio from 'cheerio';
import { getAnixartDiscover } from '../services/anixart-service.js';

async function test() {
  const t0 = Date.now();
  console.log('Testing LostFilm next week projection and Anixart...');

  const res = await fetch('https://lostfilm.tv/schedule/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    },
    signal: AbortSignal.timeout(4000)
  });
  console.log('LostFilm status:', res.status, 'in', Date.now() - t0, 'ms');

  const anixRes = await getAnixartDiscover('popular', 0);
  console.log('Anixart items:', anixRes?.items?.length, 'in', Date.now() - t0, 'ms');
}

test().catch(console.error);
