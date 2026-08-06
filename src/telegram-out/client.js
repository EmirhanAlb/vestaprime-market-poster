/**
 * Telegram Bot API istemcisi - CIKIS yonu.
 *
 * Dikkat: bu klasor Telegram'a YAZAR. src/telegram/ ise Telegram'dan OKUR
 * (FinancialJuice kanalinin web onizlemesini ayristirir). Ikisi farkli isler,
 * bilerek ayri tutuldu.
 *
 * Token her cagriya parametre olarak gecilir; her kanalin kendi botu
 * olabildigi icin tek bir global token varsayilmaz.
 *
 * Gonderimler bilerek "yumusak" hata veriyor: Telegram tarafindaki bir sorun
 * Slack akisini durdurmamali. Her gonderim kendi icinde yakalanir ve uyari
 * olarak loglanir.
 */

const API = 'https://api.telegram.org';
const ZAMAN_ASIMI_MS = 20_000;
/**
 * Telegram kanal basina dakikada ~20 mesaja izin veriyor. Aralik birakmazsak
 * FinancialJuice'un 15 mesajlik turlari sinira dayaniyor. Sinir kanal bazli
 * oldugu icin bekleme de kanal bazli tutuluyor.
 */
const ARALIK_MS = Number(process.env.TELEGRAM_OUT_DELAY_MS || 3000);

/** Telegram HTML modunda anlam tasiyan karakterleri kacirir. */
export function kacir(metin) {
  return String(metin ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Marka korumasi. Telegram kanallari ayri bir marka; buradan cikan hicbir
 * mesajda kurum adi veya alan adi gecmeyecek. Sablona yanlislikla marka
 * eklenirse mesaj gonderilmez ve hata loglanir - sessizce sizmasindansa
 * gorunur sekilde durmasi tercih edildi.
 */
const YASAKLI = /vestaprime|vestaprimes\.com/i;

function markaKontrol(metin) {
  const e = YASAKLI.exec(String(metin || ''));
  if (e) {
    console.error(
      `  !! TELEGRAM GONDERIMI ENGELLENDI: metinde yasakli marka izi var ("${e[0]}"). ` +
        'Telegram kanallari ayri marka - sablonu duzeltin.',
    );
    return false;
  }
  return true;
}

async function cagir(token, metot, govde, denemeSayisi = 0) {
  const kontrol = new AbortController();
  const zamanlayici = setTimeout(() => kontrol.abort(), ZAMAN_ASIMI_MS);
  try {
    const yanit = await fetch(`${API}/bot${token}/${metot}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(govde),
      signal: kontrol.signal,
    });
    const j = await yanit.json().catch(() => ({}));

    if (!j.ok) {
      // 429: Telegram kac saniye beklememiz gerektigini kendisi soyluyor.
      const bekle = j?.parameters?.retry_after;
      if (yanit.status === 429 && bekle && denemeSayisi < 2) {
        console.warn(`  ! telegram hiz siniri, ${bekle} sn bekleniyor`);
        await new Promise((r) => setTimeout(r, (bekle + 1) * 1000));
        return cagir(token, metot, govde, denemeSayisi + 1);
      }
      throw new Error(`${j.error_code || yanit.status}: ${j.description || 'bilinmeyen hata'}`);
    }
    return j.result;
  } finally {
    clearTimeout(zamanlayici);
  }
}

/** Kanal bazli hiz sinirlama: her sohbetin kendi bekleme sayaci var. */
const sonGonderim = new Map();
async function hizSinirla(chatId) {
  const gecen = Date.now() - (sonGonderim.get(chatId) || 0);
  if (gecen < ARALIK_MS) await new Promise((r) => setTimeout(r, ARALIK_MS - gecen));
  sonGonderim.set(chatId, Date.now());
}

/**
 * Metin mesaji gonderir. Basarisizlik akisi durdurmaz, false doner.
 */
export async function mesajGonder(token, chatId, html, { onizleme = false } = {}) {
  if (!token || !chatId) return false;
  if (!markaKontrol(html)) return false;
  try {
    await hizSinirla(chatId);
    await cagir(token, 'sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: !onizleme },
    });
    return true;
  } catch (err) {
    console.warn(`  ! telegram gonderilemedi (${chatId}): ${err.message}`);
    return false;
  }
}

/** Fotograf gonderir (poster icin). */
export async function fotografGonder(token, chatId, dosyaYolu, aciklamaHtml) {
  if (!token || !chatId) return false;
  if (!markaKontrol(aciklamaHtml)) return false;
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    await hizSinirla(chatId);

    const form = new FormData();
    form.append('chat_id', chatId);
    if (aciklamaHtml) {
      form.append('caption', aciklamaHtml);
      form.append('parse_mode', 'HTML');
    }
    const veri = fs.readFileSync(dosyaYolu);
    form.append('photo', new Blob([veri], { type: 'image/png' }), path.basename(dosyaYolu));

    const kontrol = new AbortController();
    const zamanlayici = setTimeout(() => kontrol.abort(), 60_000);
    try {
      const yanit = await fetch(`${API}/bot${token}/sendPhoto`, {
        method: 'POST',
        body: form,
        signal: kontrol.signal,
      });
      const j = await yanit.json().catch(() => ({}));
      if (!j.ok) throw new Error(`${j.error_code || yanit.status}: ${j.description || 'bilinmeyen hata'}`);
    } finally {
      clearTimeout(zamanlayici);
    }
    return true;
  } catch (err) {
    console.warn(`  ! telegram fotografi gonderilemedi (${chatId}): ${err.message}`);
    return false;
  }
}

/** Bot kimligini dogrular (kurulum testi icin). */
export async function kimlik(token) {
  return cagir(token, 'getMe', {});
}

/** Bot'un gordugu sohbetleri dondurur (kanal kimligi bulmak icin). */
export async function sohbetler(token) {
  const guncellemeler = await cagir(token, 'getUpdates', {});
  const harita = new Map();
  for (const g of guncellemeler || []) {
    const c = g.channel_post?.chat || g.message?.chat || g.my_chat_member?.chat;
    if (c) harita.set(c.id, c);
  }
  return [...harita.values()];
}
