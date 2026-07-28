import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebClient } from '@slack/web-api';
import { mesajlariCek } from './fetch.js';
import { cevir, MODEL } from './translate.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const DURUM_DOSYASI = path.join(rootDir, 'state', 'seen-telegram.json');
const TZ = process.env.TZ_NAME || 'Europe/Istanbul';

const dryRun = process.argv.includes('--dry-run');
/** Tek turda gonderilecek azami mesaj; kesinti sonrasi akini onler. */
const MAX_GONDERIM = Number(process.env.TELEGRAM_MAX_PER_RUN || 15);
/** Ilk calistirmada (gecmis yokken) alinacak mesaj sayisi. */
const ILK_TUR_ADET = Number(process.env.TELEGRAM_FIRST_RUN || 3);

/** Gecmiste tutulacak azami baslik anahtari. Sayfa 20 blok (~66 baslik)
 *  gosterdigi icin birkac yuz anahtar fazlasiyla yeterli. */
const GECMIS_SINIRI = 600;

/**
 * Gecmis, blok ID imleci yerine baslik icerik anahtarlariyla tutuluyor:
 * Telegram ardisik mesajlari tek blokta birlestirdigi icin daha once
 * islenmis bir blok sonradan yeni satirlar kazanabiliyor. ID imleci o
 * satirlari sessizce atlardi.
 */
function durumOku() {
  try {
    const d = JSON.parse(fs.readFileSync(DURUM_DOSYASI, 'utf8'));
    return Array.isArray(d?.gorulen) ? d.gorulen : null;
  } catch {
    return null;
  }
}

function durumYaz(gorulen) {
  fs.mkdirSync(path.dirname(DURUM_DOSYASI), { recursive: true });
  const kirpilmis = gorulen.slice(-GECMIS_SINIRI);
  fs.writeFileSync(
    DURUM_DOSYASI,
    `${JSON.stringify({ gorulen: kirpilmis, guncelleme: new Date().toISOString() }, null, 2)}\n`,
  );
}

function saat(tarih) {
  const d = tarih instanceof Date && !Number.isNaN(tarih.getTime()) ? tarih : new Date();
  return new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

function kacir(metin) {
  return (metin || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function slackeGonder(client, channels, mesaj) {
  const bloklar = [
    { type: 'section', text: { type: 'mrkdwn', text: `:zap: ${kacir(mesaj.turkce)}` } },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `FinancialJuice  ·  ${saat(mesaj.tarih)}  ·  <${mesaj.link}|kaynak>${
            mesaj.cevrildi ? '' : '  ·  _çeviri yapılamadı_'
          }`,
        },
      ],
    },
  ];

  const sonuclar = [];
  for (const channel of channels) {
    try {
      const res = await client.chat.postMessage({
        channel,
        text: mesaj.turkce.slice(0, 300),
        blocks: bloklar,
        unfurl_links: false,
        unfurl_media: false,
      });
      if (!res.ok) throw new Error(JSON.stringify(res));
      sonuclar.push({ channel, ok: true });
    } catch (err) {
      const hata = err?.data?.error || err?.message || String(err);
      console.error(`  ${channel}: HATA -> ${hata}`);
      sonuclar.push({ channel, ok: false });
    }
  }
  return sonuclar;
}

async function main() {
  const gecmis = durumOku();
  const hepsi = await mesajlariCek();
  const blokSayisi = new Set(hepsi.map((m) => m.blokId)).size;
  console.log(
    `Telegram'dan ${blokSayisi} blok icinde ${hepsi.length} baslik okundu (gecmis: ${gecmis ? `${gecmis.length} anahtar` : 'yok'})`,
  );

  const gorulen = new Set(gecmis || []);
  let yeniler;

  if (gecmis === null) {
    // Ilk calistirma: gecmise donuk akin yapma. Sayfadaki her seyi gorulmus
    // say, sadece en yeni birkac basligi gonder.
    yeniler = hepsi.slice(-ILK_TUR_ADET);
    for (const m of hepsi) gorulen.add(m.anahtar);
    console.log(`Ilk calistirma: en yeni ${yeniler.length} baslikla baslaniyor, kalani gorulmus sayildi.`);
  } else {
    yeniler = hepsi.filter((m) => !gorulen.has(m.anahtar));
  }

  if (yeniler.length === 0) {
    console.log('Yeni baslik yok.');
    return;
  }

  let atlananlar = [];
  if (yeniler.length > MAX_GONDERIM) {
    // Sessiz kirpma yok: atlanan basliklar hem loglanir hem de gorulmus
    // isaretlenir, aksi halde her turda yeniden denenip tavana carparlar.
    atlananlar = yeniler.slice(0, yeniler.length - MAX_GONDERIM);
    console.warn(
      `Uyari: ${yeniler.length} yeni baslik var, en yeni ${MAX_GONDERIM} tanesi gonderilecek (${atlananlar.length} baslik atlaniyor).`,
    );
    yeniler = yeniler.slice(-MAX_GONDERIM);
  }

  let cevrilmis;
  if (dryRun && !process.env.ANTHROPIC_API_KEY) {
    // Anahtar olmadan da boru hattinin geri kalani (okuma, gecmis, bicim)
    // dogrulanabilsin diye ceviri atlanir. Gercek gonderimde anahtar sarttir.
    console.warn('Uyari: ANTHROPIC_API_KEY yok, --dry-run oldugu icin ceviri atlaniyor.');
    cevrilmis = yeniler.map((m) => ({ ...m, turkce: m.metin, cevrildi: false }));
  } else {
    console.log(`${yeniler.length} yeni mesaj ${MODEL} ile Turkce'ye cevriliyor...`);
    cevrilmis = await cevir(yeniler, process.env.ANTHROPIC_API_KEY);
  }

  for (const m of cevrilmis) {
    console.log(`  [${m.blokId}] ${m.cevrildi ? '' : '(CEVIRISIZ) '}${m.turkce.slice(0, 90)}`);
  }

  if (dryRun) {
    console.log('\n--dry-run: Slack gonderimi atlandi, gecmis guncellenmedi.');
    return;
  }

  const token = process.env.SLACK_BOT_TOKEN;
  const channels = (process.env.TELEGRAM_CHANNEL_ID || process.env.SLACK_CHANNEL_ID || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  if (!token || channels.length === 0) {
    throw new Error('SLACK_BOT_TOKEN ve TELEGRAM_CHANNEL_ID tanimli degil.');
  }

  const client = new WebClient(token);
  console.log(`\nSlack'e gonderiliyor (${channels.length} kanal)...`);

  // Atlananlar gonderilmedi ama gorulmus sayilir; yoksa her turda yeniden
  // kuyruga girip tavani doldururlar.
  for (const m of atlananlar) gorulen.add(m.anahtar);

  let gonderilen = 0;
  for (const mesaj of cevrilmis) {
    const sonuc = await slackeGonder(client, channels, mesaj);
    if (!sonuc.some((s) => s.ok)) {
      // Hicbir kanala gidemedi: gorulmus isaretlemiyoruz ki sonraki turda
      // yeniden denensin, ve siraligi bozmamak icin duruyoruz.
      break;
    }
    gorulen.add(mesaj.anahtar);
    gonderilen += 1;
    // Slack mesaj hizi sinirina takilmamak icin kisa aralik.
    await new Promise((r) => setTimeout(r, 250));
  }

  durumYaz([...gorulen]);
  console.log(`Tamamlandi. ${gonderilen}/${cevrilmis.length} baslik gonderildi, gecmis ${gorulen.size} anahtar.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('HATA:', err?.message || err);
    process.exit(1);
  });
