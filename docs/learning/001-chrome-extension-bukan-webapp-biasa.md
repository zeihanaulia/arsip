---
title: "Kenapa Extension Chrome Bukan Webapp Biasa"
created: 2026-09-07
updated: 2026-09-07
status: draft
tags:
  - chrome-extension
  - manifest-v3
  - architecture
sources:
  - https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
  - https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers
  - https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3
  - https://developer.chrome.com/docs/extensions/develop/migrate
---

# Kenapa Extension Chrome Bukan Webapp Biasa

> Extension ditulis pakai HTML, CSS, dan JavaScript yang sama kayak webapp.
> Tapi `import` gagal di satu file, `fetch` yang sama bersikap beda di dua
> tempat, dan "backend"-nya bisa mati kapan aja tanpa pamit. Kok bisa?

Dokumen ini ngejawab tiga pertanyaan yang nyambung:

1. Kalau bahannya sama (HTML/CSS/JS), kenapa approach-nya beda dari webapp?
2. Komponen apa aja yang main, dan siapa yang tahu kapan harus jalan?
3. Kenapa Manifest V3 ngotot ngubah model yang dulunya "udah jalan"?

## Model awal yang kelihatan bener

Intuisi pertama kebanyakan orang — termasuk gue pas mulai project ini:

```text
extension = webapp kecil + manifest.json biar Chrome mau load
```

Ada popup (HTML), ada logic (JS), ada manifest sebagai "package.json-nya
Chrome". Tinggal tulis kayak bikin web biasa, terus load unpacked. Beres.

Model ini adil sebagai titik mulai, dan dia bener menjelaskan ~30% realita:
popup extension emang halaman HTML biasa, dan JavaScript-nya emang
JavaScript beneran. Masalahnya, 70% sisanya justru tempat semua bug
penting tinggal.

## Di mana model itu jebol: tiga kejadian dari project ini

Bukti pertama datang pas Task 1 project x-downloader. File `content.js`
ditulis kayak module biasa:

```js
import { createMessage } from "./messaging.js";
```

Secara sintaks ini JavaScript valid. Tapi kalau beneran di-load, Chrome
nolak: content script **tidak boleh** pakai static `import`/`export`.
Solusinya bukan "benerin sintaks", tapi **nulis ulang file-nya sebagai
classic script** dan mirror kosakata pesannya manual. Sintaks yang sama,
aturan main beda tergantung *di konteks mana file itu jalan*.

Kejadian kedua: tombol "Check connection" balas `not reachable` padahal
extension-nya ke-load sempurna. Penyebabnya bukan code yang salah, tapi
**timing injeksi**: tab X yang dibuka *sebelum* extension di-load nggak
punya content script di dalamnya. Di webapp biasa, konsep "halaman lama
nggak kenal code yang baru di-install" itu nggak ada — deploy baru =
semua pengunjung dapat versi baru. Di extension, setiap tab adalah dunia
yang code-nya disuntik pada momen tertentu.

Kejadian ketiga masih berupa bayangan di plan Task 4: `fetch` media yang
sama akan **berhasil dari content script tapi gagal dari popup**, karena
yang satu jalan bawa cookies dan origin halaman X, yang satu jalan dari
origin `chrome-extension://`. Fungsi identik, hasil beda, cuma karena
konteks eksekusinya beda.

Tiga kejadian, satu pola: di extension, pertanyaan "code-nya bener nggak?"
selalu kalah penting dari pertanyaan "code ini jalan **di mana**?".

★ Insight ─────────────────────────────────────
- Webapp: satu code, satu konteks (halaman). Yang penting kebenaran logic.
- Extension: satu code, banyak konteks terisolasi. Yang penting posisi
  code di peta konteks + cara konteks-konteks itu ngobrol.
- Mayoritas bug extension adalah bug *lokasi*, bukan bug *logic*.
─────────────────────────────────────────────────

## Masalah aslinya: browser butuh tamu istimewa, bukan penghuni baru

Mundur selangkah. Sebelum extension ada, web cuma punya satu aktor yang
bisa jalanin code: **halaman web itu sendiri**, di dalam sandbox yang
ketat. Sandbox ini sengaja pelit: halaman nggak boleh baca tab lain,
nggak boleh download file diam-diam, nggak boleh ubah UI browser.

Terus muncul kebutuhan yang sah: ad-blocker, password manager, downloader
kayak yang lagi kita bangun — program yang hidupnya *nempel* ke browsing
activity user, butuh kemampuan di luar jatah halaman web biasa (baca DOM
situs orang, download file, jalan di background).

Solusi obvious-nya: kasih halaman web API yang lebih sakti? Nggak bisa.
Kalau `chrome.downloads` atau baca-cross-tab dibuka buat semua situs,
tiap situs jahat langsung dapat kunci yang sama. Kemampuan dan izinnya
nggak bisa dipisah kalau aktornya cuma satu.

