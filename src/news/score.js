/**
 * Haber onem skorlamasi.
 *
 * Amac: "SON DAKIKA" etiketiyle paylasilmaya deger, piyasayi hareket ettiren
 * global finansal gelismeleri ayirmak. Etiketin guvenilirligi onemli oldugu
 * icin sistem bilerek muhafazakar: emin olmadigi haberi gondermez.
 *
 * Yaklasim:
 *   1) VETO  - konu disi veya tekil hisse gurultusu ise dogrudan eler
 *   2) PUAN  - konu gruplarindan puan toplar (merkez bankasi > emtia > genel)
 *   3) BONUS - sert hareket / rekor / son dakika dili ek puan verir
 *   4) ESIK  - kaynak agirligiyla carpilan puan esigi gecerse gonderilir
 */

// --- 1) VETO: bu kaliplar eslesirse haber ne olursa olsun elenir ---------------

const VETO = [
  // "X hissesi bugün neden yükseldi?" tipi tekil hisse aciklamalari
  /hisse(si|leri|ler)?\s+(bugün\s+)?neden/,
  /neden\s+(yükseldi|düştü|yükseliyor|düşüyor|değer\s+kaybetti|geriledi)\s*\??$/,
  // Analist notu / hedef fiyat / tavsiye icerikleri
  /(hedef\s+fiyat|not(unu)?\s+(yükseltti|düşürdü)|tavsiye(sini)?\s+(yükseltti|düşürdü)|al\s+tavsiyesi)/,
  /(analisti|analistleri)\s+(ne\s+diyor|değerlendirdi)/,
  // Egitim / promosyon / kose yazisi
  /(nasıl\s+yatırım\s+yapılır|webinar|portföy\s+önerisi|teknik\s+analiz|uzman\s+görüşü|köşe\s+yazısı)/,
  /(bilmeniz\s+gerekenler|ne\s+anlama\s+geliyor\s*\?)/,
  // Yerel/gundem disi konular
  /(yks|lgs|mtv|ösym|üniversite\s+tercih|belediye|osb\b|kaymakam|vali(lik)?|muhtar)/,
  /(futbol|maç|lig|transfer|şampiyon|milli\s+takım|spor\s+toto)/,
  /(çilek|domates|balık|balığı|hasat|sera|tarla|köy|kırsal\s+kalkınma)/,
  /(hava\s+durumu|deprem\s+tatbikat|trafik\s+kazası|yangın\s+söndürme)/,
  /(dizi|film|konser|festival|müzik|sanat)/,
];

// --- 2) PUAN GRUPLARI ---------------------------------------------------------

const GROUPS = [
  {
    // Merkez bankalari ve para politikasi - en yuksek oncelik
    puan: 6,
    etiket: 'merkez-bankasi',
    kaliplar: [
      /\bfed\b|federal\s+rezerv|fomc/,
      /merkez\s+bankası|tcmb\b|ecb\b|avrupa\s+merkez\s+bankası/,
      /\bboj\b|japonya\s+merkez\s+bankası|\bboe\b|ingiltere\s+merkez\s+bankası|\bpboc\b/,
      /faiz\s+(kararı|artır|indir|oranı|beklentisi)/,
      /para\s+politikası|sıkılaştır|parasal\s+gevşe|niceliksel/,
      /\bppk\b|politika\s+faizi|swap\s+ihalesi/,
    ],
  },
  {
    // Makro veriler
    puan: 5,
    etiket: 'makro-veri',
    kaliplar: [
      /enflasyon|tüfe\b|üfe\b|çekirdek\s+enflasyon/,
      /işsizlik\s+(oranı|verisi)|tarım\s+dışı\s+istihdam|istihdam\s+verisi/,
      /gsyh|büyüme\s+(verisi|rakamları|oranı)|resesyon|durgunluk/,
      /\bpmi\b|imalat\s+endeksi|tüketici\s+güven|ifo\b/,
      /cari\s+(açık|denge)|bütçe\s+(açığı|dengesi)|dış\s+ticaret\s+açığı/,
      /perakende\s+satış|sanayi\s+üretimi/,
    ],
  },
  {
    // Jeopolitik soklar - piyasayi dogrudan vurur
    puan: 5,
    etiket: 'jeopolitik',
    kaliplar: [
      /savaş|ateşkes|saldırı|çatışma|füze|misilleme|işgal/,
      /yaptırım|ambargo|tarife|gümrük\s+vergisi|ticaret\s+savaşı/,
      /hürmüz|süveyş|boğaz(ı)?\s+kapat|petrol\s+ambargosu/,
      /darbe|seçim\s+sonuc|istifa\s+etti|görevden\s+alındı/,
      /jeopolitik|gerilim(in|i|ler)?\s+(azal|art|tırman)/,
    ],
  },
  {
    // Kriz sinyalleri
    puan: 5,
    etiket: 'kriz',
    kaliplar: [
      /iflas|batık|konkordato|kurtarma\s+paketi|temerrüt/,
      /kriz|çöküş|panik\s+satış|kara\s+(pazartesi|perşembe)/,
      /banka\s+(krizi|iflası)|likidite\s+kriz|kredi\s+notu\s+(düşürüldü|indirildi)/,
      /balon\s+patla|sert\s+satış\s+dalgası/,
    ],
  },
  {
    // Ana varliklar
    puan: 3,
    etiket: 'ana-varlik',
    kaliplar: [
      /petrol|brent|ham\s+petrol|opec|doğal\s+gaz|\bgaz\s+(vadeli|fiyat)/,
      /\baltın\b|ons\s+altın|gümüş\s+fiyat/,
      /dolar\s+endeksi|\bdxy\b|euro\/dolar|eur\/usd|sterlin|\byen\b/,
      /bitcoin|ethereum|kripto\s+para/,
      /tahvil\s+faiz|getiri\s+eğrisi|10\s+yıllık/,
      /buğday|tahıl|mısır|bakır|lityum/,
    ],
  },
  {
    // Genel piyasa ve borsa endeksleri
    puan: 2,
    etiket: 'piyasa',
    kaliplar: [
      /borsa|endeks|wall\s+street|nasdaq|s&p\s*500|dow\s+jones/,
      /bist\s*100|dax\b|ftse|nikkei|hang\s+seng/,
      /piyasalar|yatırımcılar|risk\s+iştahı|güvenli\s+liman/,
      /msci|endeks\s+değişikliği/,
    ],
  },
];

