import { chromium } from 'playwright';

const POSTER_URL = process.env.POSTER_URL || 'https://vestaprimes.com/en/market-poster';
const POSTER_WIDTH = 1080;
const POSTER_HEIGHT = 1350;

// Sayfa canli fiyatlari Binance / CoinGecko / open.er-api'den cekiyor.
// Fiyatlar gelene kadar satirlarda "·····" (vpmp-row__price--pending) ve
// durum rozetinde vpmp__live--connecting sinifi duruyor. Bunlarin gecmesini bekliyoruz.
const LIVE_TIMEOUT_MS = Number(process.env.LIVE_TIMEOUT_MS || 60_000);

/**
 * market-poster sayfasini acar, fiyatlar yuklenene kadar bekler ve
 * poster kartini 1080x1350 PNG olarak diske yazar.
 *
 * @param {string} outPath PNG'nin yazilacagi dosya yolu
 * @returns {Promise<{path: string, status: string, stamp: string, live: boolean}>}
 */
export async function capturePoster(outPath) {
  const browser = await chromium.launch({
    args: ['--font-render-hinting=none', '--force-color-profile=srgb'],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: POSTER_WIDTH, height: POSTER_HEIGHT },
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: process.env.TZ_NAME || 'Europe/Istanbul',
      colorScheme: 'dark',
    });
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') console.warn('[sayfa hatasi]', msg.text());
    });

    await page.goto(POSTER_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('.vpmp', { timeout: 60_000 });

    // Fiyatlarin gelmesini bekle. Gelmezse yine de poster'i cekiyoruz ama
    // "live" olmadigini raporluyoruz ki Slack mesajinda belli olsun.
    let live = true;
    try {
      await page.waitForFunction(
        () =>
          document.querySelector('.vpmp__live--live') !== null &&
          document.querySelectorAll('.vpmp-row__price--pending').length === 0,
        null,
        { timeout: LIVE_TIMEOUT_MS },
      );
    } catch {
      live = false;
      console.warn(`Uyari: ${LIVE_TIMEOUT_MS}ms icinde "live" durumuna gecilmedi, mevcut haliyle cekiliyor.`);
    }

    // Sayfa karti ekrana sigdirmak icin CSS transform ile kucultuyor (--s degiskeni).
    // Birebir 1080x1350 cekmek icin olcegi 1'e sabitliyoruz.
    await page.addStyleTag({
      content: `
        .vpmp-stage { padding: 0 !important; min-height: 0 !important; gap: 0 !important; }
        .vpmp-bar { display: none !important; }
        .vpmp-fitbox {
          --s: 1 !important;
          width: ${POSTER_WIDTH}px !important;
          height: ${POSTER_HEIGHT}px !important;
          border-radius: 0 !important;
          box-shadow: none !important;
        }
        .vpmp-scale { transform: none !important; }
      `,
    });

    // Fontlar ve gorseller (logo vb.) hazir olmadan cekersek eksik render riski var.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.vpmp img')).every((img) => img.complete && img.naturalWidth > 0),
      null,
      { timeout: 15_000 },
    ).catch(() => console.warn('Uyari: bazi gorseller yuklenmedi.'));

    // Layout'un oturmasi icin kisa bir soluklanma.
    await page.waitForTimeout(600);

    const card = page.locator('.vpmp');
    const box = await card.boundingBox();
    if (!box) throw new Error('Poster karti (.vpmp) sayfada bulunamadi.');
    console.log(`Kart olculeri: ${Math.round(box.width)}x${Math.round(box.height)}`);

    await card.screenshot({ path: outPath, type: 'png' });

    const status = (await page.locator('.vpmp__live').first().innerText().catch(() => '')).trim();
    const stamp = (await page.locator('.vpmp__stamp').first().innerText().catch(() => '')).trim();

    return { path: outPath, status, stamp, live };
  } finally {
    await browser.close();
  }
}
