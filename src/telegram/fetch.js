/**
 * Telegram kanal okuyucu.
 *
 * Telegram Bot API bir kanalin mesajlarini ancak bot o kanalda admin ise
 * verir; bu kanal bize ait olmadigi icin o yol kapali. Bunun yerine Telegram'in
 * herkese acik web onizlemesi (t.me/s/<kanal>) okunuyor: kimlik dogrulama
 * gerektirmiyor ve son 20 mesaji zaman damgasi + benzersiz ID ile veriyor.
 */

import { createHash } from 'node:crypto';

const KANAL = process.env.TELEGRAM_CHANNEL || 'Financial_Juice_News';
const URL = `https://t.me/s/${KANAL}`;
const ZAMAN_ASIMI_MS = 20_000;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const VARLIKLAR = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function htmlCoz(metin) {
  return metin
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, kod) => String.fromCharCode(Number(kod)))
    .replace(/&[a-z]+;|&#39;/gi, (v) => VARLIKLAR[v.toLowerCase()] ?? v)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Baslik kimligi: ayni metnin tekrar gonderilmesini engeller.
 *
 * Kanal ayni basligi sik sik iki kez atiyor; tek fark bir "🔴" oneki veya
 * noktalama oluyor. Bu yuzden anahtar hesaplanirken harf ve rakam disindaki
 * her sey atiliyor, aksi halde ayni haber iki kez gonderiliyordu.
 */
function anahtarla(metin) {
  const sade = metin
    .toLocaleLowerCase('tr-TR')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
  return createHash('sha1').update(sade).digest('hex').slice(0, 16);
}

/**
 * Kanalin son basliklarini eskiden yeniye siralanmis olarak dondurur.
 *
 * DIKKAT: Telegram'in web onizlemesi ardisik mesajlari TEK blokta birlestiriyor.
 * Bir blok <br> ile ayrilmis birden fazla bagimsiz basligi barindirabiliyor
 * (olculen ortalama: blok basina 3.3 baslik) ve ayni baslik blok icinde
 * tekrarlanabiliyor. Bu yuzden bloklar satirlarina ayrilip her baslik ayri bir
 * ogeye donusturuluyor; aksi halde alakasiz basliklar tek Slack mesajinda
 * birlesik gorunurdu.
 *
 * @returns {Promise<Array<{blokId: number, metin: string, tarih: Date|null, link: string, anahtar: string}>>}
 */
export async function mesajlariCek() {
  const kontrol = new AbortController();
  const zamanlayici = setTimeout(() => kontrol.abort(), ZAMAN_ASIMI_MS);

  let html;
  try {
    const yanit = await fetch(URL, { headers: { 'User-Agent': UA }, signal: kontrol.signal });
    if (!yanit.ok) throw new Error(`HTTP ${yanit.status}`);
    html = await yanit.text();
  } finally {
    clearTimeout(zamanlayici);
  }

  // Her mesaj blogu data-post="<kanal>/<id>" ile basliyor; dokumani bu
  // isaretten bolup her parcayi kendi icinde ayristiriyoruz.
  const parcalar = html.split('data-post="').slice(1);
  const basliklar = [];

  for (const parca of parcalar) {
    const post = parca.slice(0, parca.indexOf('"'));
    const blokId = Number(post.split('/')[1]);
    if (!Number.isFinite(blokId)) continue;

    const metinEsleme = parca.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const tarihEsleme = parca.match(/<time[^>]*datetime="([^"]+)"/);
    if (!metinEsleme) continue;

    const tarih = tarihEsleme ? new Date(tarihEsleme[1]) : null;
    const link = `https://t.me/${post}`;
    const blokIci = new Set();

    for (const ham of metinEsleme[1].split(/<br\s*\/?>/i)) {
      const metin = htmlCoz(ham);
      if (!metin) continue;
      const anahtar = anahtarla(metin);
      if (blokIci.has(anahtar)) continue; // ayni blokta tekrarlanan baslik
      blokIci.add(anahtar);
      basliklar.push({
        blokId,
        metin,
        tarih: tarih && !Number.isNaN(tarih.getTime()) ? tarih : null,
        link,
        anahtar,
      });
    }
  }

  // Blok ID'leri artan; blok icindeki sira zaten korunuyor.
  return basliklar.sort((a, b) => a.blokId - b.blokId);
}
