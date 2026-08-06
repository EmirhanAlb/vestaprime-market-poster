/**
 * Slack'e giden icerigin Telegram kanalina da gonderilmesi.
 *
 * Her otomasyon kendi ortam degiskeniyle acilir; degisken bos ise hicbir sey
 * gonderilmez ve mevcut Slack akisi hic degismez. Boylece Telegram'i tek tek
 * devreye alabiliyoruz.
 *
 *   TELEGRAM_BOT_TOKEN     BotFather'dan alinan bot anahtari (ortak)
 *   TELEGRAM_OUT_NEWS      Son Dakika haberleri  -> kanal
 *   TELEGRAM_OUT_JUICE     FinancialJuice akisi  -> kanal
 *   TELEGRAM_OUT_POSTER    Piyasa posteri        -> kanal
 *
 * KURAL: Telegram kanali ayri bir marka. Buradan cikan hicbir mesajda
 * "Vestaprime" adi, vestaprimes.com bagi veya baska bir marka izi
 * BULUNMAYACAK. Yeni bir mesaj bicimi eklerken bunu kontrol edin.
 */

import { mesajGonder, fotografGonder, kacir, kanallar, etkinMi } from './client.js';

const KATEGORI_EMOJI = {
  Ekonomi: '📊',
  Emtia: '🛢️',
  Döviz: '💱',
  Kripto: '🪙',
  Borsa: '📈',
};

function hedefler(degisken) {
  return kanallar(process.env[degisken]);
}

async function hepsineGonder(degisken, html, secenekler) {
  const liste = hedefler(degisken);
  if (liste.length === 0) return 0;
  let basarili = 0;
  for (const chatId of liste) {
    if (await mesajGonder(chatId, html, secenekler)) basarili += 1;
  }
  return basarili;
}

/** Son Dakika haberi. */
export async function haberGonder({ baslik, kategori, kaynak, saat, link }) {
  const emoji = KATEGORI_EMOJI[kategori] || '📰';
  const html =
    `🚨 <b>SON DAKİKA</b>\n\n` +
    `<b>${kacir(baslik)}</b>\n\n` +
    `${emoji} ${kacir(kategori)} · ${kacir(kaynak)} · ${kacir(saat)}` +
    (link ? `\n<a href="${kacir(link)}">Habere git</a>` : '');
  return hepsineGonder('TELEGRAM_OUT_NEWS', html);
}

/**
 * FinancialJuice ham akis basligi.
 *
 * Kaynak bagi bilerek YOK: bag kaynagin kendi Telegram kanalina gidiyordu ve
 * bizim kanalimizin abonelerini oraya yonlendiriyordu. Isim (FinancialJuice)
 * atif olarak kaliyor, tiklanabilir bag kalmiyor.
 */
export async function juiceGonder({ metin, saat, cevrildi = true }) {
  const html =
    `⚡ ${kacir(metin)}\n\n` +
    `<i>FinancialJuice · ${kacir(saat)}</i>` +
    (cevrildi ? '' : ' · <i>çeviri yapılamadı</i>');
  return hepsineGonder('TELEGRAM_OUT_JUICE', html);
}

/**
 * Piyasa posteri (gorsel).
 *
 * UYARI: Poster GORSELININ KENDISINDE logo ve "vestaprimes.com" yazisi var -
 * bu metinden temizlenemez. Marka gecmemesi gereken bir kanala poster
 * gondermeyin; TELEGRAM_OUT_POSTER'i bos birakin veya markasiz bir gorsel
 * uretin.
 */
export async function posterGonder({ dosyaYolu, saat, canli = true }) {
  const liste = hedefler('TELEGRAM_OUT_POSTER');
  if (liste.length === 0) return 0;
  const aciklama =
    `📈 <b>Canlı Piyasalar</b> · ${kacir(saat)}` +
    (canli ? '' : '\n<i>Fiyatlar canlı akışa geçmeden yakalandı.</i>');
  let basarili = 0;
  for (const chatId of liste) {
    if (await fotografGonder(chatId, dosyaYolu, aciklama)) basarili += 1;
  }
  return basarili;
}

/** Gunun tahmini oylamasi - sonuc duyurusu (Telegram'da oylama yok, ozet gider). */
export async function oylamaSonucGonder({ acilis, kapanis, degisim, yonEtiket, sert }) {
  const isaret = degisim > 0 ? '+' : '';
  const html =
    `${sert ? '🚨' : '🏁'} <b>SONUÇ — Altın (XAU/USD)</b>\n\n` +
    `Açılış: <b>$${kacir(acilis)}</b> → 1 saat sonra: <b>$${kacir(kapanis)}</b>\n` +
    `Değişim: <b>${isaret}${degisim.toFixed(2)}%</b> → <b>${kacir(yonEtiket)}</b>` +
    (sert ? ' <i>(sert hareket)</i>' : '');
  return hepsineGonder('TELEGRAM_OUT_POLL', html);
}

export { etkinMi };
