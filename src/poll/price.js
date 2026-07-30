/**
 * Altin (XAU/USD) fiyati - ucretsiz kaynaklar, zincirleme yedekli.
 *
 * PAXG (tokenlastirilmis altin) spot altini yakindan takip ediyor ve sitenin
 * kendi poster'i da ayni kaynagi kullaniyor; boylece kanal icinde tutarlilik
 * saglaniyor. Canli olculen degerler: Binance 4095.91, CoinGecko 4094.82
 * (birbirini dogruluyor), Yahoo GC=F 4167.70 (vadeli, spottan sapiyor - bu
 * yuzden yalnizca son care).
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const ZAMAN_ASIMI_MS = 12_000;

async function jsonAl(url) {
  const kontrol = new AbortController();
  const zamanlayici = setTimeout(() => kontrol.abort(), ZAMAN_ASIMI_MS);
  try {
    const yanit = await fetch(url, { headers: { 'User-Agent': UA }, signal: kontrol.signal });
    if (!yanit.ok) throw new Error(`HTTP ${yanit.status}`);
    return await yanit.json();
  } finally {
    clearTimeout(zamanlayici);
  }
}

const KAYNAKLAR = [
  {
    ad: 'binance',
    async fiyat() {
      const j = await jsonAl('https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT');
      return Number(j.price);
    },
  },
  {
    ad: 'coingecko',
    async fiyat() {
      const j = await jsonAl('https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd');
      return Number(j['pax-gold'].usd);
    },
  },
  {
    ad: 'yahoo',
    async fiyat() {
      const j = await jsonAl('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d');
      return Number(j.chart.result[0].meta.regularMarketPrice);
    },
  },
];

/**
 * Guncel altin fiyatini dondurur.
 * @returns {Promise<{fiyat: number, kaynak: string}>}
 */
export async function altinFiyati() {
  const hatalar = [];
  for (const kaynak of KAYNAKLAR) {
    try {
      const fiyat = await kaynak.fiyat();
      if (Number.isFinite(fiyat) && fiyat > 0) return { fiyat, kaynak: kaynak.ad };
      hatalar.push(`${kaynak.ad}: gecersiz deger`);
    } catch (err) {
      hatalar.push(`${kaynak.ad}: ${err?.message || err}`);
    }
  }
  throw new Error(`Altin fiyati alinamadi (${hatalar.join(' | ')})`);
}

/** 1.234,56 bicimi. */
export function fiyatYaz(deger) {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(deger);
}
