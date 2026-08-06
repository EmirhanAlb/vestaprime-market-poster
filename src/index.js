import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capturePoster } from './capture.js';
import { uploadPosterToSlack } from './slack.js';
import { posterGonder } from './telegram-out/index.js';

// Lokal calistirmada .env dosyasini oku (GitHub Actions'ta secrets zaten env olarak gelir).
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const dryRun = process.argv.includes('--dry-run');
const TZ = process.env.TZ_NAME || 'Europe/Istanbul';

function stamp() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('tr-TR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    file: `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}`,
    human: `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`,
  };
}

async function main() {
  const { file, human } = stamp();
  const outDir = path.join(rootDir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `vestaprime-market-${file}.png`);

  console.log(`Poster yakalaniyor -> ${outPath}`);
  const result = await capturePoster(outPath);
  const bytes = fs.statSync(outPath).size;
  console.log(`Yakalandi (${(bytes / 1024).toFixed(0)} KB) | durum: ${result.status || 'bilinmiyor'}`);

  if (dryRun) {
    console.log('--dry-run: Slack gonderimi atlandi.');
    return;
  }

  const token = process.env.SLACK_BOT_TOKEN;
  // Birden fazla kanal icin virgulle ayrilmis liste verilebilir: "C123,C456"
  const channels = (process.env.SLACK_CHANNEL_ID || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  if (!token || channels.length === 0) {
    throw new Error('SLACK_BOT_TOKEN ve SLACK_CHANNEL_ID tanimli degil. .env dosyasina veya GitHub secrets\'a ekleyin.');
  }

  const warn = result.live ? '' : '\n_(Not: fiyatlar canli akisa gecmeden yakalandi.)_';
  console.log(`Slack'e gonderiliyor (${channels.length} kanal)...`);
  const results = await uploadPosterToSlack({
    token,
    channels,
    filePath: outPath,
    title: `Vestaprime — Canli Piyasalar ${human}`,
    comment: `:chart_with_upwards_trend: *Canli Piyasalar* — ${human}\n<https://vestaprimes.com/en/market-poster|vestaprimes.com>${warn}`,
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`Ozet: ${results.length - failed.length}/${results.length} kanal basarili`);

  // Telegram cikisi opsiyonel; TELEGRAM_OUT_POSTER bos ise atlanir.
  await posterGonder({ dosyaYolu: outPath, saat: human, canli: result.live });

  // Bir kanal basarisiz olsa bile digerlerine gonderim yapildi; yine de
  // calistirmayi hatali isaretliyoruz ki Actions'ta gozden kacmasin.
  if (failed.length) {
    throw new Error(`Su kanallara gonderilemedi: ${failed.map((f) => `${f.channel} (${f.error})`).join(', ')}`);
  }

  // Actions calistirmalarinda diski sisirmemek icin dosyayi birak, calisma zaten efemer.
  if (process.env.KEEP_LOCAL_FILE !== '1' && process.env.CI) fs.unlinkSync(outPath);
}

main().catch((err) => {
  console.error('HATA:', err?.message || err);
  process.exit(1);
});
