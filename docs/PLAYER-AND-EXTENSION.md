# Gelişmiş oynatıcı ve kaynak pencere desteği (0.5.0)

## Akış

Dosya uzantıları MP4/WebM/Ogg/MOV/MKV/M4V olan kaynaklar yerel video öğesinde, `.m3u8` HLS kaynağı hls.js ile, `.mpd` DASH kaynağı dash.js ile açılır. Bir web sayfası adresi `kind: page` olarak kaydedilir; iframe'e zorla gömülmez.

Sayfa modunda her katılımcı eklentiyi kurar ve odadan **Kaynak penceresini aç** düğmesine basar. Eklenti ayrı bir Chrome popup penceresi açar ve yalnızca bu işlemle ilişkilendirilmiş sekmeyi algılamaya alır. Yeniden açma mevcut pencereye odaklanır; tam ekran düğmesi kaynak penceresini büyütür. Kaynak sayfaya eklenen Odaya dön düğmesi oda penceresini öne getirir. Her iframe'in içerik betiği kendi HTML5 videolarını bildirir. Worker, önde oynayan büyük videoyu seçer ve oda sekmesine konum/ses/altyazı durumunu iletir. Oda sahibinin durumu mevcut oda oynatma kaydına yazılır; diğer katılımcıların oda sekmeleri zaman örneğini eklentiye iletir. Eklenti kendi kaynak oynatıcısından bildirim geldikçe ilerleyen oda saatini hesaplar ve 1,25 saniyeden büyük sapmayı düzeltir. Örnek 12 saniye yenilenmezse oynatma durdurulur. Tamamen uyuyan oda sayfası desteğin sınırıdır.

Kaynak sekmedeki `play/pause/seeked` olayları ile uygulanan uzaktan komutlar ayırt edilir; kısa bastırma süresiyle komut döngüleri önlenir. Kaynak sekmeden gelen bildirimler, oda arka plandayken de ev sahibinin oynatma bildirimini besler. Tarayıcının sayfayı tamamen uyutması/discard etmesi bağlantıyı yine kesebilir.

## Ses ve altyazı

- Site içindeki HLS/DASH kaynaklarında manifestte sunulan ses/altyazı listeleri kullanılır. Tercihler katılımcıya özeldir.
- Kaynak sayfada önce `audioTracks` ve `textTracks` kullanılır. Ayrıca MAIN dünya adaptörü erişilebilir Video.js, JW Player, `window.hls`/`window.hlsPlayer` ve `window.player`/`window.dashPlayer` örneklerini bilinen API'leriyle kontrol edebilir.
- Özel/kapalı oynatıcı nesneleri, kapalı Shadow DOM, erişim izni olmayan iframe'ler veya tarayıcının açmadığı kayıtlar menüye getirilemez. Bu durumda kaynak sayfanın kendi ses/altyazı menüsü kullanılır.
- MKV uzantısı codec desteği sağlamaz. Chrome'un açamadığı codec için bu değişiklik dönüştürme yapmaz. Özellikle yerel MP4/MKV çoklu ses kayıtlarının Chrome tarafından açılması garanti değildir; HLS/DASH alternatif ses kayıtları esas destek yoludur.
- DRM anahtarları alınmaz, şifre çözülmez, erişim veya bot doğrulaması kaldırılmaz. Kaynak sayfada herkes kendi erişimini kullanır.

## Kontroller

Tarayıcının sabit yerel kontrolleri kaldırılmıştır. Yeni kontrollerde oynat/duraklat, 10 saniye sarma, sürükleyerek konum değiştirme, ses/sessiz, ses kaydı, altyazı ve tam ekran bulunur. Oynarken 2,5 saniye hareketsizlik kontrolleri ve imleci gizler; fare hareketi geri getirir. Duraklatıldığında veya klavyeyle kontrollerde gezinirken görünür kalırlar. Tam ekran video öğesinde değil kapsayıcıda açılır; kendi kontrol katmanı da tam ekrana dahil olur.

Kısayollar: oynatıcı yüzeyinde `Space/K`, `←/→`, `M`, `F`. Ses ve altyazı seçimleri kişiseldir. Oda oynatma konumunu oda sahibi ve oynatma izni verdiği izleyiciler değiştirir. Sürekli zaman bildirimini yalnızca son komutu veren yetkili katılımcı yayımlar. Kaynak sayfa modunda video orijinal sekmede gösterilir; odanın tam ekran düğmesi orijinal kaynak penceresini tam ekran yapar. Odada güncel konum, süre, yükleme ve senkronizasyon durumu gösterilir; bu modda oda kontrolleri gizlenmez.

## Güvenlik ve izinler

MV3 eklentisi başlangıçta yalnızca iki Firebase Hosting alan adına ve localhost:3000'e erişir. Diğer HTTP/HTTPS sitelerine erişim, popup'taki düğmeyle kullanıcı tarafından ayrıca verilir. Farklı alan adlarındaki video iframe'leri/CDN'ler için geniş izin gerekir; bu izin eklentiyi kurduktan sonra kullanıcı tarafından onaylanır. İzin kaldırıldığında algılama bağlantıları durur.

Komutların çıkış noktası sabit bir oda origin listesiyle doğrulanır. Kaynak sekmeler ve frame kimlikleri worker tarafından tutulur; web sayfası keyfi bir tarayıcı sekmesine komut gönderemez. Yalnızca oynatma, ses ve kayıt seçimi komutları vardır; eval/script/başlık değiştirme/proxy yoktur. Ağ gözlemi ve algılanan HLS bağlantısını odaya aktarma seçeneği kaldırılmıştır; webRequest izni kullanılmaz. Video kaynak sitenin kendi oturumunda yüklenir. Chrome session storage yalnızca kaynak/oda eşleştirmesini, oynatıcı durumunu ve zaman örneğini tutar. Çerezler, şifreler ve Authorization başlıkları okunmaz. Oturum kapanınca geçici eşleştirmeler silinir.

## Paket ve test

`npm run build:firebase`, site derlemesiyle birlikte `public/birlikteizle-extension.zip` oluşturur. ZIP içinde manifest dahil on yerel dosya vardır; uzaktan eklenti kodu yüklenmez. Kurulum [site rehberinde](../public/extension-guide.html) anlatılır. Kaynak klasör doğrudan `extension/` dizinidir.

`npm test` URL türleri, pencere/frame yetkisi, komut doğrulama, HTML5 ses/altyazı değişimi, Video.js/Hls.js adaptörleri, ilerleyen saat ve iki kaynak oynatıcının worker/detector üzerinden oynat/sar/durdur akışını kapsar. Chrome windows ve HTMLMediaElement yüzeyleri bu otomatik testlerde sahtedir; gerçek Chrome testi yerine geçmez. Firebase emülatör testleri sayfa ve yayın türlerinin yetkilerini ve iki katılımcının eşitlemesini kapsar. Tarayıcı önizlemesinde özel kontrollerin gizlenmesi ve altyazı görüntüsü kontrol edilir; sentetik ses kayıtlarıyla menü kablolaması test edilir. Gerçek ses parçalarının çözümlenmesi kaynak codec'ine bağlıdır.

