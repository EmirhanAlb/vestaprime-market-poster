/**
 * Saat dilimi yardimcilari.
 *
 * ABD piyasasi 09:30 New York saatiyle aciliyor. Yaz saati uygulamasi
 * nedeniyle bu UTC'de yazin 13:30, kisin 14:30'a denk geliyor; Turkiye ise
 * yil boyu UTC+3. Bu yuzden hedef anlar sabit UTC olarak degil, ilgili saat
 * diliminde "bugun saat X" olarak hesaplaniyor.
 */

/** Verilen anda, hedef saat diliminin UTC'den sapmasi (ms). */
function sapma(tarih, tz) {
  const bicim = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(bicim.formatToParts(tarih).map((x) => [x.type, x.value]));
  const utcGibi = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return utcGibi - tarih.getTime();
}

/**
 * Hedef saat diliminde "bugun saat:dakika" anini gercek bir Date olarak verir.
 * Yaz saati gecisinde sapma degisebildigi icin bir kez duzeltme yapilir.
 */
export function bugunSaat(saat, dakika, tz, referans = new Date()) {
  const s1 = sapma(referans, tz);
  const tzSimdi = new Date(referans.getTime() + s1);
  const y = tzSimdi.getUTCFullYear();
  const a = tzSimdi.getUTCMonth();
  const g = tzSimdi.getUTCDate();

  const tahmin = Date.UTC(y, a, g, saat, dakika) - s1;
  const s2 = sapma(new Date(tahmin), tz);
  return new Date(Date.UTC(y, a, g, saat, dakika) - s2);
}

/** "HH:MM" -> [saat, dakika] */
export function saatCoz(metin, varsayilan) {
  const e = /^(\d{1,2}):(\d{2})$/.exec((metin || '').trim());
  if (!e) return varsayilan;
  return [Number(e[1]), Number(e[2])];
}

/** Verilen ani Turkiye saatiyle HH:MM olarak yazar. */
export function trSaat(tarih, tz = 'Europe/Istanbul') {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(
    tarih,
  );
}

/** Verilen ani Turkiye tarihiyle GG.AA.YYYY olarak yazar. */
export function trTarih(tarih, tz = 'Europe/Istanbul') {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    tarih,
  );
}

/**
 * Hedef ana kadar bekler. Hedef gecmisse hemen doner.
 * Uzun beklemeler parcali yapilir ki ilerleme loglanabilsin.
 */
export async function bekle(hedef, etiket) {
  const kalanMs = hedef.getTime() - Date.now();
  if (kalanMs <= 0) {
    console.log(`${etiket}: hedef saat (${trSaat(hedef)}) gecmis, hemen devam ediliyor.`);
    return;
  }
  console.log(`${etiket}: ${trSaat(hedef)} bekleniyor (${Math.round(kalanMs / 60000)} dk)...`);
  let kalan = kalanMs;
  while (kalan > 0) {
    const adim = Math.min(kalan, 10 * 60 * 1000);
    await new Promise((r) => setTimeout(r, adim));
    kalan = hedef.getTime() - Date.now();
    if (kalan > 0) console.log(`  ${etiket}: ${Math.round(kalan / 60000)} dk kaldi`);
  }
}
