import fs from 'node:fs';
import { chromium } from 'playwright';

const LOGO_DIR = '/Users/emirhanalbayrak/Desktop/Emirhan Albayrak/vestaprime/vestaprime logos';
const OUT_DIR = '/Users/emirhanalbayrak/Desktop/Emirhan Albayrak/vestaprime/slack otomasyonu/assets';
const SIZE = 512;

const b64 = (f) => `data:image/png;base64,${fs.readFileSync(`${LOGO_DIR}/${f}`).toString('base64')}`;
const colorLogo = b64('main icon.png');
const whiteLogo = b64('main icon white.png');

const variants = [
  { name: 'slack-app-icon-light', bg: '#ffffff', logo: colorLogo, pad: 15 },
  { name: 'slack-app-icon-dark', bg: 'linear-gradient(160deg,#181c22 0%,#0b0d11 100%)', logo: colorLogo, pad: 15 },
  { name: 'slack-app-icon-orange', bg: 'linear-gradient(150deg,#f6a45c 0%,#ed7a2b 55%,#d9631a 100%)', logo: whiteLogo, pad: 17 },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });

for (const v of variants) {
  await page.setContent(`
    <style>
      html,body{margin:0;padding:0}
      .icon{width:${SIZE}px;height:${SIZE}px;background:${v.bg};display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:${v.pad}%}
      .icon img{width:100%;height:100%;object-fit:contain;display:block}
    </style>
    <div class="icon"><img src="${v.logo}"></div>
  `);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0));
  await page.locator('.icon').screenshot({ path: `${OUT_DIR}/${v.name}.png`, type: 'png' });
  console.log(`${v.name}.png hazir`);
}

await browser.close();
