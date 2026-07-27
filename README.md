# Vestaprime Market Poster → Slack Otomasyonu

[vestaprimes.com/en/market-poster](https://vestaprimes.com/en/market-poster) sayfasındaki canlı piyasa posterini
otomatik olarak yakalayıp Slack kanalına gönderir. Elle "Download PNG" tıklamaya gerek kalmaz.

**Çıktı:** 1080×1350 PNG (sayfadaki indirme butonuyla birebir aynı ölçü).
**Zamanlama:** GitHub Actions, her saat başı.

---

## Nasıl çalışıyor?

Poster sunucuda duran hazır bir dosya değil — sayfa açıldığında tarayıcıda canlı fiyatlarla çiziliyor
(fiyatlar Binance / CoinGecko / open.er-api'den geliyor). Bu yüzden otomasyon gerçek bir tarayıcı çalıştırıyor:

1. Headless Chromium ile `/en/market-poster` sayfası açılır.
2. Fiyatlar gelip durum rozeti **LIVE** olana kadar beklenir (fiyat satırlarındaki `·····` kaybolana kadar).
3. Sayfanın kartı ekrana sığdırmak için uyguladığı küçültme (`--s` CSS değişkeni) iptal edilir, kart tam 1080×1350 boyutunda ekran görüntüsü olarak alınır.
4. PNG, Slack Web API ile kanala dosya olarak yüklenir.

```
src/capture.js   → Playwright ile poster yakalama
src/slack.js     → Slack'e dosya yükleme
src/index.js     → akışı yöneten giriş noktası
.github/workflows/market-poster.yml → saatlik zamanlama
```

---

## Kurulum

### 1. Slack app'i oluştur ve token'ı al

> Bu adım için Slack workspace'inde app kurma yetkin olması gerekiyor. Yetkin yoksa
> workspace admin'inden bu adımları yapmasını veya sana "app oluşturma" izni vermesini isteyebilirsin.

1. https://api.slack.com/apps → **Create New App** → **From scratch**
2. İsim: `Vestaprime Market Poster`, workspace'i seç → **Create App**
3. Sol menüden **OAuth & Permissions** → **Scopes → Bot Token Scopes** altına şunları ekle:
   - `files:write` → dosya (poster) yükleyebilmek için
   - `chat:write` → mesaj/açıklama yazabilmek için
4. Sayfanın üstünde **Install to Workspace** → izinleri onayla.
5. Karşına çıkan **Bot User OAuth Token**'ı kopyala — `xoxb-` ile başlar. Bu değer gizlidir, kimseyle paylaşma.
6. Slack'te poster'ın gideceği kanala git ve botu davet et:
   ```
   /invite @Vestaprime Market Poster
   ```
7. **Kanal ID'sini al:** kanal adına tıkla → açılan pencerede en altta **Channel ID** (`C` ile başlar) yazar. Kopyala.

### 2. GitHub reposunu hazırla

Bu klasörü private bir GitHub reposuna yükle:

```bash
cd "slack otomasyonu"
git init
git add .
git commit -m "Market poster Slack otomasyonu"
gh repo create vestaprime-market-poster --private --source=. --push
```

> `gh` kurulu değilse GitHub'da elle boş bir **private** repo açıp
> `git remote add origin <repo-url> && git push -u origin main` yapabilirsin.

### 3. Secret'ları ekle

GitHub repo sayfasında **Settings → Secrets and variables → Actions → New repository secret**:

| Secret adı | Değer |
|---|---|
| `SLACK_BOT_TOKEN` | 1. adımdaki `xoxb-...` token |
| `SLACK_CHANNEL_ID` | 1. adımdaki `C...` kanal ID'si |

### 4. Test et

Repo → **Actions** sekmesi → **Market Poster -> Slack** → **Run workflow**.
Bir dakika içinde poster Slack kanalına düşmeli. Bundan sonrası otomatik: her saat başı çalışır.

---

## Lokalde çalıştırma / test

```bash
npm install
npx playwright install chromium

# Sadece PNG üret, Slack'e gönderme (out/ klasörüne yazar):
npm run capture

# Slack'e de gönder (önce .env dosyasını doldur):
cp .env.example .env
npm start
```

---

## Ayarlar

### Gönderim sıklığı

[.github/workflows/market-poster.yml](.github/workflows/market-poster.yml) içindeki `cron` satırı.
**Saatler UTC** — Türkiye UTC+3, yani TR saatinden 3 çıkar.

| İstenen | cron |
|---|---|
| Her saat başı (şu anki ayar) | `'0 * * * *'` |
| Hafta içi TR 09:00–23:00 arası saatlik | `'0 6-20 * * 1-5'` |
| Her gün TR 09:00 ve 18:00 | `'0 6,15 * * *'` |

> GitHub'ın zamanlayıcısı yoğun saatlerde 5–20 dakika gecikebilir; bu normaldir ve poster üzerindeki
> "Updated HH:MM" damgası her zaman gerçek yakalama saatini gösterir.

### Diğer

`.env` veya workflow `env:` bloğu üzerinden:

- `POSTER_URL` — farklı bir dil/sayfa kullanmak için (varsayılan `https://vestaprimes.com/en/market-poster`)
- `TZ_NAME` — saat damgası ve dosya adı için zaman dilimi (varsayılan `Europe/Istanbul`)
- `LIVE_TIMEOUT_MS` — fiyatların gelmesi için beklenecek süre (varsayılan 60000)

Poster canlı fiyatlara geçemeden yakalanırsa iş yine de tamamlanır, ancak Slack mesajının altına
"fiyatlar canlı akışa geçmeden yakalandı" notu düşülür.

---

## Sorun giderme

| Belirti | Sebep / çözüm |
|---|---|
| `not_in_channel` | Bot kanala davet edilmemiş → `/invite @Vestaprime Market Poster` |
| `missing_scope` | `files:write` scope'u eklenmemiş → scope'u ekleyip app'i **yeniden install** et |
| `invalid_auth` | Token yanlış/süresi dolmuş → secret'ı güncelle |
| Poster boş veya fiyatlar `·····` | Fiyat API'leri yavaş → `LIVE_TIMEOUT_MS` değerini artır |
| Actions çalışmıyor | Repo 60 gün hareketsiz kalırsa GitHub zamanlanmış işleri durdurur → repoya bir commit at veya Actions'tan yeniden etkinleştir |

Hata durumunda workflow, ürettiği PNG'yi 3 gün boyunca **Artifacts** altında saklar — çalıştırma sayfasından indirip bakabilirsin.
