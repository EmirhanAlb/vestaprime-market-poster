/**
 * Slack hedeflerinin cozumlenmesi.
 *
 * Slack token'lari WORKSPACE'e baglidir: baska bir workspace'e mesaj atmak
 * icin orada ayri bir app kurup ayri bir token almak sart. Bu yuzden hedef =
 * token + kanal ciftidir; tek bir token varsayilamaz.
 *
 * IKI YAZIM DESTEKLENIYOR (birlikte calisir)
 *
 * 1) TEK JSON - onerilen. Yeni workspace/kanal eklemek TEK secret duzenlemesi:
 *      SLACK_CONFIG={"order":{"token":"xoxb-...","news":"C111","juice":"C222"},
 *                    "yeni":{"token":"xoxb-...","news":"C333","juice":"C333"}}
 *
 * 2) Tek workspace (geriye uyumlu, mevcut kurulum):
 *      SLACK_BOT_TOKEN=xoxb-...
 *      NEWS_CHANNEL_ID=C111,C222      (news)
 *      TELEGRAM_CHANNEL_ID=C333       (juice - eski isim, Slack kanali)
 *      SLACK_CHANNEL_ID=C444          (poster)
 *      POLL_CHANNEL_ID=C555           (poll)
 *
 * Ayni token+kanal cifti iki yazimda da gecerse bir kez gonderilir.
 */

/** Akislar ve tek-workspace yaziminda karsilik gelen degisken adlari. */
export const AKISLAR = {
  news: 'NEWS_CHANNEL_ID',
  juice: 'TELEGRAM_CHANNEL_ID',
  poster: 'SLACK_CHANNEL_ID',
  poll: 'POLL_CHANNEL_ID',
};

function liste(deger) {
  return String(deger || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** SLACK_CONFIG'i cozer. Bozuk JSON akisi durdurmaz, uyarilir. */
function jsonYapilandirma() {
  const ham = process.env.SLACK_CONFIG;
  if (!ham || !ham.trim()) return {};
  try {
    const d = JSON.parse(ham);
    return d && typeof d === 'object' ? d : {};
  } catch (err) {
    console.warn(`  ! SLACK_CONFIG cozulemedi (${err.message}); yok sayiliyor`);
    return {};
  }
}

/**
 * Bir akis icin gonderim hedeflerini dondurur.
 * @param {'news'|'juice'|'poster'|'poll'} akis
 * @returns {Array<{token: string, channel: string, slot: string}>}
 */
export function hedefler(akis) {
  const sonuc = [];
  const gorulen = new Set();

  const ekle = (token, channel, slot) => {
    if (!token || !channel) return;
    const anahtar = `${token}|${channel}`;
    if (gorulen.has(anahtar)) return;
    gorulen.add(anahtar);
    sonuc.push({ token, channel, slot });
  };

  for (const [slot, cfg] of Object.entries(jsonYapilandirma())) {
    for (const channel of liste(cfg?.[akis])) ekle(cfg?.token, channel, slot);
  }

  const varsayilan = process.env.SLACK_BOT_TOKEN;
  for (const channel of liste(process.env[AKISLAR[akis]])) {
    ekle(varsayilan, channel, 'varsayilan');
  }

  return sonuc;
}

/** Hedefleri token'a gore gruplar (her token icin tek WebClient yeterli). */
export function tokenaGoreGrupla(akis) {
  const gruplar = new Map();
  for (const { token, channel, slot } of hedefler(akis)) {
    if (!gruplar.has(token)) gruplar.set(token, { token, slot, channels: [] });
    gruplar.get(token).channels.push(channel);
  }
  return [...gruplar.values()];
}

/** Tanimli tum workspace'leri dondurur (kurulum kontrolu icin). */
export function workspaceler() {
  const sonuc = [];
  const gorulen = new Set();
  const ekle = (slot, token) => {
    if (!token || gorulen.has(token)) return;
    gorulen.add(token);
    sonuc.push({ slot, token });
  };
  for (const [slot, cfg] of Object.entries(jsonYapilandirma())) ekle(slot, cfg?.token);
  ekle('varsayilan', process.env.SLACK_BOT_TOKEN);
  return sonuc;
}
