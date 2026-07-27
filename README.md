# Vestaprime Slack Otomasyonları

Bu repo iki bağımsız otomasyon barındırır. İkisi de aynı Slack app'ini (`Vestaprime Market Poster`)
ve aynı bot token'ını kullanır, ancak ayrı workflow'lar olarak çalışır.

| Otomasyon | Ne yapar | Sıklık | Kanal secret'ı |
|---|---|---|---|
| **Market Poster** | Canlı piyasa posterini yakalar, PNG olarak gönderir | Saat başı | `SLACK_CHANNEL_ID` |
| **Son Dakika** | Önemli global finansal haberleri filtreleyip gönderir | 30 dakikada bir | `NEWS_CHANNEL_ID` |

---

# 1) Market Poster → Slack

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
src/capture.js       → Playwright ile poster yakalama
src/slack.js         → Slack'e dosya yükleme (kanal başına ayrı yükleme)
src/index.js         → akışı yöneten giriş noktası
scripts/make-icons.mjs → Slack app ikonu varyantlarını üretir (assets/ altına)
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

**Birden fazla kanal:** `SLACK_CHANNEL_ID` değerini virgülle ayırarak birden çok kanal verebilirsin —
`C08AJ51934P,C09UFHLSWRW` gibi. Poster her kanala ayrı ayrı yüklenir ve **bot her kanala `/invite`
ile davet edilmiş olmalıdır**; edilmemişse o kanal için `not_in_channel` hatası alınır (diğer kanallara
gönderim yine de yapılır, ancak çalıştırma hatalı olarak işaretlenir).

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

- `SLACK_CHANNEL_ID` — tek kanal (`C123...`) veya virgülle ayrılmış birden çok kanal (`C123...,C456...`)
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

---

# 2) Son Dakika Finansal Haber → Slack

Türkçe yayın yapan finansal RSS kaynaklarını tarar, önem skoruna göre filtreler ve geçenleri
**SON DAKİKA** başlığıyla Slack'e gönderir. 30 dakikada bir çalışır.

## Kaynaklar

Canlı test sonucu seçilenler — hepsi Türkçe, global finansal gelişmeleri dakikalık tazelikte veriyor:

| Kaynak | Kategori |
|---|---|
| `tr.investing.com/rss/news_14.rss` | Ekonomi (merkez bankaları, makro veri) |
| `tr.investing.com/rss/news_11.rss` | Emtia (petrol, altın, tahıl) |
| `tr.investing.com/rss/news_1.rss` | Döviz |
| `tr.investing.com/rss/news_285.rss` | Kripto |
| `tr.investing.com/rss/news_25.rss` | Borsa (düşük ağırlık — tekil hisse gürültüsü yoğun) |
| `aa.com.tr` ekonomi | Ekonomi |

**Elenenler ve sebepleri:** `bloomberght.com/rss` (feed günlerdir güncellenmiyor),
`investing.com/central_banks` (son içerik 2022), `dunya.com` / `ekonomim.com` / `trthaber` (ağırlıkla
yerel gündem gürültüsü), `financialjuice` (her ekonomik verinin ham akışı — Slack için fazla).

## Filtre nasıl çalışıyor?

"SON DAKİKA" etiketinin güvenilir kalması için sistem bilerek muhafazakâr: emin olmadığını göndermez.

1. **Veto** — tekil hisse açıklamaları (*"X hissesi bugün neden yükseldi?"*), analist notları,
   eğitim/promosyon içerikleri ve konu dışı yerel gündem doğrudan elenir.
2. **Konu puanı** — merkez bankası/para politikası (6), makro veri (5), jeopolitik (5), kriz (5),
   ana varlıklar (3), genel piyasa (2).
3. **Olay sinyali** — *konunun önemli olması yetmez, ortada gerçekleşmiş bir olay olmalı.*
   "açıkladı", "istifa etti", "beklentileri aştı", "%6 düştü" gibi kalıplar aranır. Olay sinyali
   yoksa puan 0.45 ile çarpılır. Bu olmadan günlük piyasa köşeleri (*"Altın Fed odağında ilerliyor"*)
   sırf "Fed" geçtiği için eşiği geçiyordu.
4. **Rutin cezası** — *"Sterlin bugün:"*, *"... öncesi düştü"*, *"gölgesinde"*, *"haftalık görünüm"*
   gibi köşe yazısı dili puan düşürür.
5. **Eşik** — kaynak ağırlığıyla çarpılan puan `NEWS_MIN_SCORE`'u (varsayılan 8) geçmeli.

Filtreyi canlı veriyle görmek ve ayarlamak için:

```bash
npm run news:tune        # varsayılan eşikle
npm run news:tune 6      # daha gevşek eşik dene
```

Bu komut hiçbir şey göndermez; her haberin puanını, hangi kuraldan kaç puan aldığını ve
eşiği geçip geçmediğini listeler.

## Tekrar gönderim koruması

İki katman:

- **Kimlik** — her haberin linkinden üretilen hash `state/seen-news.json` içinde tutulur.
- **Benzerlik** — aynı olayın farklı kaynaklardaki versiyonları elenir. Karşılaştırma **4-gram
  Jaccard** ile yapılır; Türkçe sondan eklemeli olduğu için kelime bazlı karşılaştırma
  ("gerilimi" / "geriliminin" / "gerilimin") aynı haberin iki versiyonunu yakalayamıyor.
  Karşılaştırma sadece aynı tur içinde değil, son 24 saatte gönderilmiş başlıklara karşı da yapılır.

Geçmiş dosyası her çalıştırmada repoya commit'lenir (`[skip ci]` ile, sonsuz döngü olmaz).
Actions cache yerine commit tercih edildi: cache silinebilir, commit denetlenebilir.

## Ayarlar

`.env` veya workflow `env:` üzerinden:

| Değişken | Varsayılan | Ne yapar |
|---|---|---|
| `NEWS_CHANNEL_ID` | — | Hedef kanal(lar). Virgülle çoklu kanal verilebilir. |
| `NEWS_MIN_SCORE` | `8` | Gönderim eşiği. Düşürmek daha çok haber gönderir. |
| `NEWS_MAX_AGE_HOURS` | `3` | Bundan eski haber "son dakika" sayılmaz. |
| `NEWS_MAX_PER_RUN` | `3` | Tek turda gönderilecek azami haber (ani akında kanalı boğmaz). |

Sıklık: [.github/workflows/breaking-news.yml](.github/workflows/breaking-news.yml) içindeki `cron: '*/30 * * * *'`.

## Elle test

Actions → **Son Dakika -> Slack** → **Run workflow**. İki parametre sunar:

- `max_age_hours` — geniş pencereyle test etmek için (örn. `48`)
- `dry_run` — işaretlenirse Slack'e hiçbir şey gönderilmez, sadece ne gideceği loglanır

Lokalde:

```bash
npm run news:dry    # sadece göster
npm run news        # gerçekten gönder
```
