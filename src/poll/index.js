import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebClient } from '@slack/web-api';
import { altinFiyati, fiyatYaz } from './price.js';
import { bugunSaat, saatCoz, trSaat, trTarih, bekle } from './time.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const KAYIT_DOSYASI = path.join(rootDir, 'state', 'poll-history.json');
const AKTIF_DOSYASI = path.join(rootDir, 'state', 'poll-active.json');
const dryRun = process.argv.includes('--dry-run');
/**
 * Sonuclandirma modu: daha once paylasilmis bir oylamayi simdi sonuclandirir.
 * Hem testi kolaylastirir hem de is ortasinda coktuyse kurtarma saglar.
 */
const settleMode = process.argv.includes('--settle');

function arg(ad) {
  const i = process.argv.indexOf(ad);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function aktifOku() {
  try {
    return JSON.parse(fs.readFileSync(AKTIF_DOSYASI, 'utf8'));
  } catch {
    return null;
  }
}

function aktifYaz(veri) {
  fs.mkdirSync(path.dirname(AKTIF_DOSYASI), { recursive: true });
  fs.writeFileSync(AKTIF_DOSYASI, `${JSON.stringify(veri, null, 2)}\n`);
}

function aktifSil() {
  try {
    fs.unlinkSync(AKTIF_DOSYASI);
  } catch {
    /* yoksa sorun degil */
  }
}

/** Oylama mesajinin paylasilacagi saat (Turkiye). */
const [PAYLAS_S, PAYLAS_D] = saatCoz(process.env.POLL_POST_TR, [14, 0]);
/** ABD borsasinin acilis saati (New York). Yaz saatini kendisi cozer. */
const [ACILIS_S, ACILIS_D] = saatCoz(process.env.POLL_OPEN_NY, [9, 30]);
/** Acilistan kac dakika sonra sonuc aciklanir. */
const SONUC_DK = Number(process.env.POLL_SETTLE_MINUTES || 60);

/** Bu bandin icindeki hareket "duragan" sayilir (yuzde). */
const DURAGAN_BANDI = Number(process.env.POLL_FLAT_BAND || 0.15);
/** Bu esigi asan hareket "sert" sayilir ve kutlama dozu artar (yuzde). */
const SERT_ESIK = Number(process.env.POLL_SHARP_BAND || 0.5);

const SECENEKLER = [
  { yon: 'yukari', emoji: 'chart_with_upwards_trend', etiket: 'Yukarı', gorsel: ':chart_with_upwards_trend:' },
  { yon: 'asagi', emoji: 'chart_with_downwards_trend', etiket: 'Aşağı', gorsel: ':chart_with_downwards_trend:' },
  { yon: 'duragan', emoji: 'left_right_arrow', etiket: 'Durağan', gorsel: ':left_right_arrow:' },
];

function kanallar() {
  return (process.env.POLL_CHANNEL_ID || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}

function kayitEkle(kayit) {
  let gecmis = [];
  try {
    gecmis = JSON.parse(fs.readFileSync(KAYIT_DOSYASI, 'utf8'))?.oylamalar || [];
  } catch {
    gecmis = [];
  }
  gecmis.push(kayit);
  fs.mkdirSync(path.dirname(KAYIT_DOSYASI), { recursive: true });
  fs.writeFileSync(KAYIT_DOSYASI, `${JSON.stringify({ oylamalar: gecmis.slice(-120) }, null, 2)}\n`);
}

// --- 1) OYLAMAYI PAYLAS ----------------------------------------------------

async function oylamaPaylas(client, kanal, acilisAni, sonucAni, baslangicFiyat) {
  const bloklar = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `:bar_chart: *GÜNÜN TAHMİNİ — ${trTarih(new Date())}*\n\n` +
          `ABD piyasası *${trSaat(acilisAni)}*'da açılıyor.\n` +
          `*Altın (XAU/USD)* açılıştan sonraki 1 saatte nasıl seyreder?`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: SECENEKLER.map((s) => `${s.gorsel}  *${s.etiket}*`).join('\n'),
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text:
            `Şu anki fiyat: *$${fiyatYaz(baslangicFiyat)}*  ·  ` +
            `Sonuç *${trSaat(sonucAni)}*'da açıklanır  ·  ` +
            `Tek seçenek işaretleyin — birden fazlası geçersiz sayılır`,
        },
      ],
    },
  ];

  const res = await client.chat.postMessage({
    channel: kanal,
    text: `GÜNÜN TAHMİNİ — Altın açılıştan sonra nasıl seyreder?`,
    blocks: bloklar,
    unfurl_links: false,
  });
  if (!res.ok) throw new Error(JSON.stringify(res));

  // Secenek emojilerini onceden koyuyoruz ki tek tikla oy verilebilsin.
  for (const secenek of SECENEKLER) {
    try {
      await client.reactions.add({ channel: kanal, timestamp: res.ts, name: secenek.emoji });
    } catch (err) {
      console.warn(`  ! ${secenek.emoji} tepkisi eklenemedi: ${err?.data?.error || err.message}`);
    }
  }

  console.log(`  ${kanal}: oylama paylasildi (ts ${res.ts})`);
  return res.ts;
}

