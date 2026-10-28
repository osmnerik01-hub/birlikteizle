# Site yönetimi, katılımcı yetkileri ve oda ömrü

## Firebase yönetimi

Panel `/admin.html` adresindedir. Google giriş sağlayıcısı Firebase Authentication ayarlarında açık olmalıdır. Yönetici adresi Realtime Database içindeki `siteConfig/adminEmail` kaydında tutulur. Bu kayıt web istemcilerinden değiştirilemez; proje sahibi Firebase Console/CLI üzerinden değiştirir. Site, Google sağlayıcısından gelen doğrulanmış e-posta kimliğini bu kayıtla karşılaştırır. Kullanıcının görünen adı, localStorage veya istemcide bir admin bayrağı yetki sağlamaz.

Yönetim ekranı ayrı Firebase Auth uygulaması kullanır. Böylece yönetici Google hesabıyla giriş yaptığında izleme odasındaki anonim oda sahibi kimliği değişmez. Yanlış Google hesabı, doğrulanmamış adres ve aynı adresli farklı giriş sağlayıcısı yönetici sayılmaz.

Panelde sayfalı oda listesi, yüklenen odalarda arama, ad değiştirme, duraklatma, kapatma/açma, sohbeti temizleme, kalıcı silme, oda sahibi değiştirme ve katılımcı izinleri vardır. İlk liste yalnızca indeks ve oda metadatasını indirir; tüm odaların sohbet ve videolarını birlikte indirmez. Bir odanın ayrıntıları seçildiğinde yüklenir. Kalıcı silme ve sohbet temizleme arayüzde açık onay gerektirir.

## Katılımcı yetkileri

Oda sahibi, Katılımcılar sekmesinde her izleyiciye üç ayrı izin verebilir:

| İzin | İşlemler |
| --- | --- |
| Video ekleme | Yeni video/sayfa ekleme; mevcut kaydı değiştirme veya silme yok |
| Listeyi yönetme | Video ekleme, listeden seçme ve kaldırma; listede en az bir video kalır |
| Oynatma ve durdurma | Oynat/duraklat, ileri/geri sarma ve kaynak oynatıcıdan kontrol |

Oda sahibi bütün izinlere sahiptir. İzleyici kendine veya başka kişilere izin veremez. Yetkiler hem uygulamada hem Firebase kurallarında / Node API'de denetlenir. Ses ve altyazı seçimleri kişiseldir.

`playback.controller` son oynatma komutunu veren kimliktir. Birden fazla yetkili kişinin sürekli zaman bildirimi yazıp birbirini geri sarmaması için yalnızca bu kimlik heartbeat yayımlar. Bir yetkili kullanıcı manuel komut verince kontrolü devralır. Eski yöneticinin geciken heartbeat'i transaction ile reddedilir. Oynatma izni kaldırılan aktif yöneticinin yayını duraklatılır. Kaynak penceresinden yetki devri için eklenti 0.5.0 gerekir.

## Temizlik ve optimizasyon

Firebase'de bir oda, son etkinlik üzerinden 24 saat geçtiğinde ve hiç presence bağlantısı yoksa temizlenebilir. Presence bağlıyken silinmez. Bağlanma, bağlantı kapanması ve kullanım sırasında seyrek etkinlik bildirimleri saklama zamanını günceller. Her ziyaretçi açılışta ve 10 dakikada bir en fazla 50 süresi dolmuş indeks girdisini kontrol eder. Silme koşulu sunucudaki kurallarda tekrar denetlenir; gelen bir katılımcı varken temizlik odasını silemez.

Ücretsiz Spark planında bu düzen ayrı bir ücretli zamanlayıcı kullanmaz: siteye hiç kimse gelmiyorsa temizlik sonraki ziyarete kalır. Admin panelindeki temizle düğmesi de boşluk ve yaş koşulunu transaction ile yeniden kontrol eder. İndeks yalnızca rastgele oda kimliği ve zaman içerir. Normal ziyaretçi yalnızca sunucunun `cleanupClock` kaydından türeyen sabit süresi dolmuş sorguyu okuyabilir; aktif odaların indeksini veya başka odaların sohbetini okuyamaz. `cleanupClock` yalnızca server timestamp ile ve en fazla dakikada bir ilerletilebilir; istemci sahte gelecek tarihi gönderemez.

