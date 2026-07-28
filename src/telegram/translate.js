import Anthropic from '@anthropic-ai/sdk';

/**
 * FinancialJuice mesajlarini Turkce'ye cevirir.
 *
 * Mesajlar tek tek degil toplu gonderilir: her cagrinin sistem promptu sabit
 * bir maliyet, tek tek gondermek onu her mesaj icin yeniden odemek olurdu.
 */

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5';
/** Tek API cagrisinda cevrilecek azami mesaj. */
const YIGIN = Number(process.env.TRANSLATE_BATCH_SIZE || 15);

const SISTEM = `Finansal haber akisi ceviri asistanisin. Sana numarali kisa
Ingilizce piyasa mesajlari verilir; her birini dogal, akici Turkce'ye cevirirsin.

Kurallar:
- Anlami birebir koru. Yorum, aciklama, tahmin veya bilgi EKLEME.
- Sembolleri ve kisaltmalari oldugu gibi birak: $AAPL, $MACRO, BTC, Fed, ECB, OPEC+, GDP, CPI.
- Sayilari, yuzdeleri ve para birimlerini oldugu gibi birak; Turkce ondalik
  ayraci kullanma (8.3% -> %8,3 DEGIL, %8.3 olarak kalsin).
- Veri aciklama kaliplarini standart Turkce karsiliklarina cevir:
  ACTUAL -> GERCEKLESEN, FORECAST -> BEKLENTI, PREVIOUS -> ONCEKI.
- URL'leri, dosya adlarini ve teknik kodlari degistirme.
- Cikti sadece cevrilmis metin olsun; tirnak veya numara ekleme.
- Mesaj zaten Turkce ise oldugu gibi geri ver.`;

const SEMA = {
  type: 'object',
  properties: {
    ceviriler: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          no: { type: 'integer' },
          tr: { type: 'string' },
        },
        required: ['no', 'tr'],
        additionalProperties: false,
      },
    },
  },
  required: ['ceviriler'],
  additionalProperties: false,
};

function parcala(dizi, boyut) {
  const parcalar = [];
  for (let i = 0; i < dizi.length; i += boyut) parcalar.push(dizi.slice(i, i + boyut));
  return parcalar;
}

async function yiginCevir(client, mesajlar) {
  const girdi = mesajlar.map((m, i) => `${i + 1}. ${m.metin}`).join('\n\n');

  const yanit = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SISTEM,
    // Kisa ceviri islerinde derin dusunmeye gerek yok; dusunmeyi kapatmak
    // yerine dusuk efor tercih edildi (Claude Opus 5'te dusunmeyi kapatmak
    // ciktiya ic etiket sizdirabiliyor).
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: SEMA },
    },
    messages: [
      {
        role: 'user',
        content: `Asagidaki ${mesajlar.length} mesaji Turkce'ye cevir. Her ceviriyi kendi numarasiyla dondur.\n\n${girdi}`,
      },
    ],
  });

  const metinBlogu = yanit.content.find((b) => b.type === 'text');
  if (!metinBlogu) throw new Error('Modelden metin blogu donmedi');

  const cozulen = JSON.parse(metinBlogu.text);
  const harita = new Map(cozulen.ceviriler.map((c) => [c.no, c.tr]));

  return mesajlar.map((m, i) => ({
    ...m,
    turkce: (harita.get(i + 1) || '').trim() || m.metin,
    cevrildi: Boolean(harita.get(i + 1)),
  }));
}

/**
 * Mesajlari Turkce'ye cevirir. Bir yigin basarisiz olursa o yigindaki
 * mesajlar cevirisiz (cevrildi: false) doner; cagiran taraf ne yapacagina
 * kendisi karar verir.
 */
export async function cevir(mesajlar, apiKey) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY tanimli degil.');
  const client = new Anthropic({ apiKey });

  const sonuc = [];
  for (const yigin of parcala(mesajlar, YIGIN)) {
    try {
      sonuc.push(...(await yiginCevir(client, yigin)));
    } catch (err) {
      console.error(`  ! ceviri basarisiz (${yigin.length} mesaj): ${err?.message || err}`);
      sonuc.push(...yigin.map((m) => ({ ...m, turkce: m.metin, cevrildi: false })));
    }
  }
  return sonuc;
}

export { MODEL };
