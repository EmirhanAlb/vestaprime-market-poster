/**
 * Slack kurulumunu dogrular. Birden fazla workspace destekler.
 *
 *   node scripts/slack-check.mjs            -> kurulumu ozetler
 *   node scripts/slack-check.mjs --gonder   -> her hedefe test mesaji atar
 *
 * En sik hatalar:
 *   not_in_channel -> bot kanala /invite ile davet edilmemis
 *   missing_scope  -> chat:write izni yok, app'i yeniden install edin
 *   invalid_auth   -> token yanlis veya baska bir workspace'e ait
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebClient } from '@slack/web-api';
import { hedefler, workspaceler, AKISLAR } from '../src/slack-out/targets.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const gonder = process.argv.includes('--gonder');

const ACIKLAMA = {
  news: 'Son Dakika haberleri',
  juice: 'FinancialJuice akisi',
  poster: 'Piyasa posteri',
  poll: 'Gunun tahmini',
};

const wsListesi = workspaceler();
if (wsListesi.length === 0) {
  console.error('Hicbir Slack token tanimli degil. SLACK_CONFIG veya SLACK_BOT_TOKEN ekleyin.');
  process.exit(1);
}

// --- Token'larin gecerliligi ve hangi workspace'e ait oldugu ---------------
const adlar = new Map();
for (const { slot, token } of wsListesi) {
  try {
    const r = await new WebClient(token).auth.test();
    adlar.set(token, r.team);
    console.log(`[${slot}] workspace: ${r.team} · bot: ${r.user} - token gecerli`);
  } catch (err) {
    console.error(`[${slot}] TOKEN GECERSIZ - ${err?.data?.error || err.message}`);
  }
}
console.log('');

// --- Hedef ozeti / test gonderimi -----------------------------------------
let hedefVar = false;
for (const akis of Object.keys(AKISLAR)) {
  const liste = hedefler(akis);
  if (liste.length === 0) {
    console.log(`  ${akis.padEnd(7)} - hedef yok (${ACIKLAMA[akis]} gonderilmez)`);
    continue;
  }
  hedefVar = true;
  for (const { token, channel, slot } of liste) {
    const ws = adlar.get(token) || '?';
    if (!gonder) {
      console.log(`  ${akis.padEnd(7)} -> ${channel.padEnd(13)} [${slot}/${ws}] ${ACIKLAMA[akis]}`);
      continue;
    }
    try {
      const r = await new WebClient(token).chat.postMessage({
        channel,
        text: `:white_check_mark: Bağlantı testi — ${ACIKLAMA[akis]} bu kanala gönderilecek.`,
      });
      console.log(`  ${akis.padEnd(7)} -> ${channel.padEnd(13)} [${slot}/${ws}] ${r.ok ? 'GONDERILDI' : 'BASARISIZ'}`);
    } catch (err) {
      console.log(`  ${akis.padEnd(7)} -> ${channel.padEnd(13)} [${slot}/${ws}] HATA: ${err?.data?.error || err.message}`);
    }
  }
}

if (!hedefVar) console.log('\nHicbir hedef tanimli degil.');
else if (!gonder) console.log('\nTest mesaji atmak icin: npm run slack:test');
process.exit(0);
