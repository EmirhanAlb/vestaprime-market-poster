/**
 * Telegram hedeflerinin cozumlenmesi.
 *
 * Her kanalin kendi botu olabiliyor (ayri token). Bu yuzden hedef = token +
 * sohbet kimligi ciftidir; tek bir token varsayilamaz.
 *
 * UC YAZIM DESTEKLENIYOR (oncelik sirasiyla degil, hepsi birlikte calisir)
 *
 * 1) TEK JSON - onerilen. Yeni kanal eklemek TEK secret duzenlemesi; workflow
 *    dosyalarina dokunmak gerekmez:
 *      TELEGRAM_CONFIG={"moneyfast":{"token":"123:ABC","news":"-100111",
 *                        "juice":"-100111"},
 *                       "alex":{"token":"456:DEF","news":"-100222"}}
 *
 * 2) Yuva basina degiskenler:
 *      TELEGRAM_BOTS=moneyfast,alex
 *      TELEGRAM_MONEYFAST_TOKEN=123:ABC
 *      TELEGRAM_MONEYFAST_NEWS=-100111
 *
 * 3) Tek bot (en basit, geriye uyumlu):
 *      TELEGRAM_BOT_TOKEN=123:ABC
 *      TELEGRAM_OUT_NEWS=-100111,-100222
 *
 * Ayni token+kanal cifti birden fazla yazimda gecerse bir kez gonderilir.
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

/** TELEGRAM_CONFIG'i cozer. Bozuk JSON akisi durdurmaz, uyarilir. */
function jsonYapilandirma() {
  const ham = process.env.TELEGRAM_CONFIG;
  if (!ham || !ham.trim()) return {};
  try {
    const d = JSON.parse(ham);
    return d && typeof d === 'object' ? d : {};
  } catch (err) {
    console.warn(`  ! TELEGRAM_CONFIG cozulemedi (${err.message}); yok sayiliyor`);
    return {};
  }
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

  // 1) JSON yapilandirma
  for (const [slot, cfg] of Object.entries(jsonYapilandirma())) {
    for (const chatId of liste(cfg?.[akis])) ekle(cfg?.token, chatId, slot);
  }

  // 2) Yuva basina degiskenler
  for (const slot of liste(process.env.TELEGRAM_BOTS)) {
    const on = `TELEGRAM_${slot.toUpperCase()}`;
    const token = process.env[`${on}_TOKEN`];
    for (const chatId of liste(process.env[`${on}_${akis.toUpperCase()}`])) {
      ekle(token, chatId, slot);
    }
  }

  // 3) Tek bot yazimi
  const varsayilanToken = process.env.TELEGRAM_BOT_TOKEN;
  for (const chatId of liste(process.env[AKISLAR[akis]])) {
    ekle(varsayilanToken, chatId, 'varsayilan');
  }

  return sonuc;
}

/** Tanimli tum bot yuvalarini dondurur (kurulum kontrolu icin). */
export function botlar() {
  const sonuc = [];
  const gorulen = new Set();
  const ekle = (slot, token) => {
    if (!token || gorulen.has(token)) return;
    gorulen.add(token);
    sonuc.push({ slot, token });
  };

  for (const [slot, cfg] of Object.entries(jsonYapilandirma())) ekle(slot, cfg?.token);
  for (const slot of liste(process.env.TELEGRAM_BOTS)) {
    ekle(slot, process.env[`TELEGRAM_${slot.toUpperCase()}_TOKEN`]);
  }
  ekle('varsayilan', process.env.TELEGRAM_BOT_TOKEN);
  return sonuc;
}
