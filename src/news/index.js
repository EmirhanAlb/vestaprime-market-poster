import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from './sources.js';
import { haberleriTopla } from './feed.js';
import { skorla, MIN_SKOR } from './score.js';
import { durumOku, durumYaz, benzerleriEle } from './state.js';
import { haberGonder } from './slack-news.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const DURUM_DOSYASI = path.join(rootDir, 'state', 'seen-news.json');

const dryRun = process.argv.includes('--dry-run');
const TZ = process.env.TZ_NAME || 'Europe/Istanbul';
/** Bundan eski haberler "son dakika" sayilmaz. */
const MAX_YAS_SAAT = Number(process.env.NEWS_MAX_AGE_HOURS || 3);
/** Tek calistirmada gonderilecek azami haber; ani akin olursa kanali bogmaz. */
const MAX_GONDERIM = Number(process.env.NEWS_MAX_PER_RUN || 3);

async function main() {
  const gonderilenler = durumOku(DURUM_DOSYASI);
  const gorulen = new Set(gonderilenler.map((g) => g.anahtar));
  console.log(`Kayitli gecmis: ${gonderilenler.length} haber`);

  const hepsi = await haberleriTopla(SOURCES);
  console.log(`${SOURCES.length} kaynaktan ${hepsi.length} benzersiz haber okundu`);

  const simdi = Date.now();
  const yasSiniri = simdi - MAX_YAS_SAAT * 60 * 60 * 1000;

  const adaylar = hepsi
    .filter((h) => !gorulen.has(h.anahtar))
    .filter((h) => h.tarih && h.tarih.getTime() >= yasSiniri)
    .map((h) => ({ ...h, ...skorla(h.baslik, h.kaynak) }))
    .filter((h) => h.gecti)
    .sort((a, b) => b.skor - a.skor);

  console.log(`Esigi (${MIN_SKOR}) gecen, son ${MAX_YAS_SAAT} saatlik yeni haber: ${adaylar.length}`);

  // Ayni olayin kopyalarini teke indir. Karsilastirma son 24 saatte gonderilmis
  // basliklara karsi da yapilir ki tavana takilip sonraki tura kalan kopya
  // tekrar gonderilmesin.
  const sonGunBasliklari = gonderilenler
    .filter((g) => (g.ts || 0) > simdi - 24 * 60 * 60 * 1000)
    .map((g) => g.baslik || '');
  const tekil = benzerleriEle(adaylar, sonGunBasliklari);
  const secilenler = tekil.slice(0, MAX_GONDERIM);
  if (adaylar.length > tekil.length) {
    console.log(`  ${adaylar.length - tekil.length} tanesi ayni olayin kopyasi oldugu icin elendi`);
  }
  if (tekil.length > secilenler.length) {
    console.log(`  ${tekil.length - secilenler.length} tanesi tur basi ${MAX_GONDERIM} tavani nedeniyle sonraki tura kaldi`);
  }

  if (secilenler.length === 0) {
    console.log('Gonderilecek yeni son dakika haberi yok.');
    return;
  }

  for (const h of secilenler) {
    console.log(`  [${h.skor}] ${h.baslik}`);
    console.log(`        ${h.detay}`);
  }

  if (dryRun) {
    console.log('\n--dry-run: Slack gonderimi atlandi, gecmis guncellenmedi.');
    return;
  }

  const token = process.env.SLACK_BOT_TOKEN;
  const channels = (process.env.NEWS_CHANNEL_ID || process.env.SLACK_CHANNEL_ID || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  if (!token || channels.length === 0) {
    throw new Error('SLACK_BOT_TOKEN ve NEWS_CHANNEL_ID tanimli degil.');
  }

  console.log(`\nSlack'e gonderiliyor (${channels.length} kanal)...`);
  const basarisizlar = [];

  for (const haber of secilenler) {
    const sonuc = await haberGonder({ token, channels, haber, tz: TZ });
    const hatalar = sonuc.filter((s) => !s.ok);
    if (hatalar.length === sonuc.length) {
      // Hicbir kanala gidemediyse gecmise yazma; bir sonraki calistirma yeniden denesin.
      basarisizlar.push(haber);
      continue;
    }
    gonderilenler.push({ anahtar: haber.anahtar, ts: simdi, baslik: haber.baslik.slice(0, 120) });
    console.log(`  gonderildi: ${haber.baslik.slice(0, 70)}`);
  }

  durumYaz(DURUM_DOSYASI, gonderilenler);
  console.log(`Gecmis guncellendi: ${DURUM_DOSYASI}`);

  if (basarisizlar.length) {
    throw new Error(`${basarisizlar.length} haber hicbir kanala gonderilemedi.`);
  }
}

main()
  .then(() => {
    // Zaman asimina ugrayan feed soketleri acik kalabiliyor ve Node cikmiyor.
    // Cron'da calistigimiz icin isi bitirince acikca cikiyoruz.
    process.exit(0);
  })
  .catch((err) => {
    console.error('HATA:', err?.message || err);
    process.exit(1);
  });
