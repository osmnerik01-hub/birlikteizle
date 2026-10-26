# İnternet ortamına dağıtım

Bu dağıtım tek uygulama süreci ve kalıcı disk kullanan bir Linux sunucusu içindir. SQLite veritabanı, oda oturumları ve yüklenen videolar aynı kalıcı Docker volume'ünde tutulur. Caddy HTTPS bağlantısını sonlandırır ve SSE olaylarını bekletmeden uygulamaya iletir. Uygulamanın 3000 portu internete açılmaz.

## Gerekenler

- Docker Engine ve Docker Compose eklentisi kurulu bir Linux sunucusu.
- Sunucunun IP adresine yönlendirilmiş bir alan adı (A kaydı; IPv6 kullanıyorsan doğru AAAA kaydı).
- İnternetten erişilebilir TCP 80 ve 443 portları. HTTP/3 için UDP 443 isteğe bağlıdır.
- Video kotasından ve veritabanı büyümesinden daha büyük kalıcı disk; yedekler için ayrıca alan.

## Kurulum

Proje dosyalarını sunucuya kopyala. Proje klasöründe:

```sh
cp .env.example .env
```

`.env` içindeki `DOMAIN` ve `ACME_EMAIL` değerlerini kendininkilerle değiştir. `DOMAIN` yalnızca alan adı olmalıdır; `https://`, port veya yol yazma. Yükleme/depolama sınırlarını sunucuna göre ayarla. Ardından:

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app caddy
```

DNS ve portlar doğruysa Caddy sertifikayı alır. `https://ALAN_ADIN` adresini aç. İki farklı cihaz veya tarayıcıyla aynı davet bağlantısına katıl; sohbeti, oynatma/durdurmayı, ileri sarmayı ve bir dosya yüklemesini dene. `/healthz` HTTP 200 döndürmelidir.

Kendi CDN veya ters proxy katmanını ekliyorsan yükleme boyutu/zaman sınırlarını ve SSE buffering ayarlarını ayrıca kontrol et. HTTPS sayfalarında dış video bağlantıları da HTTPS olmalıdır.

## Güncelleme ve yeniden başlatma

```sh
docker compose up -d --build
```

Uygulama SIGTERM/SIGINT aldığında oynatma konumunu kaydeder, videoyu duraklatır ve SSE bağlantılarını kapatır. Tarayıcılar yeniden bağlanır. Ani kapanmada son başarıyla kaydedilmiş konum kullanılır. Oda sahibinin yetkisi ve mesajlar korunur. Oda çerezi 30 gün geçerlidir; çerezleri veya tarayıcı verilerini silmek hesap bulunmadığından bu kimliğe erişimi kaybettirir.

`docker compose down` veriyi volume'de bırakır. **`docker compose down -v` veritabanını, videoları ve sertifika verilerini siler.**

## Yedekleme ve geri yükleme

Tutarlı bir yedek için uygulamayı kısa süre durdur, veritabanı ve videoları birlikte arşivle. Aşağıdaki komutlar proje klasöründe çalışır ve `backup.tar.gz` oluşturur:

```sh
docker compose stop app
docker compose run --rm --no-deps -T --entrypoint tar app -C /app/data -czf - . > backup.tar.gz
docker compose start app
```

Yedek, oda oturumlarına ait hash'leri ve mesajları da içerir; erişimi sınırla ve sunucu dışında sakla. Geri yüklemeyi ayrı bir ortamda dene. Geri yükleme için boş bir veri volume'üne, uygulama kapalıyken:

```sh
docker compose run --rm --no-deps -T --entrypoint tar app -C /app/data -xzf - < backup.tar.gz
docker compose up -d
```

Yedek komutları Linux shell içindir. Çalışmakta olan SQLite dosyasını tek başına kopyalama; WAL dosyası nedeniyle tamamlanmamış bir kopya oluşturabilirsin.

## Kapasite ve sınırlar

- **Tek app instance** çalıştır. SQLite dosyasını birden fazla uygulama kopyasına bağlamak SSE durumlarını paylaşmaz. Çok sunucu için PostgreSQL, Redis/pubsub ve S3 uyumlu depolama gerekir.
- Varsayılanlar: 1.000 kalıcı oda, oda başına toplam 100 kimlik, listede 50 video, dosyada 500 MB, video deposunda toplam 10 GB; aynı anda 500 SSE bağlantısı ve kimlik başına 5 sekme.
- Oda oluşturma IP başına dakikada 10, katılım 60, genel API istekleri 600 ile sınırlıdır. `TRUST_PROXY=1` yalnızca app portuna güvenilir proxy erişiyorsa kullanılmalıdır. Compose bunu sağlar.
- Depolama kotası dolunca yeni yükleme reddedilir. Yüklemeler ve odalar otomatik silinmez. Disk kullanımı ve yedeklerin takibi gerekir. `data/` çalışma dizinini salt okunur bir dosya sistemi üzerinde bırakma.
- Oda bağlantısı davet anahtarıdır; bağlantıyı bilenler katılabilir. Oda şifresi, hesapla sahiplik kurtarma, moderasyon ve harici video platformları henüz yoktur. Bu sürüm davet bağlantısı ile kullanım için temel oluşturur.
- `MAX_UPLOAD_MB` arayüzdeki 500 MB sınırını artırmaz; daha küçük sunucu sınırında sunucu açıklayıcı hata döndürür.

## Doğrulama durumu

Sunucu entegrasyon testleri `npm test` ile yerel olarak çalıştırılır. Docker imajı, gerçek DNS/sertifika alma ve dış ağ erişimi dağıtım ortamında ayrıca doğrulanmalıdır. Bu dosyaların hazırlanması sitenin internete yayımlandığı anlamına gelmez.

Başvuru: [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Docker kalıcı volume'ler](https://docs.docker.com/engine/storage/volumes/), [Node.js SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html).


## Güncellemeler ve tarayıcı önbelleği

`npm run build:firebase`, yayımlanan dosyalardan kararlı bir içerik sürümü üretir. HTML, stil, simge ve JavaScript modüllerinin yerel adresleri `?v=...` ile güncellenir. Dosyalar değişmezse sürüm aynı kalır. Firebase Hosting yayını bu derlemeyi otomatik çalıştırır; Node dağıtımında sunucuyu başlatmadan önce derlemeyi çalıştırın.

HTML ve uygulama dosyaları yeniden doğrulanır; `build-info.json` önbelleksiz kontrol edilir. Açık sekme, görünürken dakikada bir ve sekmeye geri dönüldüğünde yeni sürümü kontrol eder. Yeni sürüm varsa Yenile bildirimi gösterilir; izleme kendiliğinden kesilmez. Yenileme düğmesi sohbet taslağını aynı sekmede geri getirir ve mesaj kuyruğu tamamlanmadan yenilemez. Çerezler, Firebase giriş kimliği ve oda sahipliği silinmez.

Tarayıcı geçmişini veya site verilerini temizlemek güncelleme yöntemi değildir. Chrome eklentisi ayrı bir kurulumdur; eklenti güncellendiğinde açık oda/kaynak sekmelerini yeniden açmak gerekebilir.
