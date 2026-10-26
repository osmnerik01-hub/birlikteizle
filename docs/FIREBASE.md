# Firebase Spark ile yayınlama

`your-firebase-project` bir örnek değerdir; kendi Firebase proje kimliğinizle değiştirin. Web yapılandırması `public/firebase-config.js` dosyasındadır. Bu yapılandırma tarayıcıya gönderilir; özel servis hesabı anahtarı içermez. Yetkilendirmeyi `database.rules.json` sağlar.

## İki çalışma biçimi

- `npm start`: Node.js + SQLite; mevcut dosya yükleme özellikleri korunur. Sunucu `/app-config.json` üzerinden `node` modunu seçer.
- Firebase Hosting: statik dosyalardaki `/app-config.json` üzerinden `firebase` modu seçilir. Anonim Authentication + Realtime Database kullanılır. Dosya yükleme arayüzü kapalıdır; HTTPS video/HLS/DASH bağlantıları ve eklentiyle kaynak sekmede web sayfaları desteklenir. Cloud Functions, Cloud Run veya Cloud Storage kurulmaz; Blaze planına geçilmez.

## Firebase konsolundaki ayarlar

1. **Security → Authentication → Get started → Sign-in method → Anonymous** sağlayıcısını etkinleştir ve kaydet. Özel anahtar oluşturma gerekmez.
2. **Realtime Database** bölümünde yapılandırmadaki `your-firebase-project-default-rtdb` veritabanının bulunduğunu doğrula. Yoksa veritabanını kur; herkese açık test kuralları kullanma.
3. Authentication'ın Settings → Authorized domains listesinde `your-firebase-project.web.app` ve `your-firebase-project.firebaseapp.com` adreslerinin bulunduğunu doğrula.

## Kuralların kurulması

**Mevcut bir veritabanında kuralları körlemesine değiştirme.** Konsoldaki mevcut Rules içeriğini önce kaydet. Bu depodaki kural dosyası yeni, yalnızca bu uygulamanın kullandığı bir veritabanı için tam kapalı varsayılanlarla hazırlanmıştır. Mevcut uygulamalara ait kurallar varsa `birlikteRooms` dalını korunan mevcut kurallarla birleştir. Üst seviyedeki `.read: true` veya `.write: true` bu dalın korumasını da kaldırabilir; birlikte değerlendirilmelidir.

Uygulama kendi verisini yalnızca `birlikteRooms` altında yazar. Oda bağlantısını bilen, anonim oturum açmış kullanıcı kendi kimliğini odaya ekleyebilir; odaya katılmadan mesajları veya izleme listesini okuyamaz. Oda sahibi oluşturulduktan sonra değiştirilemez. Herkes yalnızca kendi adıyla mesaj gönderebilir ve kendi bağlantı durumunu yazabilir. Oynatma ve listeye video ekleme oda sahibine aittir.

Yeni ve boş bir veritabanında incelenen kuralları yüklemek için:

```powershell
npx firebase deploy --only database --project your-firebase-project
```

`npm run deploy:firebase` yalnızca Hosting yayımlar; mevcut veritabanı kurallarını otomatik değiştirmez.

## Giriş ve Hosting yayını

```powershell
npm ci
npm run firebase:login
```

Komutun verdiği resmi Google/Firebase bağlantısını tarayıcıda açıp kendi hesabınla girişi tamamla. Giriş kodlarını veya OAuth anahtarlarını sohbete göndermeye gerek yoktur; CLI yönergelerini yerel terminalinde tamamla.

Ardından, mevcut Hosting sitesinin bu uygulama için kullanılacağını doğrula. Önceden başka site yayımlandıysa aynı hedefe deploy etmek onu değiştirir; önce ayrı Hosting site hedefi seç.

```powershell
npm run deploy:firebase
```

Derleme yayınlamadan önce otomatik çalışır. Başarılı deploy çıktısı gerçek URL'yi verir; varsayılan hedef `https://your-firebase-project.web.app` adresidir. Deploy başarılı olmadan bu adres uygulamanın yayımlandığını kanıtlamaz.

## Testler

```powershell
npm test
npm run build:firebase
npm run test:firebase
```

Firebase emülatör testleri Java 21 gerektirir. Yalnızca `demo-birlikteizle` adlı yerel demo projesinde çalışırlar; gerçek Firebase hesabına veya canlı verilere bağlanmazlar. İlk emülatör çalıştırması resmi emülatör dosyalarını indirir.

Emülatör testleri; yetkisiz erişimi, sahiplik değiştirmeyi, kimlik sahteciliğini, mesaj/video şemasını, slot sınırlarını ve iki bağımsız kullanıcının sohbet/oynatma akışını doğrular.

## Spark sürümünün sınırları

- Her odada 50 video ve son 150 mesaj tutulur; dolan mesaj slotunda en eski mesajın yerini yenisi alır. Eşzamanlı işlemler transaction ile korunur.
- Boş odalar 24 saatlik hareketsizlikten sonra ziyaretçi tarafından başlatılan temizlikle silinebilir; ayrıntılar ADMIN.md içindedir.
- Node sunucusundaki IP istek sınırları Firebase sürümünde yoktur. Mesaj arayüzündeki kısa bekleme kötü niyetli istemciye karşı sunucu koruması değildir. Bu sürüm güvenilen arkadaşlar arasında davet bağlantısıyla kullanım içindir; daha geniş kullanımda App Check, kötüye kullanım takibi ve sunucuda doğrulama ayrıca değerlendirilmelidir.
- Anonim kimlik bu tarayıcıdaki Firebase Authentication oturumuna bağlıdır. Tarayıcı verilerini silmek sahipliğe erişimi kaybettirir. Aynı tarayıcının sekmeleri aynı kimliği kullanır; iki kişi testi için gizli pencere veya başka tarayıcı kullan.
- Oda sahibi kapanırsa oynatma durur; otomatik yetki devri yoktur. İnternet kesilmesi veya arka plan sekmesinin aşırı yavaşlatılması durumunda son oynatma bildirimi 8 saniyeden eskiyse video duraklatılır.
- SQLite odaları Firebase'e otomatik taşınmaz. Her iki çalışma biçiminin oda bağlantıları kendi ortamına aittir.
- Firebase CLI ve emülatörler geliştirme bağımlılıklarıdır; uygulama sunucusuna kurulmaz. Firebase tarayıcı paketi Authentication ve Realtime Database SDK'larını; ayrı oynatıcı paketi hls.js ve gerektiğinde yüklenen dash.js motorunu içerir.

Resmi belgeler: [Firebase web kurulumu](https://firebase.google.com/docs/web/setup), [anonim giriş](https://firebase.google.com/docs/auth/web/anonymous-auth), [Realtime Database kuralları](https://firebase.google.com/docs/database/security), [Hosting yapılandırması](https://firebase.google.com/docs/hosting/full-config).

## Site yönetimi ve oda ömrü

Yönetim paneli `/admin.html` adresindedir. Google girişini etkinleştir ve proje sahibi olarak RTDB `siteConfig/adminEmail` kaydına admin adresini koy. Bu alan istemci kurallarıyla değiştirilemez. Admin girişi anonim izleyici kimliğinden ayrıdır. Ayrıntılı kullanım ve ücretsiz temizlik düzeni [ADMIN.md](ADMIN.md) içinde. Mevcut odalar silinmeden indekse alınır ve 24 saatlik yeni saklama penceresi tanınır.
