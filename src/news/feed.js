import crypto from 'node:crypto';
import Parser from 'rss-parser';

const parser = new Parser({
  timeout: 20_000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  },
});

/**
 * Feed'lerdeki tarih formatlari standart degil:
 *   investing.com -> "2026-07-27 08:15:40"  (UTC, ISO olmayan)
 *   AA            -> "Mon, 27 Jul 2026 11:11:00 +0300" (RFC822)
 * Once ISO'yu dener, olmazsa investing formatini UTC kabul ederek cozer.
 */
function tarihCoz(item) {
  if (item.isoDate) {
    const d = new Date(item.isoDate);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const ham = (item.pubDate || '').trim();
  if (!ham) return null;

  let d = new Date(ham);
  if (!Number.isNaN(d.getTime())) return d;

  const m = ham.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Tekrar gonderimi engellemek icin haber anahtari: link varsa link, yoksa baslik. */
export function haberAnahtari({ link, baslik }) {
  const temel = (link || baslik || '').split('?')[0].trim().toLowerCase();
  return crypto.createHash('sha1').update(temel).digest('hex').slice(0, 16);
}

/** Kaynak basina sert ust sinir. */
const KAYNAK_ZAMAN_ASIMI_MS = 15_000;

/**
 * rss-parser'in kendi timeout'u bazi sunucularda (yavas govde akitanlar)
 * devreye girmiyor ve surec kilitleniyor. Cron'da calistigimiz icin toplam
 * sure mutlaka sinirli olmali; bu yuzden ikinci bir sert zaman asimi.
 */
function zamanAsimiyla(vaat, ms, etiket) {
  return Promise.race([
    vaat,
    new Promise((_, reddet) => setTimeout(() => reddet(new Error(`${ms}ms zaman asimi`)), ms).unref()),
  ]).catch((e) => {
    throw new Error(`${etiket}: ${e.message}`);
  });
}

/**
 * Tek bir kaynagi okur. Hata durumunda bos dizi doner ve uyarir; bir kaynagin
 * cokmesi veya takilmasi tum calistirmayi durdurmamali.
 */
async function kaynakOku(kaynak) {
  try {
    const feed = await zamanAsimiyla(parser.parseURL(kaynak.url), KAYNAK_ZAMAN_ASIMI_MS, kaynak.id);
    return (feed.items || []).map((item) => {
      const baslik = (item.title || '').replace(/\s+/g, ' ').trim();
      const link = (item.link || '').trim();
      return {
        baslik,
        link,
        tarih: tarihCoz(item),
        kaynak,
        anahtar: haberAnahtari({ link, baslik }),
      };
    }).filter((h) => h.baslik);
  } catch (err) {
    console.warn(`  ! ${kaynak.id} okunamadi: ${err?.message || err}`);
    return [];
  }
}

/**
 * Tum kaynaklari paralel okur, ayni habere birden fazla feed'de rastlanirsa
 * (investing kategorileri caprazlama yayin yapiyor) tek kopya birakir.
 */
export async function haberleriTopla(kaynaklar) {
  const sonuclar = await Promise.all(kaynaklar.map(kaynakOku));
  const gorulen = new Set();
  const hepsi = [];

  for (const liste of sonuclar) {
    for (const haber of liste) {
      if (gorulen.has(haber.anahtar)) continue;
      gorulen.add(haber.anahtar);
      hepsi.push(haber);
    }
  }

  return hepsi;
}