Jadi browser butuh **aktor kedua**: program yang *bukan* halaman web,
dikenali browser secara eksplisit, dikasih kemampuan ekstra, tapi
diikat kontrak izin yang user setujui di muka. Itu extension. Dan
`manifest.json` adalah kontraknya: di situ extension deklarasi "gue mau
kemampuan X di situs Y", browser yang negosiasi sisanya sama user.

Kenapa nggak cukup pakai userscript (Greasemonkey/Tampermonkey)? Karena
userscript pada dasarnya code suntikan tanpa identitas kontrak: tanpa
model izin standar, tanpa review store, tanpa isolasi yang dijamin
browser. Buat satu user oke; buat ekosistem yang mesti dipercaya jutaan
orang, browser butuh format yang bisa diaudit. Manifest adalah jawaban
institusional atas masalah kepercayaan itu, bukan sekadar config.

## Pergeseran desainnya: dari satu halaman ke banyak konteks + bus pesan

Begitu aktor kedua ini ada, muncul pertanyaan desain: code extension
jalannya di mana? Jawaban Chrome: **dipecah ke beberapa konteks
eksekusi yang saling terisolasi, dihubungkan message passing**. Ini
keputusan yang menjelaskan hampir semua keanehan di atas.

Petanya buat Manifest V3:

```text
┌──────────────┐   chrome.tabs.sendMessage /   ┌───────────────────┐
│    Popup     │ ──► runtime.sendMessage ──────► │  Content script   │
│ halaman kecil│                                │ di dalam tab X    │
│ mati pas     │ ◄── respond ────────────────── │ DOM ✓, cookies ✓  │
│ ditutup      │                                │ import ✗          │
└──────────────┘                                └───────────────────┘
       │                                                 │
       │                 ┌───────────────────┐           │
       └───────────────► │ Service worker    │ ◄─────────┘
           message       │ tanpa DOM/window  │
                         │ mati pas idle,    │
                         │ hidup pas ada     │
                         │ event             │
                         └───────────────────┘
```

Tiap kotak adalah program JavaScript penuh dengan kemampuan dan
kematian yang beda. Popup itu halaman HTML biasa (`chrome-extension://`
origin) yang **mati tiap ditutup** — state di variabel global lenyap.
Service worker nggak punya DOM dan `window` sama sekali, dan Chrome
boleh mematikannya pas idle lalu menyalakannya lagi pas ada event —
jadi nyimpen state di memori global adalah bug yang nunggu waktu.
Content script satu-satunya yang pegang DOM halaman, tapi dia tamu di
rumah orang: jalan di dunia terisolasi, dengan barang bawaan API yang
dibatasi.

Dokumentasi resmi Chrome menyatakannya eksplisit: content script cuma
boleh akses segelintir API langsung (`storage`, sebagian `runtime`,
`i18n`, `dom`); sisanya wajib lewat pesan ke komponen lain.[^content-scripts]
Ini bukan keterbatasan sambil-lalu — ini *the design*. Tiap konteks
dibuat buta terhadap sisanya supaya satu komponen yang ke-compromise
nggak otomatis jadi kunci seluruh browser.

Jembatan ke pertanyaan berikutnya: kalau isolasinya seketat ini, gimana
content script bisa nyentuh halaman tanpa merusak atau dirusak halaman?

## Isolated world: meja yang sama, kepala yang beda

Jawabannya namanya **isolated world**. Content script dan JavaScript-nya
halaman berbagi DOM yang sama, tapi heap JavaScript-nya kepisah total.
Dokumentasi Chrome ngasih contoh yang bagus: halaman dan content script
bisa pasang variabel dan listener bernama sama di tombol yang sama, dan
keduanya jalan berurutan tanpa tabrakan — karena masing-masing hidup di
dunianya sendiri.[^content-scripts] Variabel `window.myApp` milik halaman
nggak kelihatan dari content script, dan sebaliknya.

Buat project kita, ini menjawab kenapa scraper harus baca DOM, bukan
state JavaScript-nya X: dari isolated world, DOM adalah satu-satunya
jembatan yang dishare. State internal React/X tidak bisa diintip —
makanya plan kita ngotot selector DOM dengan fallback, dan makanya field
yang nggak ada di DOM diisi kosong, bukan diakalin.

Tapi isolasi selalu punya harga. Harga di sini: **nggak ada lagi
"panggil fungsi tetangga"**. Semua koordinasi harus lewat pesan
asinkron, lengkap dengan mode gagalnya (pesan nyasar, ujung penerima
belum lahir, worker lagi tidur). Error `not reachable` yang kita temui
itu bukan anomali — itu suara normal dari arsitektur ini.

