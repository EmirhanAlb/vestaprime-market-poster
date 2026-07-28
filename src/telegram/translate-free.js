/**
 * Ucretsiz ceviri katmani (API anahtari gerektirmez).
 *
 * Iki saglayici zincirleme denenir; ikisi de basarisiz olursa baslik
 * cevirisiz isaretlenip Ingilizce gonderilir. Canli test sonuclari:
 *   google-gtx  ~70-300ms, akici Turkce  -> birincil
 *   mymemory    ~350-700ms, daha ham      -> yedek
 *   lingva      HTTP 500 (olu)            -> kullanilmiyor
 *   libretranslate HTTP 400 (artik anahtar istiyor) -> kullanilmiyor
 *
 * Not: google-gtx resmi bir API degil. Datacenter IP'lerinden (GitHub Actions)
 * hiz sinirina takilabilir; bu yuzden mymemory yedegi zorunlu, opsiyonel degil.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const ZAMAN_ASIMI_MS = 12_000;
/** Saglayicilari yormamak icin istekler arasi bekleme. */
const ARALIK_MS = Number(process.env.TRANSLATE_DELAY_MS || 120);

/**
 * Veri aciklama mesajlarinin standart kaliplari. Google bunlari kelime
 * kelime cevirdigi icin ("ACTUAL" -> "GERÇEK") finans diline oturtuyoruz.
 * Yalnizca kaynak metin bu kalibi tasiyorsa uygulanir.
 */
const VERI_SOZLUGU = [
  [/\bGERÇEK\b/g, 'GERÇEKLEŞEN'],
  [/\bTAHMİN\b/g, 'BEKLENTİ'],
  [/\bÖNCEKİ\b/g, 'ÖNCEKİ'],
];

async function istek(url, secenekler = {}) {
  const kontrol = new AbortController();
  const zamanlayici = setTimeout(() => kontrol.abort(), ZAMAN_ASIMI_MS);
  try {
    const yanit = await fetch(url, {
      ...secenekler,
      headers: { 'User-Agent': UA, ...(secenekler.headers || {}) },
      signal: kontrol.signal,
    });
    if (!yanit.ok) throw new Error(`HTTP ${yanit.status}`);
    return await yanit.json();
  } finally {
    clearTimeout(zamanlayici);
  }
}

const SAGLAYICILAR = [
  {
    ad: 'google',
    async cevir(metin) {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=${encodeURIComponent(metin)}`;
      const j = await istek(url);
      return j[0].map((p) => p[0]).join('');
    },
  },
  {
    ad: 'mymemory',
    async cevir(metin) {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(metin)}&langpair=en|tr`;
      const j = await istek(url);
      if (j.responseStatus !== 200) throw new Error(`API ${j.responseStatus}`);
      return j.responseData.translatedText;
    },
  },
];

/**
 * Cevirmenler "$MACRO" gibi sembolleri bozuyor ("$ MAKRO"). Kaynaktaki
 * sembolleri sirayla geri koyuyoruz; sayilari eslesmezse dokunmuyoruz.
 */
function sembolleriGeriKoy(kaynak, ceviri) {
  const kaynakSemboller = kaynak.match(/\$[A-Za-z][A-Za-z0-9.]*/g) || [];
  if (kaynakSemboller.length === 0) return ceviri;

  const ceviriSemboller = ceviri.match(/\$\s?[A-Za-zÇĞİÖŞÜçğıöşü0-9.]+/g) || [];
  if (ceviriSemboller.length !== kaynakSemboller.length) return ceviri;

  let i = 0;
  return ceviri.replace(/\$\s?[A-Za-zÇĞİÖŞÜçğıöşü0-9.]+/g, () => kaynakSemboller[i++]);
}

function sonRotuslar(kaynak, ceviri) {
  let sonuc = sembolleriGeriKoy(kaynak, ceviri);
  if (/\bACTUAL\b/i.test(kaynak) && /\bFORECAST\b/i.test(kaynak)) {
    for (const [kalip, yeni] of VERI_SOZLUGU) sonuc = sonuc.replace(kalip, yeni);
  }
  return sonuc.replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

async function tekCevir(metin) {
  const hatalar = [];
  for (const saglayici of SAGLAYICILAR) {
    try {
      const ham = await saglayici.cevir(metin);
      if (ham && ham.trim()) {
        return { turkce: sonRotuslar(metin, ham.trim()), cevrildi: true, saglayici: saglayici.ad };
      }
      hatalar.push(`${saglayici.ad}: bos yanit`);
    } catch (err) {
      hatalar.push(`${saglayici.ad}: ${err?.message || err}`);
    }
  }
  console.warn(`  ! ceviri yapilamadi (${hatalar.join(' | ')})`);
  return { turkce: metin, cevrildi: false, saglayici: null };
}

/**
 * Basliklari sirayla cevirir. Ayni imza: claude tabanli cevirmenle
 * degistirilebilir olsun diye.
 */
export async function cevir(mesajlar) {
  const sonuc = [];
  for (const m of mesajlar) {
    sonuc.push({ ...m, ...(await tekCevir(m.metin)) });
    if (ARALIK_MS) await new Promise((r) => setTimeout(r, ARALIK_MS));
  }
  return sonuc;
}

export const MODEL = 'ucretsiz (google + mymemory)';