// --- 3) OLAY SINYALI ----------------------------------------------------------

/**
 * "Konu onemli" ile "ortada bir olay var" ayri seylerdir. Gunluk piyasa koseleri
 * ("Sterlin bugun: ... sakin", "Altin Fed odaginda ilerliyor") Fed'den bahsettigi
 * icin konu puani topluyor ama haber degeri tasimiyor. Son dakika olabilmesi icin
 * gerceklesmis, kesikli bir olay gerekiyor.
 */
// DIKKAT: JavaScript'te \b ASCII tabanlidir; "düştü", "çıktı", "çöktü" gibi
// Turkce karakterle biten kelimelerden sonra sinir olusturmaz ve kalip hic
// eslesmez. Kelime sonu icin asagidaki Turkce duyarli ileri-bakis kullanilir.
const SON = '(?![a-zçğıiöşü])';
const tr = (govde) => new RegExp(`(?:${govde})${SON}`);

const OLAY = [
  /açıkladı|duyurdu|ilan\s+etti|onayladı|imzaladı|kabul\s+etti|reddetti/,
  /kararı\s+(aldı|açıklandı)|karar\s+verdi|oylandı/,
  /istifa\s+etti|görevden\s+al|atandı|seçildi/,
  tr('artırdı|indirdi|yükseltti|düşürdü|sabit\\s+tuttu|zamlandı'),
  /beklentiler(i|in)\s+(aştı|üzerinde|altında|gerisinde)|tahminleri\s+aştı/,
  /şaşırttı|sürpriz\s+(karar|hamle)|beklenmedik/,
  /rekor\s+(kırdı|seviye|tazeledi)|zirve(sine|ye)\s+(çıktı|ulaştı)|dip\s+yaptı/,
  /başlattı|durdurdu|askıya\s+aldı|iptal\s+etti|yürürlüğe\s+girdi/,
  tr('düştü|yükseldi|geriledi|çıktı|sıçradı|çakıldı|çöktü|fırladı|uçtu|sildi|arttı|azaldı'),
  /veri(si|leri)?\s+açıkland|rakamlar(ı)?\s+belli/,
];

/**
 * Rutin gunluk kose / on izleme dili. Olay bildirmez, ceza alir.
 */
const RUTIN = [
  /\bbugün\s*:/,
  /(öncesi|beklentisiyle|beklentileriyle)\s+\S+(yor|iyor|uyor|üyor|acak|ecek)\b/,
  // "... Fed kararı öncesi düştü" tipi gunluk kur/emtia hareketi ozetleri
  /öncesi\s+(düştü|yükseldi|geriledi|çıktı|sakin|yatay)/,
  /odağında|gölgesinde|tartılıyor|ilerliyor|seyretti|seyrediyor|izliyor/,
  /haftaya\s+\S+\s+başladı|güne\s+\S+\s+başladı|haftalık\s+(görünüm|özet|performans)/,
  /piyasa\s+(özeti|kapanışı|açılışı|görünümü)|günlük\s+bülten/,
  /ne\s+bekliyor|beklentiler\s+neler|gözler\s+\S+de/,
  /(analiz|değerlendirme|yorum)\s*[:|-]/,
];