★ Insight ─────────────────────────────────────
- Isolated world = keamanan (tabrakan dan sadap antar code dicegah).
- Harganya = semua komunikasi jadi async messaging yang bisa gagal.
- Makanya skill utama dev extension bukan "jago DOM", tapi "jago
  mikir kegagalan pesan": siapa kirim, siapa dengar, kapan masing-masing
  hidup.
─────────────────────────────────────────────────

## Jalan-jalan konkret: kenapa PING kita bisa gagal lalu bisa berhasil

Ikutin satu klik "Check connection" dari ujung ke ujung biar mekanismenya
kelihatan:

1. **Mulai:** user klik. Popup (yang cuma hidup selama kebuka) manggil
   `chrome.tabs.query` buat cari tab aktif, terus `tabs.sendMessage`.
2. **Syarat tak terlihat:** di tab itu *harus sudah ada* content script
   yang keinjek — entah otomatis pas halaman load (kalau `matches`
   cocok) atau belum ada sama sekali (kalau tab dibuka sebelum extension
   di-install).
3. **Kalau belum ada:** nggak ada listener di ujung sana. Chrome
   melempar "receiving end does not exist". Popup nangkap, nampilin
   `not reachable`. Inilah yang terjadi ke kita.
4. **Reload tab:** browser load ulang halaman, lihat manifest,
   cocokkan `matches: x.com`, suntik `content.js` di momen
   `document_idle` (default: setelah DOM beres). Listener
   `runtime.onMessage` sekarang berdiri.
5. **Klik lagi:** pesan sampai, listener jawab `{ connected: true }`.

Perhatikan siapa yang "tahu" apa: popup nggak tahu content script ada
atau nggak sebelum mencoba; content script nggak tahu popup kapan
dibuka; browser yang tahu jadwal injeksi dari manifest. Nggak ada
komponen sentral yang ngatur — perilakunya *emergent* dari kontrak +
timing. Mental model webapp ("panggil fungsi, dapat hasil") gagal total
di sini; yang bener: "kirim pesan, siap-siap nggak dibalas".

## Kasus yang nggak kejawab jalur normal: fetch yang sama, hasil beda

Sekarang uji modelnya pakai kasus Task 4 yang akan datang. Kita perlu
download gambar dari `pbs.twimg.com`. Dua opsi:

- **Fetch dari content script:** request berangkat dari konteks halaman
  X — bawa cookies sesi login user, origin-nya halaman. Server ngasih
  file karena "yang minta" adalah user yang lagi login. Ini kenapa
  AGENTS.md kita ngotot fetch media cuma dari content script.
- **Fetch dari popup/service worker:** origin-nya
  `chrome-extension://<id>`, tanpa cookies X. Server boleh nolak
  (ranah privat), atau CORS/CSP halaman menghalangi.

Fungsi `fetch`-nya identik. Yang beda: **identitas network si pemanggil**.
Di webapp, identitas pemanggil selalu halaman itu sendiri, jadi pertanyaan
ini nggak pernah muncul. Di extension, tiap konteks punya paspor beda —
dan milih paspor yang salah adalah bug yang pesan errornya misleading
(CORS error yang sebenarnya masalah "lu siapa?").

Edge case sejenis: kenapa content script nggak bisa static `import`?
Karena file-nya disuntik sebagai classic script ke halaman orang, bukan
di-load sebagai module graph milik extension. Popup dan worker boleh
jadi module (`"type": "module"` di manifest) karena mereka halaman milik
extension sendiri. Sekali lagi: aturan bahasanya ditentukan *lokasi*,
bukan isi file. Test `classic-safe` di repo kita ada justru buat jagain
batas ini — compiler nggak akan protes, Chrome yang akan.

## Trade-off yang diterima dan yang ditolak

| Dipilih | Harga yang dibayar |
|---|---|
| Konteks terisolasi + pesan | Semua koordinasi async dan bisa gagal; debugging nyebar |
| Service worker efemeral (MV3) | Dilarang nyimpen state di memori; wajib `chrome.storage` |
| Popup mati pas ditutup | Nggak ada proses UI yang long-lived; progress harus di-push, bukan di-poll dari memori |
| Izin deklaratif di muka | User bisa nolak; tambah izin = extension di-disable sampai disetujui |

Yang menarik: tiap baris di tabel kiri dulunya *bisa* di MV2 (background
page persistent, remote code, blocking webRequest). MV3 sengaja narik
tiga-tiganya: background page diganti service worker supaya code cuma
jalan pas dibutuhkan (hemat resource), remote code dilarang total supaya
yang jalan cuma code yang sudah direview store, dan eksekusi string
arbitrer (`eval`, `code:` string di `executeScript`) dihapus.[^mv3][^migrate]
Motivasi resminya dua: performa dan privasi/keamanan — background abadi
ngabisin resource walau extension nganggur, dan webRequest blocking
maksa extension baca tiap request user (akses data berlebihan) plus
lambat karena serialisasi lintas proses.[^mv3-overview]

