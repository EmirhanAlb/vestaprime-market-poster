import fs from 'node:fs';
import path from 'node:path';
import { WebClient } from '@slack/web-api';

/**
 * PNG'yi Slack kanalina dosya olarak yukler.
 * files.uploadV2 Slack'in yeni yukleme akisini (getUploadURLExternal +
 * completeUploadExternal) kendisi yonetir; bot token yeterlidir.
 */
export async function uploadPosterToSlack({ token, channel, filePath, title, comment }) {
  const client = new WebClient(token);
  const stat = fs.statSync(filePath);

  const res = await client.files.uploadV2({
    channel_id: channel,
    file: fs.createReadStream(filePath),
    filename: path.basename(filePath),
    length: stat.size,
    title,
    initial_comment: comment,
  });

  if (!res.ok) throw new Error(`Slack yukleme basarisiz: ${JSON.stringify(res)}`);

  // Dogrulama icin: yuklenen dosyanin kalici linki ve hangi kanalda paylasildigi.
  const uploaded = res.files?.[0]?.files?.[0];
  if (uploaded) {
    const shares = uploaded.shares || {};
    const sharedIn = [...Object.keys(shares.public || {}), ...Object.keys(shares.private || {})];
    console.log(`Dosya: ${uploaded.permalink || uploaded.id}`);
    console.log(`Paylasildigi kanallar: ${sharedIn.length ? sharedIn.join(', ') : 'YOK (kanala dusmemis olabilir)'}`);
  }

  return res;
}
