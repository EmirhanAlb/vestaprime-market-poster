/**
 * Telegram cikis kurulumunu dogrular.
 *
 *   node scripts/telegram-check.mjs            -> sadece kontrol eder
 *   node scripts/telegram-check.mjs --gonder   -> her kanala test mesaji atar
 *
 * En sik iki hata:
 *   - bot kanala admin olarak eklenmemis  -> "chat not found" / "not enough rights"
 *   - kanal kimligi yanlis                -> "chat not found"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kimlik, mesajGonder, kanallar } from '../src/telegram-out/client.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const gonder = process.argv.includes('--gonder');
const bul = process.argv.includes('--bul');

const HEDEFLER = [
  ['TELEGRAM_OUT_NEWS', 'Son Dakika haberleri'],
  ['TELEGRAM_OUT_JUICE', 'FinancialJuice akisi'],
  ['TELEGRAM_OUT_POSTER', 'Piyasa posteri'],
  ['TELEGRAM_OUT_POLL', 'Gunun tahmini sonucu'],
];

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN tanimli degil. BotFather dan alip .env dosyasina ekleyin.');
  process.exit(1);
}

let bot;
try {
  bot = await kimlik();
  console.log(`Bot: @${bot.username} (${bot.first_name}) - token gecerli\n`);
} catch (err) {
  console.error(`Token gecersiz: ${err.message}`);
  process.exit(1);
}

// --bul: bot'un gordugu sohbetleri listeler. Ozel kanallarin -100... kimligini
// bulmanin en pratik yolu: bota admin yetkisi verdikten sonra kanala bir mesaj
// atin, sonra bu komutu calistirin.
if (bul) {
  const yanit = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates`);
  const j = await yanit.json();
  const sohbetler = new Map();
  for (const g of j.result || []) {
    const c = g.channel_post?.chat || g.message?.chat || g.my_chat_member?.chat;
    if (c) sohbetler.set(c.id, c);
  }
  if (sohbetler.size === 0) {
    console.log('Hicbir sohbet gorunmuyor.');
    console.log('Yapilacak: bota kanalda admin yetkisi verin, kanala bir mesaj atin, sonra tekrar deneyin.');
  } else {
    console.log('Bot su sohbetleri goruyor:\n');
    for (const c of sohbetler.values()) {
      console.log(`  ${String(c.id).padEnd(16)} ${c.type.padEnd(10)} ${c.title || c.username || ''}`);
    }
    console.log('\nKullanacaginiz deger soldaki kimlik (kanallar icin -100... ile baslar).');
  }
  process.exit(0);
}

let hedefVar = false;
for (const [degisken, aciklama] of HEDEFLER) {
  const liste = kanallar(process.env[degisken]);
  if (liste.length === 0) {
    console.log(`  ${degisken.padEnd(22)} - tanimsiz (${aciklama} Telegram'a gitmez)`);
    continue;
  }
  hedefVar = true;
  for (const chatId of liste) {
    if (!gonder) {
      console.log(`  ${degisken.padEnd(22)} -> ${chatId}  (${aciklama})`);
      continue;
    }
    const ok = await mesajGonder(
      chatId,
      `✅ <b>Bağlantı testi</b>\n\n${aciklama} bu kanala gönderilecek.\nBu mesajı görüyorsanız kurulum doğru.`,
    );
    console.log(`  ${degisken.padEnd(22)} -> ${chatId}  ${ok ? 'GONDERILDI' : 'BASARISIZ'}`);
  }
}

if (!hedefVar) {
  console.log('\nHicbir hedef kanal tanimli degil. En az bir TELEGRAM_OUT_* degiskeni ekleyin.');
} else if (!gonder) {
  console.log('\nTest mesaji atmak icin: node scripts/telegram-check.mjs --gonder');
}
process.exit(0);