İlk geçişte mevcut odalar yedeklenir ve eski odalara yeni bir 24 saatlik saklama penceresi tanınır; dağıtım işlemi odaları silmez. Mesaj listesi 150, video listesi 50 kayıtla sınırlıdır. Oda silinince mesaj, video listesi, üyeler, izinler ve presence aynı oda ağacıyla birlikte silinir; indeks de kaldırılır. Firebase Spark sürümünde video dosyası yüklenmediği için dış sitelerdeki kaynak videolar silinmez.

## Node sunucusu

`ADMIN_TOKEN` en az 32 rastgele karakterle sunucuda yapılandırılır. Google/Firebase site yöneticisinden bağımsızdır; tarayıcıdaki yönetim anahtarı yalnızca açık panelin belleğinde tutulur. `ROOM_IDLE_HOURS` varsayılan 24'tür. Sunucu dakikada bir boş odaları temizler; SQLite kaydını ve sadece o odaya ait yüklenen dosyaları kaldırır. Bağlı izleyicili oda korunur. Süresi dolmuş çevrimdışı katılımcı kayıtları yeni katılım sırasında budanır; oda sahibi kimliği korunur.

Node tek süreçli ve SQLite kalıcı diskli kullanım içindir. Özel yönetim sayfası genel erişime açık olabilir, fakat API anahtarsız oda listesi veya işlemleri vermez. Anahtarı kaynak koda veya public dizinine koyma.

## Doğrulama

`npm test`: Node admin API, ayrı izleyici izinleri, kontrol devri, eski heartbeat'in reddi, boş oda ve yükleme temizliği, aktif oda koruması; eklenti pencere/frame akışı ve kaynak sayfadan devralma.

`npm run test:firebase`: Google admin kimliği, yetkisiz erişim, kendine izin verme, iznin geri alınması, sorgu sınırları, aktif/boş oda ayrımı ve iki gerçek Auth/Database emülatör istemcisiyle yetki devri. İstemciler emülatörün gerçek kuralları yüklü `demo-birlikteizle-default-rtdb` namespace'ini kullanır.


## Google girişinde bağlantı ve pencere hataları

Yönetim sayfası `Cross-Origin-Opener-Policy: same-origin-allow-popups` başlığıyla sunulur. Bu ayar yalnızca yönetim sayfasına uygulanır; Firebase Auth callback sayfalarının başlıkları değiştirilmez.

Kayıtlı oturumun yüklenmesi ve veritabanından yönetici yetkisi kontrolü sınırsız beklemez. Yetki reddi ile bağlantı hatası farklı gösterilir. Bağlantı kesildiğinde hesap yanlışlıkla yetkisiz olarak etiketlenmez; yeniden giriş denenebilir. Açılır pencerenin engellenmesi, pencerenin kapatılması ve yetkisiz site adresi için ayrı açıklamalar vardır. Yönetici hesabının doğrulanmış Google kimliği ve veritabanı kuralları aynı şekilde zorunludur.

Konsoldaki bir COOP uyarısı tek başına CORS veya başarısız giriş kanıtı değildir. Giriş tamamlanmıyorsa paneldeki durum mesajını ve Firebase hata kodunu esas alın. Çerezleri veya anonim izleyici kimliğini silmek gerekmez.


Yönetim panelinin veritabanı bağlantısı HTTPS long polling kullanır. WebSocket bağlantısının ağ veya tarayıcı tarafından engellendiği ortamlarda da çalışır. Firebase Hosting CSP politikasında Firebase veritabanı uçlarının script/iframe bağlantılarına izin verilmelidir; bu izinler Firebase SDK HTTP taşımasının gereğidir. Kimlik doğrulama ve veritabanı yetki kuralları değişmez.

## Yaklaşık katılımcı ili
Odaya katıldıktan sonra tarayıcı ipwho.is servisine HTTPS isteği yapar. Yalnızca bölge/il ve ülke kodu saklanır; ham IP ve koordinatlar saklanmaz. Oturum başına bir sorgu yapılır. Başarısız sorgu katılımı engellemez. Veriler ayrı roomLocations alanındadır, yalnızca Google yöneticisi okuyabilir; oda temizlenirken bu kayıtlar da silinir. Konum ağ/VPN tahminidir, istemci tarafından bildirildiğinden kimlik veya güvenlik doğrulamasında kullanılmaz. Eski katılımcılar yeniden bağlanınca görünür. Ücretsiz servis günlük alan adı başına 1000 sorguyla sınırlıdır: https://ipwhois.io/documentation
