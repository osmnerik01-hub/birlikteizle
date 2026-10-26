# Birlikte İzle

Paylaşılabilir odalar, eşzamanlı video oynatma ve canlı sohbet uygulaması. **Firebase Spark** ve **Node.js + SQLite** olarak iki çalışma biçimi bulunur. Node.js **24.x** gerekir. Node sunucusu harici çalışma zamanı paketi kullanmaz; Firebase derleme/yayınlama/test araçları geliştirme bağımlılıklarıdır.

## Geliştirme

```powershell
npm ci
npm run build:firebase
npm start
```

[http://localhost:3000](http://localhost:3000) adresini aç. `npm run dev` dosya değişikliklerinde sunucuyu yeniden başlatır. `npm test` izole geçici dizinde test sunucusu çalıştırır; gerçek uygulama verisine dokunmaz.

## İnternete dağıtma

- Ücretsiz Google Firebase başlangıcı: [Firebase kurulum rehberi](docs/FIREBASE.md). Firebase ayarları örnek değerlerdir; kendi projenizle değiştirin. Hosting'de video URL'leri kullanılır; dosya yükleme kapalıdır. `npm ci` ve `npm run build:firebase` derlemeyi hazırlar.
- Kendi sunucun: Docker Compose, Caddy HTTPS ve kalıcı veri volume'ü hazırdır. Alan adı ve Linux sunucusu seçildikten sonra [.env.example](.env.example) üzerinden yapılandırılır. Yedekleme dahil adımlar [Node.js dağıtım rehberindedir](docs/DEPLOYMENT.md).

Bu paylaşım kopyası herhangi bir canlı Firebase projesine bağlı değildir. Node.js + SQLite veya kendi Firebase projenizle çalıştırabilirsiniz.

## Özellikler

- [Kaynak oynatıcı eklentisi ve kurulum](public/extension-guide.html): web sayfasındaki HTML5 oynatıcıyı kaynak sekmede algılama ve oda komutlarıyla eşitleme.
- Tam ekranda hareketsizken gizlenen özel kontroller, 10 saniye sarma, ses ve altyazı menüleri. HLS/DASH manifestlerinin sunduğu alternatif kayıtlar arasında geçiş.
- Teknik destek kapsamı ve doğrulama sınırları: [oynatıcı/eklenti rehberi](docs/PLAYER-AND-EXTENSION.md).

- Hesapsız oda oluşturma, UUID tabanlı uzun rastgele davet bağlantısı, isimle katılım.
- Oda sahibi ve yetkilendirilmiş izleyicilerden oynatma, durdurma ve ileri sarma eşitlemesi.
- SSE üzerinden sohbet, emoji tepkileri, katılımcı listesi ve otomatik yeniden bağlanma.
- Doğrudan MP4/WebM/Ogg/MOV URL'leri ve 500 MB'a kadar yükleme. HTTPS ortamında dış videolar da HTTPS olmalıdır.
- SQLite'ta kalıcı odalar, mesajlar, izleme listeleri, sahiplik ve oturum kimliklerinin hash'leri.
- Kalıcı diskte yüklemeler, byte range ile ileri sarma; yüklenen videolara yalnızca ilgili oda katılımcıları erişebilir.
- HttpOnly/SameSite çerezlerle SSE ve medya erişimi; HTTPS'te Secure çerez. Oturum anahtarları SSE URL'lerine yazılmaz.
- İstek sınırları, toplam video depolama kotası, oda/katılımcı/listenin kapasite sınırları, güvenlik başlıkları.
- Sağlık kontrolü ve kontrollü kapanış. Yeniden başlatma, videoyu son kaydedilen konumda duraklatır; oda ve sohbet korunur.

## Yapılandırma

| Değişken | Varsayılan | Kullanım |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Dinleme adresi |
| `DATA_DIR` | `./data` | Veritabanı ve yüklemeler; kalıcı disk gerekir |
| `NODE_ENV` | development | İnternette `production` |
| `PUBLIC_ORIGIN` | boş | Production'da zorunlu: `https://izle.alanadin.com` |
| `TRUST_PROXY` | kapalı | `1` yalnızca güvenilir ters proxy arkasında |
| `MAX_UPLOAD_MB` | `500` | Sunucuda tek video sınırı |
| `STORAGE_QUOTA_MB` | `10240` | Toplam video deposu kotası |
| `MAX_ROOMS` | `1000` | Kalıcı oda kapasitesi |
| `MAX_MEMBERS_PER_ROOM` | `100` | Oda başına toplam kimlik kapasitesi |
| `ROOM_IDLE_HOURS` | `24` | Node boş oda saklama süresi |
| `ADMIN_TOKEN` | boş | Node yönetim API anahtarı; en az 32 rastgele karakter |

Yerel `npm start` `.env` dosyasını otomatik okumaz; shell ortam değişkenlerini veya `node --env-file=.env server.js` kullan. Compose `.env` değerlerini kendi yapılandırması için okur.

## Sınırlar

Bu sürüm tek uygulama süreci içindir; çok sunucuya dağıtım için ortak veritabanı, pubsub ve nesne depolama gerekir. Oda bağlantısını bilenler katılabilir; izleyiciler anonim kalırken site yöneticisi Google hesabıyla ayrı panele girer. Oda şifresi ve anonim sahiplik kurtarma yoktur. Tarayıcı çerezleri 30 gün korunur; çerezleri silmek oda kimliğine erişimi kaybettirir. Oda sahibi kapatınca yetki otomatik devredilmez.

24 saat boş kalan odalar temizlenir. Node sunucusu ilgili yüklenen dosyaları da kaldırır; Firebase Spark temizliği site ziyaretleri sırasında çalışır. Depolama kotası video dosyalarını kapsar; veritabanı ve yedekler için ayrıca disk alanı ayır. Web sayfası bağlantıları Chrome eklentisiyle kaynak sekmede izlenir; otomatik her siteden video çıkarma veya DRM kaldırma yoktur. Tarayıcının video codec desteği ve dış kaynağın erişilebilirliği gerekir. Kapalı oynatıcıların ses/altyazı menüleri kaynak sayfada kullanılabilir. Otomatik oynatma engellenirse katılımcı oynat düğmesine bir kez basar. Örnek video MDN'nin CC0 çiçek videosudur; fontlar ve örnek video için internet gerekir.

### Kaynak penceresi (0.4.0)

Web sayfası ekleyip listeden seçtikten sonra her katılımcı **Kaynak penceresini aç** düğmesini kullanır. Video kendi sitesinde oynar; odanın kontrolleri kaynak penceresini ve diğer katılımcının konumunu yönetir. Güncel eklenti paketini kurup oda/kaynak sayfalarını yenileyin. Algılanan HLS’i odaya aktarma kaldırıldı; eski HLS girdisi yerine bölümün web sayfasını ekleyin. Ayrıntılar: [oynatıcı ve eklenti](docs/PLAYER-AND-EXTENSION.md).

### Yönetim ve izleyici yetkileri (0.5.2)

[Site yönetim paneli](public/admin.html), Google hesabına bağlı site admini, bağımsız video ekleme/liste yönetimi/oynatma yetkileri ve boş oda temizliği eklendi. Ayrıntılar, ücretsiz planın temizlik koşulları ve testler [ADMIN.md](docs/ADMIN.md) dosyasındadır. Kaynak penceresinden yetkili izleyici kontrolü için eklentiyi 0.5.2 sürümüne güncelleyin.


## Paylaşım kopyası ve yapılandırma

Bu kaynak paketi kişisel Firebase ayarları, kullanıcı verileri veya Git geçmişi içermez. Kurulum adımları için [SETUP.md](SETUP.md) dosyasına bakın. Bağımlılıklar ve üretilmiş dosyalar pakete dahil değildir; ilk çalıştırmadan önce derleme gereklidir.
