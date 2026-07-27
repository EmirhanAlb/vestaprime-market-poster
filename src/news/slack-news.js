import { WebClient } from '@slack/web-api';

const KATEGORI_EMOJI = {
  Ekonomi: ':bar_chart:',
  Emtia: ':oil_drum:',
  Döviz: ':currency_exchange:',
  Kripto: ':coin:',
  Borsa: ':chart_with_upwards_trend:',
};

function saatDamgasi(tarih, tz) {
  const d = tarih instanceof Date && !Number.isNaN(tarih.getTime()) ? tarih : new Date();
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** Slack mrkdwn'de anlam tasiyan karakterleri kacirir. */
function kacir(metin) {
  return (metin || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Tek bir son dakika haberini kanallara gonderir.
 * Poster akisindan ayri tutuldu: bu bir dosya yuklemesi degil, mesaj gonderimi.
 */
export async function haberGonder({ token, channels, haber, tz = 'Europe/Istanbul' }) {
  const client = new WebClient(token);
  const emoji = KATEGORI_EMOJI[haber.kaynak.category] || ':newspaper:';
  const saat = saatDamgasi(haber.tarih, tz);
  const baslik = kacir(haber.baslik);

  const ozet = `SON DAKİKA — ${haber.baslik}`;
  const bloklar = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:rotating_light: *SON DAKİKA*\n\n*${baslik}*`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `${emoji} ${haber.kaynak.category}  ·  ${haber.kaynak.name}  ·  ${saat}${
            haber.link ? `  ·  <${haber.link}|Habere git>` : ''
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
        text: ozet, // bildirimlerde ve blok desteklemeyen istemcilerde gorunur
        blocks: bloklar,
        unfurl_links: false,
        unfurl_media: false,
      });
      if (!res.ok) throw new Error(JSON.stringify(res));
      sonuclar.push({ channel, ok: true });
    } catch (err) {
      const hata = err?.data?.error || err?.message || String(err);
      sonuclar.push({ channel, ok: false, error: hata });
      console.error(`  ${channel}: HATA -> ${hata}`);
    }
  }
  return sonuclar;
}