// --- 4) BONUSLAR --------------------------------------------------------------

const HAREKET_DILI = [
  /rekor|tarihi\s+(zirve|seviye)|zirve\s+yaptı|dip\s+yaptı/,
  /sert\s+(düşüş|yükseliş|satış|geriledi|yükseldi)/,
  /çakıldı|çöktü|uçtu|fırladı|sıçradı|tavan\s+yaptı|taban\s+yaptı/,
  /şok|sürpriz|beklenmedik|şaşırttı|flaş/,
  /son\s+dakika|acil|kritik\s+karar/,
];

/** Baslikta gecen en buyuk yuzdelik degeri bulur ("%6" veya "yüzde 6,5"). */
function enBuyukYuzde(metin) {
  const eslesmeler = [
    ...metin.matchAll(/%\s*(\d+(?:[.,]\d+)?)/g),
    ...metin.matchAll(/yüzde\s+(\d+(?:[.,]\d+)?)/g),
  ];
  const degerler = eslesmeler.map((m) => parseFloat(m[1].replace(',', '.'))).filter((n) => !Number.isNaN(n));
  return degerler.length ? Math.max(...degerler) : 0;
}

/** Turkce'ye duyarli kucuk harfe cevirme (I -> ı, İ -> i). */
function normalize(metin) {
  return (metin || '').toLocaleLowerCase('tr-TR');
}

// --- 5) ANA FONKSIYON ---------------------------------------------------------

/** Esigi gecen haberler gonderilir. Ortam degiskeniyle ayarlanabilir. */
export const MIN_SKOR = Number(process.env.NEWS_MIN_SCORE || 8);

/** Olay sinyali tasimayan haberlerin puani bu carpanla kirilir. */
const OLAYSIZ_CARPAN = 0.45;

/**
 * Bir haberi puanlar.
 * @returns {{skor: number, gecti: boolean, veto: string|null, etiketler: string[], detay: string}}
 */
export function skorla(baslik, kaynak) {
  const metin = normalize(baslik);

  const veto = VETO.find((k) => k.test(metin));
  if (veto) {
    return { skor: 0, gecti: false, veto: String(veto), etiketler: [], detay: 'veto' };
  }

  let ham = 0;
  const etiketler = [];
  const detaylar = [];

  for (const grup of GROUPS) {
    if (grup.kaliplar.some((k) => k.test(metin))) {
      ham += grup.puan;
      etiketler.push(grup.etiket);
      detaylar.push(`${grup.etiket}+${grup.puan}`);
    }
  }

  // Konuyla hic ilgisi yoksa bonuslara bakmadan eleriz: "rekor" kelimesi tek
  // basina bir haberi son dakika yapmaz.
  if (ham === 0) {
    return { skor: 0, gecti: false, veto: null, etiketler: [], detay: 'konu-disi' };
  }

  const hareket = HAREKET_DILI.filter((k) => k.test(metin)).length;
  if (hareket) {
    ham += Math.min(hareket * 2, 4);
    detaylar.push(`hareket+${Math.min(hareket * 2, 4)}`);
  }

  const yuzde = enBuyukYuzde(metin);
  if (yuzde >= 5) {
    ham += 3;
    detaylar.push(`%${yuzde}+3`);
  } else if (yuzde >= 2) {
    ham += 1.5;
    detaylar.push(`%${yuzde}+1.5`);
  }

  // Rutin kose dili puani dusurur.
  const rutin = RUTIN.filter((k) => k.test(metin)).length;
  if (rutin) {
    ham -= Math.min(rutin * 3, 6);
    detaylar.push(`rutin-${Math.min(rutin * 3, 6)}`);
  }

  // Gerceklesmis bir olay yoksa puan sert sekilde kirilir: konu onemli olabilir
  // ama ortada son dakika yoktur.
  const olay = OLAY.some((k) => k.test(metin));
  if (!olay) {
    ham *= OLAYSIZ_CARPAN;
    detaylar.push('olaysiz');
  } else {
    etiketler.push('olay');
  }

  const skor = Math.max(0, Math.round(ham * (kaynak?.weight ?? 1) * 10) / 10);
  return { skor, gecti: skor >= MIN_SKOR, veto: null, etiketler, detay: detaylar.join(' ') };
}
