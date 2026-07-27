/**
 * Filtre kalibrasyon araci: canli feed'leri okur, her habere verilen puani
 * ve gecip gecmedigini listeler. Slack'e hicbir sey gondermez.
 *
 * Kullanim:  node scripts/tune-filter.mjs [esik]
 */
import { SOURCES } from '../src/news/sources.js';
import { haberleriTopla } from '../src/news/feed.js';
import { skorla, MIN_SKOR } from '../src/news/score.js';

const esik = Number(process.argv[2] || MIN_SKOR);

const haberler = await haberleriTopla(SOURCES);
console.log(`Toplam ${haberler.length} benzersiz haber okundu. Esik: ${esik}\n`);

const puanli = haberler
  .map((h) => ({ ...h, ...skorla(h.baslik, h.kaynak) }))
  .sort((a, b) => b.skor - a.skor);

const gecen = puanli.filter((h) => h.skor >= esik);
const kalan = puanli.filter((h) => h.skor < esik && h.skor > 0);
const elenen = puanli.filter((h) => h.skor === 0);

console.log(`########## GECENLER (${gecen.length}) ##########`);
for (const h of gecen) {
  console.log(`  ${String(h.skor).padStart(5)} | ${h.kaynak.category.padEnd(7)} | ${h.baslik.slice(0, 88)}`);
  console.log(`        └ ${h.detay}`);
}

console.log(`\n########## ESIGIN ALTINDA KALANLAR (${kalan.length}) ##########`);
for (const h of kalan.slice(0, 25)) {
  console.log(`  ${String(h.skor).padStart(5)} | ${h.kaynak.category.padEnd(7)} | ${h.baslik.slice(0, 88)}`);
}

console.log(`\n########## SIFIR PUAN / VETO (${elenen.length}) ##########`);
for (const h of elenen.slice(0, 25)) {
  console.log(`  ${h.detay === 'veto' ? 'VETO' : 'KONU'} | ${h.baslik.slice(0, 92)}`);
}

// Zaman asimina ugrayan feed soketleri acik kalip event loop'u mesgul
// tutabiliyor; is bittiginde acikca cikiyoruz.
process.exit(0);
