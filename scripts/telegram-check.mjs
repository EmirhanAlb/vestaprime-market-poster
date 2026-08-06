/**
 * Telegram cikis kurulumunu dogrular. Birden fazla bot destekler.
 *
 *   node scripts/telegram-check.mjs            -> kurulumu ozetler
 *   node scripts/telegram-check.mjs --bul      -> her botun gordugu sohbetleri listeler
 *   node scripts/telegram-check.mjs --gonder   -> her hedefe test mesaji atar
 *
 * En sik iki hata:
 *   - bot kanala admin olarak eklenmemis  -> "chat not found" / "not enough rights"
 *   - kanal kimligi yanlis                -> "chat not found"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kimlik, mesajGonder, sohbetler } from '../src/telegram-out/client.js';
import { hedefler, botlar, AKISLAR } from '../src/telegram-out/targets.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const gonder = process.argv.includes('--gonder');
const bul = process.argv.includes('--bul');

const ACIKLAMA = {
  news: 'Son Dakika haberleri',
  juice: 'FinancialJuice akisi',
  poster: 'Piyasa posteri',
  poll: 'Gunun tahmini sonucu',
};

const botListesi = botlar();
if (botListesi.length === 0) {
  console.error('Hicbir bot tanimli degil. TELEGRAM_BOT_TOKEN veya TELEGRAM_BOTS ekleyin.');
  process.exit(1);
}

// --- Botlarin kimligini dogrula --------------------------------------------
const adlar = new Map();
for (const { slot, token } of botListesi) {
  try {
    const bot = await kimlik(token);
    adlar.set(slot, `@${bot.username}`);
    console.log(`Bot [${slot}]: @${bot.username} (${bot.first_name}) - token gecerli`);
  } catch (err) {
    console.error(`Bot [${slot}]: TOKEN GECERSIZ - ${err.message}`);
    adlar.set(slot, '(gecersiz)');
  }
}
console.log('');

// --- Kanal kimligi bulma ---------------------------------------------------
if (bul) {
  for (const { slot, token } of botListesi) {
    console.log(`[${slot}] ${adlar.get(slot)} su sohbetleri goruyor:`);
    try {
      const liste = await sohbetler(token);
      if (liste.length === 0) {
        console.log('  (yok) - bota kanalda admin yetkisi verin, kanala bir mesaj atin, tekrar deneyin');
      }
      for (const c of liste) {
        console.log(`  ${String(c.id).padEnd(16)} ${c.type.padEnd(10)} ${c.title || c.username || ''}`);
      }
    } catch (err) {
      console.log(`  HATA: ${err.message}`);
    }
    console.log('');
  }
  process.exit(0);
}

// --- Hedef ozeti / test gonderimi ------------------------------------------
let hedefVar = false;
for (const akis of Object.keys(AKISLAR)) {
  const liste = hedefler(akis);
  if (liste.length === 0) {
    console.log(`  ${akis.padEnd(7)} - hedef yok (${ACIKLAMA[akis]} Telegram'a gitmez)`);
    continue;
  }
  hedefVar = true;
  for (const { token, chatId, slot } of liste) {
    if (!gonder) {
      console.log(`  ${akis.padEnd(7)} -> ${String(chatId).padEnd(16)} [${slot}] ${ACIKLAMA[akis]}`);
      continue;
    }
    const ok = await mesajGonder(
      token,
      chatId,
      `✅ <b>Bağlantı testi</b>\n\n${ACIKLAMA[akis]} bu kanala gönderilecek.\nBu mesajı görüyorsanız kurulum doğru.`,
    );
    console.log(`  ${akis.padEnd(7)} -> ${String(chatId).padEnd(16)} [${slot}] ${ok ? 'GONDERILDI' : 'BASARISIZ'}`);
  }
}

if (!hedefVar) {
  console.log('\nHicbir hedef tanimli degil.');
} else if (!gonder) {
  console.log('\nTest mesaji atmak icin: npm run tg:test');
}
process.exit(0);