// --- 2) OYLARI OKU ---------------------------------------------------------

/**
 * Oylari okur. Birden fazla secenek isaretleyen kullanicilar gecersiz sayilir:
 * emoji tepkileriyle "tek oy" teknik olarak zorlanamiyor, bu yuzden kural
 * sayim aninda uygulaniyor ve sonuc mesajinda belirtiliyor.
 */
async function oylariOku(client, kanal, ts, botKullanici) {
  const res = await client.reactions.get({ channel: kanal, timestamp: ts, full: true });
  if (!res.ok) throw new Error(JSON.stringify(res));

  const tepkiler = res.message?.reactions || [];
  const kullaniciOylari = new Map(); // kullanici -> [yon...]

  for (const tepki of tepkiler) {
    const secenek = SECENEKLER.find((s) => s.emoji === tepki.name);
    if (!secenek) continue;
    for (const kullanici of tepki.users || []) {
      if (kullanici === botKullanici) continue;
      if (!kullaniciOylari.has(kullanici)) kullaniciOylari.set(kullanici, []);
      kullaniciOylari.get(kullanici).push(secenek.yon);
    }
  }

  const gecerli = new Map(); // kullanici -> yon
  const gecersiz = [];
  for (const [kullanici, yonler] of kullaniciOylari) {
    if (yonler.length === 1) gecerli.set(kullanici, yonler[0]);
    else gecersiz.push(kullanici);
  }
  return { gecerli, gecersiz };
}

// --- 3) SONUCU ACIKLA ------------------------------------------------------

function yonBelirle(degisimYuzde) {
  if (Math.abs(degisimYuzde) < DURAGAN_BANDI) return 'duragan';
  return degisimYuzde > 0 ? 'yukari' : 'asagi';
}

