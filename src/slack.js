import fs from 'node:fs';
import path from 'node:path';
import { WebClient } from '@slack/web-api';

/**
 * PNG'yi verilen Slack kanallarina dosya olarak yukler.
 *
 * files.uploadV2 tek cagrida tek kanal kabul ettigi icin her kanal icin ayri
 * yukleme yapiyoruz. Bir kanal hata verirse digerleri denenmeye devam eder;
 * sonuclar tek tek dondurulur.
 *
 * @returns {Promise<Array<{channel: string, ok: boolean, permalink?: string, error?: string}>>}
 */
export async function uploadPosterToSlack({ token, channels, filePath, title, comment }) {
  const client = new WebClient(token);
  const size = fs.statSync(filePath).size;
  const filename = path.basename(filePath);
  const results = [];

  for (const channel of channels) {
    try {
      const res = await client.files.uploadV2({
        channel_id: channel,
        // Her yukleme icin yeni bir stream sart: stream yalnizca bir kez okunabilir.
        file: fs.createReadStream(filePath),
        filename,
        length: size,
        title,
        initial_comment: comment,
      });

      if (!res.ok) throw new Error(JSON.stringify(res));

      // Not: completeUploadExternal yaniti "shares" alanini icermez,
      // paylasimin gerceklestigini bu yanittan teyit etmeye calismayin.
      const permalink = res.files?.[0]?.files?.[0]?.permalink;
      results.push({ channel, ok: true, permalink });
      console.log(`  ${channel}: gonderildi${permalink ? ` (${permalink})` : ''}`);
    } catch (err) {
      const error = err?.data?.error || err?.message || String(err);
      results.push({ channel, ok: false, error });
      console.error(`  ${channel}: HATA -> ${error}`);
    }
  }

  return results;
}
