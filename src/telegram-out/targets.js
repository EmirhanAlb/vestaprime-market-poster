/**
 * Telegram hedeflerinin cozumlenmesi.
 *
 * Her kanalin kendi botu olabiliyor (ayri token). Bu yuzden hedef = token +
 * sohbet kimligi ciftidir; tek bir token varsayilamaz.
 *
 * IKI YAZIM DESTEKLENIYOR
 *
 * 1) Tek bot (basit, geriye uyumlu):
 *      TELEGRAM_BOT_TOKEN=123:ABC
 *      TELEGRAM_OUT_NEWS=-100111,-100222      <- ikisi de ayni botla
 *      TELEGRAM_OUT_JUICE=-100111
 *
 * 2) Coklu bot (her kanalin kendi botu):
 *      TELEGRAM_BOTS=moneyfast,alex
 *      TELEGRAM_MONEYFAST_TOKEN=123:ABC
 *      TELEGRAM_MONEYFAST_NEWS=-100111
 *      TELEGRAM_MONEYFAST_JUICE=-100111
 *      TELEGRAM_ALEX_TOKEN=456:DEF
 *      TELEGRAM_ALEX_NEWS=-100222
 *      TELEGRAM_ALEX_JUICE=-100222
 *
 * Ikisi ayni anda tanimliysa ikisi de calisir; boylece tek bottan cokluya
 * gecis tek seferde yapilmak zorunda kalmaz.
 */

/** Desteklenen akislar ve tek-bot yaziminda karsilik gelen degisken adlari. */
export const AKISLAR = {
  news: 'TELEGRAM_OUT_NEWS',
  juice: 'TELEGRAM_OUT_JUICE',
  poster: 'TELEGRAM_OUT_POSTER',
  poll: 'TELEGRAM_OUT_POLL',
};

function liste(deger) {
  return String(deger || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Bir akis icin gonderim hedeflerini dondurur.
 * @param {'news'|'juice'|'poster'|'poll'} akis
 * @returns {Array<{token: string, chatId: string, slot: string}>}
 */
export function hedefler(akis) {
  const sonuc = [];
  const gorulen = new Set(); // ayni token+kanal iki kez gonderilmesin

  const ekle = (token, chatId, slot) => {
    if (!token || !chatId) return;
    const anahtar = `${token}|${chatId}`;
    if (gorulen.has(anahtar)) return;
    gorulen.add(anahtar);
    sonuc.push({ token, chatId, slot });
  };

  // 1) Tek bot yazimi
  const varsayilanToken = process.env.TELEGRAM_BOT_TOKEN;
  for (const chatId of liste(process.env[AKISLAR[akis]])) {
    ekle(varsayilanToken, chatId, 'varsayilan');
  }

  // 2) Coklu bot yazimi
  for (const slot of liste(process.env.TELEGRAM_BOTS)) {
    const on = `TELEGRAM_${slot.toUpperCase()}`;
    const token = process.env[`${on}_TOKEN`];
    for (const chatId of liste(process.env[`${on}_${akis.toUpperCase()}`])) {
      ekle(token, chatId, slot);
    }
  }

  return sonuc;
}

/** Tanimli tum bot yuvalarini dondurur (kurulum kontrolu icin). */
export function botlar() {
  const sonuc = [];
  if (process.env.TELEGRAM_BOT_TOKEN) {
    sonuc.push({ slot: 'varsayilan', token: process.env.TELEGRAM_BOT_TOKEN });
  }
  for (const slot of liste(process.env.TELEGRAM_BOTS)) {
    const token = process.env[`TELEGRAM_${slot.toUpperCase()}_TOKEN`];
    if (token) sonuc.push({ slot, token });
  }
  return sonuc;
}