async function sonucPaylas(client, kanal, ts, veri) {
  const { acilisFiyat, kapanisFiyat, degisim, yon, gecerli, gecersiz } = veri;
  const secenek = SECENEKLER.find((s) => s.yon === yon);
  const sert = Math.abs(degisim) >= SERT_ESIK;

  const kazananlar = [...gecerli.entries()].filter(([, y]) => y === yon).map(([k]) => k);
  const dagilim = SECENEKLER.map((s) => {
    const adet = [...gecerli.values()].filter((y) => y === s.yon).length;
    return `${s.gorsel} ${s.etiket}: *${adet}*`;
  }).join('   ·   ');

  const isaret = degisim > 0 ? '+' : '';
  const bloklar = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `${sert ? ':rotating_light:' : ':checkered_flag:'} *SONUÇ — Altın (XAU/USD)*\n\n` +
          `Açılış: *$${fiyatYaz(acilisFiyat)}*  →  1 saat sonra: *$${fiyatYaz(kapanisFiyat)}*\n` +
          `Değişim: *${isaret}${degisim.toFixed(2)}%* → ${secenek.gorsel} *${secenek.etiket}*` +
          (sert ? '  _(sert hareket)_' : ''),
      },
    },
    { type: 'section', text: { type: 'mrkdwn', text: `Oy dağılımı:  ${dagilim}` } },
  ];

  if (kazananlar.length) {
    const etiketler = kazananlar.map((k) => `<@${k}>`).join(' ');
    bloklar.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: sert
          ? `:trophy: *Sert hareketi bilenler!* ${etiketler}\nTebrikler, yönü tam isabet okudunuz.`
          : `:tada: *Doğru bilenler:* ${etiketler}\nTebrikler!`,
      },
    });
  } else if (gecerli.size > 0) {
    bloklar.push({
      type: 'section',
      text: { type: 'mrkdwn', text: ':see_no_evil: Bu kez kimse tutturamadı. Yarın yeniden!' },
    });
  } else {
    bloklar.push({ type: 'section', text: { type: 'mrkdwn', text: '_Bu oylamaya geçerli oy verilmedi._' } });
  }

  if (gecersiz.length) {
    bloklar.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `:warning: ${gecersiz.length} kişi birden fazla seçenek işaretlediği için geçersiz sayıldı.`,
        },
      ],
    });
  }

  const res = await client.chat.postMessage({
    channel: kanal,
    thread_ts: ts,
    reply_broadcast: true, // sonuc kanalda da gorunsun
    text: `SONUÇ — Altın ${isaret}${degisim.toFixed(2)}%`,
    blocks: bloklar,
    unfurl_links: false,
  });
  if (!res.ok) throw new Error(JSON.stringify(res));
  console.log(`  ${kanal}: sonuc paylasildi (${kazananlar.length} kazanan, ${gecersiz.length} gecersiz)`);
}

// --- ANA AKIS --------------------------------------------------------------

/** Bir oylamayi sonuclandirir: oylari okur, sonucu paylasir, gecmise yazar. */
async function sonuclandir(client, botKullanici, mesajlar, acilisFiyat, kapanisFiyat) {
  const degisim = ((kapanisFiyat - acilisFiyat) / acilisFiyat) * 100;
  const yon = yonBelirle(degisim);
  console.log(
    `Acilis $${fiyatYaz(acilisFiyat)} -> kapanis $${fiyatYaz(kapanisFiyat)} | ` +
      `degisim ${degisim.toFixed(2)}% -> ${yon}`,
  );

  for (const { kanal, ts } of mesajlar) {
    try {
      const { gecerli, gecersiz } = await oylariOku(client, kanal, ts, botKullanici);
      await sonucPaylas(client, kanal, ts, { acilisFiyat, kapanisFiyat, degisim, yon, gecerli, gecersiz });
      kayitEkle({
        tarih: trTarih(new Date()),
        kanal,
        ts,
        acilisFiyat,
        kapanisFiyat,
        degisim: Number(degisim.toFixed(3)),
        yon,
        oySayisi: gecerli.size,
        gecersiz: gecersiz.length,
        kazananlar: [...gecerli.entries()].filter(([, y]) => y === yon).map(([k]) => k),
      });
    } catch (err) {
      console.error(`  ${kanal}: sonuc paylasilamadi -> ${err?.data?.error || err.message}`);
      throw err;
    }
  }
  aktifSil();
}

