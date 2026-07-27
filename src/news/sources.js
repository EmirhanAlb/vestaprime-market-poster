/**
 * Haber kaynaklari.
 *
 * Secim kriteri: Turkce yayin yapan, global finansal gelismeleri dakikalik
 * tazelikte veren feed'ler. Canli test sonucunda elenenler:
 *   - bloomberght.com/rss      -> feed gunlerdir guncellenmiyor
 *   - investing.com/central_banks -> son icerik 2022
 *   - dunya.com, ekonomim.com, trthaber -> agirlikla yerel gundem gurultusu
 *   - financialjuice           -> her ekonomik verinin ham akisi, Slack icin fazla
 *
 * weight: kaynagin guvenilirlik carpani. Skorlamada nihai puani olceklendirir.
 */
export const SOURCES = [
  {
    id: 'inv-ekonomi',
    name: 'Investing.com',
    category: 'Ekonomi',
    url: 'https://tr.investing.com/rss/news_14.rss',
    weight: 1.15,
  },
  {
    id: 'inv-emtia',
    name: 'Investing.com',
    category: 'Emtia',
    url: 'https://tr.investing.com/rss/news_11.rss',
    weight: 1.1,
  },
  {
    id: 'inv-forex',
    name: 'Investing.com',
    category: 'Döviz',
    url: 'https://tr.investing.com/rss/news_1.rss',
    weight: 1.1,
  },
  {
    id: 'inv-kripto',
    name: 'Investing.com',
    category: 'Kripto',
    url: 'https://tr.investing.com/rss/news_285.rss',
    weight: 1.0,
  },
  {
    id: 'inv-borsa',
    name: 'Investing.com',
    category: 'Borsa',
    url: 'https://tr.investing.com/rss/news_25.rss',
    // Tekil hisse gurultusu yogun; skorlamanin elemesine guveniyoruz ama
    // agirligi dusuk tutuyoruz.
    weight: 0.85,
  },
  {
    id: 'aa-ekonomi',
    name: 'Anadolu Ajansı',
    category: 'Ekonomi',
    url: 'https://www.aa.com.tr/tr/rss/default?cat=ekonomi',
    weight: 0.9,
  },
];
