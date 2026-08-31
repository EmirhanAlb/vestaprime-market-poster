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
/**
 * Kanalin gercekten yazilabilir oldugunu, kanalda hicbir sey gostermeden
 * dogrular.
 *
 * Token gecerli olmasi kanala yazilabilecegi anlamina gelmiyor: bot kanala
 * davet edilmemis olabilir (not_in_channel) ya da kimlik yanlis olabilir.
 * conversations.info dogru arac olurdu ama channels:read izni istiyor ve
 * uygulamada yok. Bunun yerine mesaj GELECEGE zamanlanip hemen siliniyor:
 * yalnizca chat:write yetiyor ve kanalda hicbir iz kalmiyor.
 *
 * Silme basarisiz olursa sessizce gecmiyoruz - aksi halde 20 dakika sonra
 * kanala test mesaji duserdi.
 */
async function yazilabilirMi(token, channel) {
  const istemci = new WebClient(token);
  let zamanlanan;
  try {
    const r = await istemci.chat.scheduleMessage({
      channel,
      post_at: Math.floor(Date.now() / 1000) + 1200, // 20 dk sonrasi
      text: 'baglanti testi',
    });
    zamanlanan = r.scheduled_message_id;
    return { ok: true };
  } catch (err) {
    return { ok: false, hata: err?.data?.error || err.message };
  } finally {
    if (zamanlanan) {
      try {
        await istemci.chat.deleteScheduledMessage({ channel, scheduled_message_id: zamanlanan });
      } catch (err) {
        console.error(
          `  !! TEMIZLIK BASARISIZ: ${channel} kanalinda zamanlanmis test mesaji silinemedi ` +
            `(${err?.data?.error || err.message}). 20 dk icinde elle silin.`,
        );
      }
    }
  }
}

let hedefVar = false;
const bozuk = [];
const erisim = new Map(); // ayni token+kanal cifti bir kez sinansin
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
      const anahtar = `${token}|${channel}`;
      if (!erisim.has(anahtar)) erisim.set(anahtar, await yazilabilirMi(token, channel));
      const d = erisim.get(anahtar);
      if (!d.ok) bozuk.push({ akis, slot, ws, channel, sebep: d.hata });
      const durum = d.ok ? 'ERISILEBILIR' : `ERISILEMIYOR (${d.hata})`;
      console.log(`  ${akis.padEnd(7)} -> ${channel.padEnd(13)} [${slot}/${ws}] ${durum}`);
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

if (!hedefVar) {
  console.log('\nHicbir hedef tanimli degil.');
} else if (!gonder) {
  if (bozuk.length) {
    console.error(`\n${bozuk.length} hedef calismiyor:`);
    for (const b of bozuk) console.error(`  ${b.akis} -> ${b.channel} [${b.slot}/${b.ws}]: ${b.sebep}`);
    console.error(
      '\nEn sik sebep not_in_channel: bot kanala davet edilmemis. ' +
        'Slack kanalinda /invite @bot yazin. channel_not_found ise kanal kimligi yanlis ' +
        'ya da baska bir workspace e ait.',
    );
    process.exit(1); // sessizce "her sey yolunda" demesin
  }
  console.log('\nTum hedefler erisilebilir. Test mesaji atmak icin: npm run slack:test');
}
process.exit(0);