async function main() {
  const token = process.env.SLACK_BOT_TOKEN;
  const hedefler = kanallar();
  if (!token || hedefler.length === 0) throw new Error('SLACK_BOT_TOKEN ve POLL_CHANNEL_ID tanimli degil.');

  const client = new WebClient(token);
  const kimlik = await client.auth.test();
  const botKullanici = kimlik.user_id;

  // --settle: onceden paylasilmis bir oylamayi simdi sonuclandir.
  if (settleMode) {
    const aktif = aktifOku();
    const ts = arg('--ts') || aktif?.mesajlar?.[0]?.ts;
    const kanal = arg('--kanal') || aktif?.mesajlar?.[0]?.kanal || hedefler[0];
    const acilisFiyat = Number(arg('--acilis') || aktif?.acilisFiyat || aktif?.baslangicFiyat);

    if (!ts) throw new Error('Sonuclandirilacak oylama yok. --ts <zaman damgasi> verin.');
    if (!Number.isFinite(acilisFiyat)) throw new Error('Acilis fiyati bilinmiyor. --acilis <fiyat> verin.');

    const { fiyat: kapanisFiyat } = await altinFiyati();
    await sonuclandir(client, botKullanici, [{ kanal, ts }], acilisFiyat, kapanisFiyat);
    return;
  }

  const paylasAni = bugunSaat(PAYLAS_S, PAYLAS_D, 'Europe/Istanbul');
  const acilisAni = bugunSaat(ACILIS_S, ACILIS_D, 'America/New_York');
  const sonucAni = new Date(acilisAni.getTime() + SONUC_DK * 60_000);

  console.log(`Oylama    : ${trSaat(paylasAni)} TR`);
  console.log(`ABD acilis: ${trSaat(acilisAni)} TR`);
  console.log(`Sonuc     : ${trSaat(sonucAni)} TR`);
  console.log(`Kanallar  : ${hedefler.join(', ')}\n`);

  if (dryRun) {
    const { fiyat, kaynak } = await altinFiyati();
    console.log(`--dry-run: guncel altin $${fiyatYaz(fiyat)} (${kaynak}). Gonderim yapilmadi.`);
    return;
  }

  // GitHub'in zamanlayicisi isi cok gec baslatmis olabilir. Acilis gecmisse
  // oylamanin anlami kalmaz: paylasilir paylasilmaz sonuclanirdi.
  const paySuresiKaldi = acilisAni.getTime() - Date.now();
  if (paySuresiKaldi < 5 * 60_000) {
    console.log(
      `Atlaniyor: ABD acilisina ${Math.round(paySuresiKaldi / 60000)} dk kaldi, ` +
        'oylama icin anlamli sure yok. Yarin yeniden denenecek.',
    );
    return;
  }

  // 1) Oylamayi paylas
  await bekle(paylasAni, 'Oylama saati');
  const { fiyat: baslangicFiyat, kaynak } = await altinFiyati();
  console.log(`Baslangic fiyati: $${fiyatYaz(baslangicFiyat)} (${kaynak})`);

  const mesajlar = [];
  for (const kanal of hedefler) {
    try {
      mesajlar.push({ kanal, ts: await oylamaPaylas(client, kanal, acilisAni, sonucAni, baslangicFiyat) });
    } catch (err) {
      console.error(`  ${kanal}: oylama paylasilamadi -> ${err?.data?.error || err.message}`);
    }
  }
  if (mesajlar.length === 0) throw new Error('Hicbir kanala oylama paylasilamadi.');

  // Durumu diske yaz: is bu noktadan sonra coker veya kesilirse oylama
  // "--settle" ile sonradan sonuclandirilabilsin.
  aktifYaz({ mesajlar, baslangicFiyat, paylasildi: new Date().toISOString() });

  // 2) Acilis fiyatini yakala
  await bekle(acilisAni, 'ABD acilisi');
  const { fiyat: acilisFiyat } = await altinFiyati();
  console.log(`Acilis fiyati: $${fiyatYaz(acilisFiyat)}`);
  aktifYaz({ mesajlar, baslangicFiyat, acilisFiyat, paylasildi: new Date().toISOString() });

  // 3) Bir saat sonra sonucu hesapla ve acikla
  await bekle(sonucAni, 'Sonuc saati');
  const { fiyat: kapanisFiyat } = await altinFiyati();
  await sonuclandir(client, botKullanici, mesajlar, acilisFiyat, kapanisFiyat);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('HATA:', err?.message || err);
    process.exit(1);
  });
