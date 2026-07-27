import fs from 'node:fs';
import path from 'node:path';

/**
 * Gonderilmis haberlerin kaydi.
 *
 * GitHub Actions calistirmalari efemer oldugu icin bu dosya repoya geri
 * commit'lenir; boylece bir sonraki calistirma neyin gonderildigini bilir.
 * Cache yerine commit tercih edildi: cache silinebilir, commit denetlenebilir.
 */

const SAKLAMA_GUN = 7;

/**
 * Iki basligi "ayni haber" saymak icin gereken 4-gram Jaccard benzerligi.
 * Gercek verilerle olculdu: ayni olayin iki versiyonu ~0.21, farkli olaylar
 * <=0.12 civari. Esik bilerek ayirt edici noktanin ustunde tutuldu; kararsiz
 * durumda iki haberi ayri saymak, birini hic gondermemekten iyidir.
 */
const BENZERLIK_ESIGI = 0.18;

export function durumOku(dosya) {
  try {
    const ham = JSON.parse(fs.readFileSync(dosya, 'utf8'));
    return Array.isArray(ham?.gonderilenler) ? ham.gonderilenler : [];
  } catch {
    return [];
  }
}

export function durumYaz(dosya, gonderilenler) {
  const sinir = Date.now() - SAKLAMA_GUN * 24 * 60 * 60 * 1000;
  const temiz = gonderilenler
    .filter((g) => (g.ts || 0) > sinir)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, 1000);

  fs.mkdirSync(path.dirname(dosya), { recursive: true });
  fs.writeFileSync(dosya, `${JSON.stringify({ gonderilenler: temiz }, null, 2)}\n`);
  return temiz;
}

/**
 * Baslik parmak izi: 4'lu karakter n-gram kumesi.
 *
 * Turkce sondan eklemeli oldugu icin kelime bazli karsilastirma ise yaramiyor
 * ("gerilimi" / "geriliminin" / "gerilimin" farkli kelime sayiliyor ve ayni
 * haberin iki versiyonu arasinda benzerlik ~0 cikiyor). Karakter n-gram'lari
 * ek degisimlerinden etkilenmedigi icin bu dilde cok daha guvenilir.
 */
function parmakIzi(baslik) {
  const metin = ` ${(baslik || '').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const kume = new Set();
  for (let i = 0; i + 4 <= metin.length; i++) kume.add(metin.slice(i, i + 4));
  return kume;
}

/**
 * Ayni olayin farkli kaynaklardaki versiyonlarini teke indirir.
 *
 * Basliklardaki anlamli kelimeler uzerinden Jaccard benzerligi kullanir;
 * ornegin "Petrol %6 düştü: ABD-İran gerilimi" ile "Petrol düşerken Avrupa
 * hisseleri yükseldi: ABD-İran gerilimi azaldı" ayni hikayedir.
 *
 * Karsilastirma yalnizca ayni turdaki adaylar arasinda degil, yakin gecmiste
 * ZATEN GONDERILMIS basliklara karsi da yapilir; aksi halde tur basi tavana
 * takilip bir sonraki tura kalan kopya, gecmis kontrolunden gecip tekrar
 * gonderiliyordu.
 *
 * @param {Array} haberler       aday haberler
 * @param {string[]} gecmisBasliklar yakin zamanda gonderilmis basliklar
 */
export function benzerleriEle(haberler, gecmisBasliklar = [], esik = BENZERLIK_ESIGI) {
  const referanslar = gecmisBasliklar.map(parmakIzi);
  const secilen = [];

  for (const haber of haberler) {
    const iz = parmakIzi(haber.baslik);
    const benzer = referanslar.some((ref) => {
      const ortak = [...iz].filter((g) => ref.has(g)).length;
      return ortak / (iz.size + ref.size - ortak) >= esik;
    });
    if (benzer) continue;
    referanslar.push(iz);
    secilen.push(haber);
  }
  return secilen;
}