Ini menjelaskan kenapa vendor lib kita harus lokal (`vendor/*.min.js`)
dan kenapa `eval`/CDN dilarang di AGENTS.md: bukan gaya-gayaan, tapi
aturan main MV3 yang kalau dilanggar bikin extension ditolak store.

## Evolusi yang masuk akal sekarang: MV2 → MV3

Dengan model di atas, migrasi MV2→MV3 berhenti kelihatan kayak "Google
iseng ganti API" dan mulai kelihatan sebagai pendalaman prinsip yang
sama:

```text
MV2: background page hidup terus  →  boros, state sembarangan
MV3: service worker efemeral      →  hemat, state dipaksa eksplisit

MV2: executeScript pakai string   →  code bisa dirakit saat jalan
MV3: cuma file & fungsi           →  semua code auditable

MV2: remote script dari CDN       →  review store jadi pajangan
MV3: semua logic dalam paket      →  yang direview = yang jalan
```

Pola evolusinya satu arah: **mempersempit kapan code boleh jalan, di
mana, dan dari mana asalnya**. Tiap penyempitan bikin kelas bug/eksploit
tertentu mustahil, dengan harga fleksibilitas developer. Nggak heran
migrasinya sakit — yang dipindah bukan API-nya doang, tapi asumsi
"backend gue selalu hidup" yang selama ini gratis di MV2.

## Model mental yang lebih kuat

Ganti model awal dengan yang ini:

```text
Extension = beberapa program kecil yang terisolasi,
masing-masing dengan kemampuan, lifecycle, dan identitas network sendiri,
dideklarasikan lewat satu kontrak (manifest),
dan cuma bisa saling ngobrol lewat pesan asinkron yang bisa gagal.
```

Tes model ini ke pertanyaan praktis:

- *"Kenapa popup gue kehilangan state?"* — Karena popup mati pas
  ditutup. State pindah ke `chrome.storage` atau worker via pesan.
- *"Kenapa fetch di worker ditolak server?"* — Karena paspor network-nya
  beda. Pindah ke content script kalau butuh sesi halaman.
- *"Kenapa content script nggak jalan di tab lama?"* — Karena injeksi
  terjadi pas load. Tab lama = dunia tanpa tamu; reload dulu.
- *"Kenapa background logic gue kadang ke-reset?"* — Karena worker
  efemeral. Jangan taruh state di variabel global.
- *"Boleh load lib dari CDN biar enteng?"* — Tidak di MV3. Bundle lokal.

Kalau lima-limanya bisa dijawab tanpa buka docs, modelnya udah nempel.

## Pertanyaan terbuka

- Seberapa jauh pola "banyak konteks + bus pesan" ini bisa dibawa ke
  arsitektur webapp biasa (mis. micro-frontend, worker-based app)?
  Batasnya di mana?
- Firefox/Safari ikut MV3 dengan dialek sendiri (event page di Firefox,
  dsb). Seberapa portable pola classic-safe + mirror-vocabulary kita
  kalau suatu hari targetin mereka?
- `world: MAIN` (content script jalan di dunia halaman, bisa intip JS
  page tapi kehilangan sebagian API Chrome) — kapan project kita butuh
  ini? Hari ini jawabannya "belum", tapi scraper DOM-only kita rapuh
  terhadap perubahan markup; MAIN world + baca state internal X adalah
  alternatif yang lebih kuat sekaligus lebih berisiko. Trade-off ini
  layak jadi dokumen lanjutan kalau selector DOM mulai sering jebol.

## Referensi

[^content-scripts]: Google Chrome Developers, “Content scripts,”
  Chrome for Developers, diakses 2026-09-07.
  https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
[^mv3]: Google Chrome Developers, “Manifest V3 migration checklist /
  Migrate to Manifest V3,” Chrome for Developers, pembaruan 2024-02-14,
  diakses 2026-09-07.
  https://developer.chrome.com/docs/extensions/develop/migrate
[^migrate]: Google Chrome Developers, “Migrate to a service worker,”
  Chrome for Developers, 2023-03-09, diakses 2026-09-07.
  https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers
[^mv3-overview]: GoogleChrome/developer.chrome.com, “MV3 Overview”
  (artikel ringkasan Manifest V3: service worker gantikan background
  page, Chrome 88, Web Store terima MV3 sejak Januari 2021), diakses
  2026-09-07. https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/docs/extensions/mv3/intro/mv3-overview/index.md
