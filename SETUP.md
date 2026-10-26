# Kurulum

## Yerel Node.js sunucusu

Node.js 24 kullanın. Proje dizininde:

```sh
npm ci
npm run build:firebase
npm start
```

http://localhost:3000 adresini açın. Yerel sunucu Node/SQLite modunu kullanır. Veriler ilk kullanımda `data/` altında oluşturulur. Testler: `npm test`.

## Kendi Firebase projeniz

1. `.firebaserc` içindeki `your-firebase-project` değerini kendi proje kimliğinizle değiştirin.
2. `public/firebase-config.js` dosyasına kendi Firebase web yapılandırmanızı yazın.
3. `public/app-config.json` içindeki `backend` değerini `firebase` yapın.
4. `firebase.json` CSP içindeki örnek `firebaseapp.com` alanını kendi Auth alanınızla değiştirin.
5. `extension/manifest.json`, `extension/bridge.js`, `extension/protocol.js` içindeki örnek uygulama alanlarını kendi adresinizle değiştirin. Özel alan adı kullanıyorsanız onu da bu izin listelerine ekleyin. Yerel geliştirme adresleri korunmuştur.
6. Authentication'da Anonymous ve yönetim paneli için Google girişini etkinleştirin; yetkili alanları kendi alanlarınızla yapılandırın.
7. Proje sahibi olarak Realtime Database konsolunda `siteConfig/adminEmail` alanına kendi yönetici e-postanızı girin. Bunu kaynak koda eklemeyin.
8. `docs/FIREBASE.md` içindeki kuralları inceleyin; kendi projenizde `npx firebase deploy --only database` ile kuralları yükleyin.
9. `npm run firebase:login` ve `npm run deploy:firebase` komutlarıyla kendi hesabınızda yayımlayın.

Örnek proje kimliği, e-posta ve API alanları gerçek bir hesaba ait değildir. Firebase emülatör testleri için Java 21 ve `npm run test:firebase` kullanın.

## Chrome eklentisi

`npm run build:firebase` eklenti ZIP'ini de üretir. `chrome://extensions` sayfasında geliştirici modunu açıp `extension/` klasörünü paketlenmemiş olarak yükleyin. Eklenti erişim izinlerini verin. Güncelleme sonrasında oda ve kaynak sayfalarını yeniden açın. Ayrıntılar `docs/PLAYER-AND-EXTENSION.md` içindedir.

## Yayınlama

Node sunucusu, Docker, kalıcı disk ve HTTPS kurulumu için `docs/DEPLOYMENT.md`; yönetici yetkileri için `docs/ADMIN.md` dosyasına bakın. Gerçek `.env`, yönetici anahtarı, servis hesabı, veritabanı/yükleme dosyaları, yedekler ve günlükleri GitHub'a eklemeyin.
