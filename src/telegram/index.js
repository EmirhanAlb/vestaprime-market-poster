import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebClient } from '@slack/web-api';
import { mesajlariCek } from './fetch.js';
import { benzerleriEle } from '../news/state.js';

/**
 * Ceviri motoru. Varsayilan "free": API anahtari ve maliyet gerektirmez.
 * "claude" secilirse ANTHROPIC_API_KEY zorunlu olur.
 */
const MOTOR = (process.env.TRANSLATOR || 'free').toLowerCase();
const { cevir, MODEL } =
  MOTOR === 'claude' ? await import('./translate.js') : await import('./translate-free.js');

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
/** Benzerlik karsilastirmasi icin saklanacak son baslik metni sayisi. */
const METIN_SINIRI = 200;
/**
 * Ayni haberi farkli kelimelerle sayan tekrarlari eleme esigi.
 * Gercek veriyle olculdu: kanalin ayni hikayeyi 5 kez atan varyantlari
 * 0.33-0.93 arasinda, birbirinden bagimsiz basliklar <=0.02. Aradaki bosluk
 * genis oldugu icin 0.30 guvenli.
 */
const BENZERLIK_ESIGI = Number(process.env.TELEGRAM_SIMILARITY || 0.3);

/**
 * Gecmis, blok ID imleci yerine baslik icerik anahtarlariyla tutuluyor:
 * Telegram ardisik mesajlari tek blokta birlestirdigi icin daha once
 * islenmis bir blok sonradan yeni satirlar kazanabiliyor. ID imleci o
 * satirlari sessizce atlardi.
 */
function durumOku() {
  try {
    const d = JSON.parse(fs.readFileSync(DURUM_DOSYASI, 'utf8'));
    if (!Array.isArray(d?.gorulen)) return null;
    return { gorulen: d.gorulen, sonMetinler: Array.isArray(d.sonMetinler) ? d.sonMetinler : [] };
  } catch {
    return null;
  }
}

function durumYaz(gorulen, sonMetinler) {
  fs.mkdirSync(path.dirname(DURUM_DOSYASI), { recursive: true });
  fs.writeFileSync(
    DURUM_DOSYASI,
    `${JSON.stringify(
      {
        gorulen: gorulen.slice(-GECMIS_SINIRI),
        sonMetinler: sonMetinler.slice(-METIN_SINIRI),
        guncelleme: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
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

async function birTur() {
  const gecmis = durumOku();
  const hepsi = await mesajlariCek();
  const blokSayisi = new Set(hepsi.map((m) => m.blokId)).size;
  console.log(
    `Telegram'dan ${blokSayisi} blok icinde ${hepsi.length} baslik okundu (gecmis: ${gecmis ? `${gecmis.gorulen.length} anahtar` : 'yok'})`,
  );

  const gorulen = new Set(gecmis?.gorulen || []);
  const sonMetinler = [...(gecmis?.sonMetinler || [])];
  let yeniler;

  if (gecmis === null) {
    // Ilk calistirma: gecmise donuk akin yapma. Sayfadaki her seyi gorulmus
    // say, sadece en yeni birkac basligi gonder.
    yeniler = hepsi.slice(-ILK_TUR_ADET);
    for (const m of hepsi) gorulen.add(m.anahtar);
    sonMetinler.push(...hepsi.slice(0, -ILK_TUR_ADET).map((m) => m.metin));
    console.log(`Ilk calistirma: en yeni ${yeniler.length} baslikla baslaniyor, kalani gorulmus sayildi.`);
  } else {
    yeniler = hepsi.filter((m) => !gorulen.has(m.anahtar));
  }

  if (yeniler.length === 0) {
    console.log('Yeni baslik yok.');
    return;
  }

  // Kanal ayni hikayeyi farkli kelimelerle tekrar tekrar atiyor (olculen bir
  // ornekte 5 varyant). Hash bunlari yakalayamaz; benzerlik ele.
  const oncesi = yeniler.length;
  // benzerleriEle haber modulunden geliyor ve `baslik` alanina bakiyor.
  yeniler = benzerleriEle(
    yeniler.map((m) => ({ ...m, baslik: m.metin })),
    sonMetinler,
    BENZERLIK_ESIGI,
  ).map(({ baslik, ...m }) => m);
  if (oncesi > yeniler.length) {
    console.log(`  ${oncesi - yeniler.length} baslik ayni haberin tekrari oldugu icin elendi`);
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

  console.log(`${yeniler.length} yeni baslik ceviriliyor - motor: ${MODEL}`);
  const cevrilmis = await cevir(yeniler, process.env.ANTHROPIC_API_KEY);

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
  for (const m of atlananlar) {
    gorulen.add(m.anahtar);
    sonMetinler.push(m.metin);
  }

  let gonderilen = 0;
  for (const mesaj of cevrilmis) {
    const sonuc = await slackeGonder(client, channels, mesaj);
    if (!sonuc.some((s) => s.ok)) {
      // Hicbir kanala gidemedi: gorulmus isaretlemiyoruz ki sonraki turda
      // yeniden denensin, ve siraligi bozmamak icin duruyoruz.
      break;
    }
    gorulen.add(mesaj.anahtar);
    sonMetinler.push(mesaj.metin);
    gonderilen += 1;
    // Slack mesaj hizi sinirina takilmamak icin kisa aralik.
    await new Promise((r) => setTimeout(r, 250));
  }

  durumYaz([...gorulen], sonMetinler);
  console.log(`Tamamlandi. ${gonderilen}/${cevrilmis.length} baslik gonderildi, gecmis ${gorulen.size} anahtar.`);
}

/**
 * Dongu modu.
 *
 * GitHub'in zamanlayicisi sik cron'lari (5 dakikalik) guvenilir sekilde calistirmiyor:
 * olculen davranis, ayarlanan araliktan bagimsiz olarak ~2.5 saatte bir
 * calistirma ve cogu tetiklemenin tamamen dusurulmesi. Bu yuzden tek bir uzun
 * is icinde kendimiz yokluyoruz; is bitince workflow kendini yeniden tetikliyor.
 */
const ARALIK_SN = Number(process.env.LOOP_SECONDS || 300);
const SURE_DK = Number(process.env.LOOP_MINUTES || 330);

async function dongu() {
  const bitis = Date.now() + SURE_DK * 60_000;
  let tur = 0;
  console.log(`Dongu modu: her ${ARALIK_SN} sn, ${SURE_DK} dk boyunca.\n`);

  while (Date.now() < bitis) {
    tur += 1;
    const basla = Date.now();
    console.log(`--- tur ${tur} | ${new Date().toISOString().slice(11, 19)} UTC ---`);
    try {
      await birTur();
    } catch (err) {
      // Tek bir turun hatasi donguyu bitirmemeli: kaynak gecici olarak
      // erisilemez olabilir, bir sonraki turda kendine gelir.
      console.error('  tur hatasi:', err?.message || err);
    }
    const kalan = ARALIK_SN * 1000 - (Date.now() - basla);
    if (kalan > 0 && Date.now() + kalan < bitis) {
      await new Promise((r) => setTimeout(r, kalan));
    } else if (Date.now() + kalan >= bitis) {
      break;
    }
  }
  console.log(`\nDongu tamamlandi: ${tur} tur.`);
}

const calistir = process.argv.includes('--loop') ? dongu : birTur;

calistir()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('HATA:', err?.message || err);
    process.exit(1);
  });
