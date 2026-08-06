/**
 * Telegram Bot API istemcisi - CIKIS yonu.
 *
 * Dikkat: bu klasor Telegram'a YAZAR. src/telegram/ ise Telegram'dan OKUR
 * (FinancialJuice kanalinin web onizlemesini ayristirir). Ikisi farkli isler,
 * bilerek ayri tutuldu.
 *
 * Gonderimler bilerek "yumusak" hata veriyor: Telegram tarafindaki bir sorun
 * Slack akisini durdurmamali. Her gonderim kendi icinde yakalanir ve uyari
 * olarak loglanir.
 */

const API = 'https://api.telegram.org';
const ZAMAN_ASIMI_MS = 20_000;
/**
 * Telegram kanal basina dakikada ~20 mesaja izin veriyor. Aralik birakmazsak
 * FinancialJuice'un 15 mesajlik turlari sinira dayaniyor.
 */
const ARALIK_MS = Number(process.env.TELEGRAM_OUT_DELAY_MS || 3000);

function token() {
  return process.env.TELEGRAM_BOT_TOKEN || '';
}

/** Telegram HTML modunda anlam tasiyan karakterleri kacirir. */
export function kacir(metin) {
  return String(metin ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function cagir(metot, govde, denemeSayisi = 0) {
  const kontrol = new AbortController();
  const zamanlayici = setTimeout(() => kontrol.abort(), ZAMAN_ASIMI_MS);
  try {
    const yanit = await fetch(`${API}/bot${token()}/${metot}`, {
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
        return cagir(metot, govde, denemeSayisi + 1);
      }
      throw new Error(`${j.error_code || yanit.status}: ${j.description || 'bilinmeyen hata'}`);
    }
    return j.result;
  } finally {
    clearTimeout(zamanlayici);
  }
}

/**
 * Marka korumasi. Telegram kanali ayri bir marka; buradan cikan hicbir
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
        'Telegram kanali ayri marka - sablonu duzeltin.',
    );
    return false;
  }
  return true;
}

/** Bot yapilandirilmis mi? Degilse tum gonderimler sessizce atlanir. */
export function etkinMi(chatId) {
  return Boolean(token() && chatId);
}

/** Kanal kimliklerini virgulle ayrilmis listeden cozer. */
export function kanallar(deger) {
  return String(deger || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}

let sonGonderim = 0;
async function hizSinirla() {
  const gecen = Date.now() - sonGonderim;
  if (gecen < ARALIK_MS) await new Promise((r) => setTimeout(r, ARALIK_MS - gecen));
  sonGonderim = Date.now();
}

/**
 * Metin mesaji gonderir. Basarisizlik akisi durdurmaz, false doner.
 * @param {string} chatId  -100... veya @kanaladi
 * @param {string} html    Telegram HTML bicimi
 */
export async function mesajGonder(chatId, html, { onizleme = false } = {}) {
  if (!etkinMi(chatId)) return false;
  if (!markaKontrol(html)) return false;
  try {
    await hizSinirla();
    await cagir('sendMessage', {
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

/**
 * Fotograf gonderir (poster icin). Dosya multipart olarak yuklenir.
 */
export async function fotografGonder(chatId, dosyaYolu, aciklamaHtml) {
  if (!etkinMi(chatId)) return false;
  if (!markaKontrol(aciklamaHtml)) return false;
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    await hizSinirla();

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
      const yanit = await fetch(`${API}/bot${token()}/sendPhoto`, {
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
export async function kimlik() {
  return cagir('getMe', {});
}
