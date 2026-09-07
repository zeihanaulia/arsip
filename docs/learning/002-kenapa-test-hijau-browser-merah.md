---
title: "Kenapa Test Hijau Tapi Browser Merah"
created: 2026-09-07
updated: 2026-09-07
status: draft
tags:
  - chrome-extension
  - manifest-v3
  - testing
  - retrospectif
sources:
  - https://developer.chrome.com/docs/extensions/develop/concepts/messaging
  - https://issues.chromium.org/issues/40876652
  - https://stackoverflow.com/questions/68137730/typeerror-error-url-createobjecturl-not-a-function
  - https://stackoverflow.com/questions/73867123/message-port-closed-before-a-response-was-received-despite-return-true
---

# Kenapa Test Hijau Tapi Browser Merah

> Task 2 selesai dengan 31/31 test hijau, termasuk E2E Chromium headed.
> Terus dibuka di browser beneran — gagal dua kali, dengan dua error yang
> beda. Kok bisa?

Dokumen ini ngebahas tiga pertanyaan yang nyambung:

1. Apa yang sebenarnya dibangun di Task 2, secara fundamental?
2. Kenapa dua bug-nya lolos dari test yang hijau itu?
3. Strategi testing kayak apa yang selamat dari kejadian ini?

Dokumen pendamping: [001](./001-chrome-extension-bukan-webapp-biasa.md)
menjelaskan *peta konteks* extension (popup, worker, content script).
Dokumen ini menjelaskan apa yang terjadi pas peta itu dipakai beneran —
retrospektif Task 2, komit `6645810`.

## Model awal yang kelihatan bener

Pas Task 2 mulai, model kerjanya kelihatan solid dan familiar:

```text
TDD: test dulu (RED) → code minimal (GREEN) → verify hijau → beres
```

Test-nya bukan main-main: unit test buat perakitan snapshot, plus E2E
Playwright yang jalanin Chromium beneran (headless DAN headed), load
fixture thread, dan buktiin scraper ngeluarin 3 tweet yang bener —
dedup jalan, metrics kepaca, foto ke-detect. 29/29 hijau sebelum
ngomong "selesai".

Intuisinya: kalau logika scrape-nya udah kebukti di Chromium asli,
sisanya (kirim pesan, download file) adalah plumbing standar yang
ngikutin docs. Plumbing jarang salah.

Model ini adil — dan dia bener buat ~80% Task 2. Scraper-nya (`src/x-adapter.js`)
emang jalan di thread X nyata tanpa perubahan: 13 tweet ke-capture dari
thread GergelyOrosz, JSON valid. Yang jebol justru 20% yang dianggap
"plumbing standar". Dua-duanya.

## Di mana model itu jebol: dua kegagalan di browser beneran

Kegagalan pertama: klik Download JSON, status popup macet di
"scraping visible tweets…" selamanya. Nggak ada error, nggak ada file.
Cuma spinner abadi.

Kegagalan kedua (sesudah hang-nya di-fix): error merah di halaman
extension —
`Uncaught (in promise) TypeError: URL.createObjectURL is not a function`,
konteks `src/background.js`.

Perhatikan polanya: dua-duanya BUKAN bug logika scrape. Test E2E yang
hijau ngetest persis logika itu — dan logika itu emang bener. Yang gagal
adalah dua hal yang test-nya nggak pernah sentuh: **liveness channel
pesan** dan **kapabilitas API di konteks worker**. Test-nya hijau karena
dia nggak ngeliat ke sana.

★ Insight ─────────────────────────────────────
- Test hijau menjawab "logikanya bener?" — dan jawabannya emang iya.
- Browser merah menjawab dua pertanyaan lain yang nggak ditanyain test:
  "jawabannya nyampe?" dan "API-nya ada di konteks ini?"
- Di extension, tiga pertanyaan itu independen. Lolos satu nggak
  menjamin dua lainnya.
─────────────────────────────────────────────────

## Masalah aslinya: tiga konteks, tiga kemampuan, satu channel rapuh

Buat ngerti kenapa dua bug itu ada, petakan dulu apa yang terjadi pas
tombol Download diklik — siapa megang kendali, kapan:

```text
popup                    background (SW)              tab (content script)
  │                            │                              │
  │── SCRAPE_START ───────────►│                              │
  │   (runtime.sendMessage)    │── SCRAPE_START ─────────────►│
  │                            │   (tabs.sendMessage)         │── scrape DOM ──►
  │                            │◄── SCRAPE_DONE ──────────────│
  │                            │── rakit + validasi ──►      │
  │                            │── chrome.downloads ──►      │
  │◄── SCRAPE_DONE ────────────│                              │
```

Tiga hop, tiga konteks eksekusi, dan tiap hop punya mode gagal sendiri.
Dokumentasi resmi Chrome nyusun aturannya eksplisit: `sendResponse`
harus dipanggil sinkron, ATAU listener harus `return true` biar channel
tetap kebuka buat jawaban async.[^messaging] Janji "gue jawab nanti"
itu kontrak — dan kontrak bisa wanprestasi.

Jembatan ke pertanyaan berikutnya: kontrak yang wanprestasi itu
kelihatannya kayak apa? Persis kayak screenshot kita: bukan error keras
di tempat salah, tapi keheningan. Popup nunggu janji yang nggak pernah
datang.

## Bug pertama: keheningan sebagai failure mode

Telusuri kenapa popup bisa nunggu selamanya. Rantai penyebabnya tiga
lapis, dan ketiganya harus ada bareng:

1. **Tab basi.** Tab X dibuka sebelum extension di-reload sesudah
   update Task 2, jadi content script di dalamnya versi lama (atau nggak
   ada). Pesan ke tab gagal atau dibalas code yang nggak kenal
   `SCRAPE_START`.
2. **Background tanpa jaring pengaman.** `downloadVisibleThread()` nggak
   punya try/catch. `tabs.sendMessage` yang reject bikin janji ke popup
   nggak pernah ditepati — padahal listener-nya udah `return true`.
3. **Popup tanpa timeout.** Nunggu `sendMessage` tanpa batas waktu, jadi
   keheningan di hulu tampil sebagai spinner abadi di hilir.

Chrome akhirnya nutup channel yang digantung — dan justru penutupan itu
yang ngasih error paling informatif sepanjang sesi debug: *"A listener
indicated an asynchronous response by returning true, but the message
channel closed before a response was received"*. Error yang kelihatannya
misterius ini sebenarnya diagnosis presisi: ada yang janji jawab async
terus ingkar. Komunitas extension nabrak error yang sama sejak migrasi
MV2→MV3, umumnya karena `return true` yang salah tempat atau listener
yang keburu mati.[^so-channel]

Kenapa test nggak nangkap ini? Karena nggak ada test yang mensimulasikan
tab basi. Fixture thread selalu sehat, adapter selalu keinjek, pesan
selalu dibalas. Test ngebuktiin jalur bahagia di satu konteks; bug-nya
tinggal di interaksi antar-konteks yang nggak pernah dimodelkan.

Fix-nya tiga lapis juga, cerminan penyebabnya: content script nggak
boleh lempar exception keluar listener (`scrapeSafely()` selalu jawab,
sukses atau `SCRAPE_ERROR`), background nggak boleh reject ke popup,
popup pasang timeout 30 detik. Prinsipnya satu kalimat: **di arsitektur
pesan, setiap hop wajib menjamin respons — error yang nyampe selalu
lebih baik dari keheningan.**

Buat buktiin fix-nya, regression test-nya mensimulasikan persis kondisi
tab basi: injek `content.js` TANPA `x-adapter.js`, kirim `SCRAPE_START`,
tuntut jawaban `SCRAPE_ERROR`. Test ini dibuktiin RED lawan code sebelum
fix (listener-nya lempar, test gagal) dan GREEN sesudahnya. Inilah test
yang seharusnya ada dari awal — dan pelajaran session ini: buat
extension, "kondisi basi" bukan edge case, itu mode operasi normal
(tab lama selalu ada).

## Bug kedua: API yang ada di docs tapi nggak ada di konteks

Sesudah hang beres, scrape jalan sampai akhir — assemble, validasi,
bikin file — terus mati di baris terakhir: `URL.createObjectURL is not
a function` di service worker.

Ini bukan typo dan bukan versi Chrome yang salah. API itu memang nggak
ada di service worker. Blob URL butuh dokumen sebagai jangkar scoping,
dan worker — extension maupun web — nggak punya window/dokumen, jadi
fungsinya undefined.[^crbug] Issue Chromium-nya dibuka sejak 2022 dan
berstatus keinginan, bukan bug yang mau di-fix: keterbatasan ini
struktural, bukan sementara.

Kenapa ketulis di tempat yang salah sejak awal? Karena intuisi webapp:
"kan JavaScript, `URL.createObjectURL` ada di mana-mana". Di popup (ada
dokumen) emang ada. Di content script (nempel dokumen halaman) emang
ada. Di worker nggak ada. Tiga konteks, tiga daftar API — dan yang
dipakai nulis code waktu itu adalah ingatan dari konteks yang salah.
TypeScript juga nggak nolong: `URL` ada di lib types, jadi `tsc` diem
aja. Type system ngecek nama, bukan konteks eksekusi.

Solusinya ngikutin workaround kanonik komunitas: embed bytes sebagai
base64 data URL (`data:application/json;base64,...`) yang dimengerti
`chrome.downloads` tanpa perlu dokumen.[^so-blob] Tapi ada keputusan
desain yang lebih penting dari workaround-nya: fungsi encoding-nya
(`snapshotToDataUrl`) ditaruh di `snapshot.js` yang pure dan bisa
di-unit-test round-trip (encode → decode → validate), BUKAN inline di
background yang butuh `chrome.*` dan nggak bisa di-test di Node. Pelajaran
umumnya: **logika yang nempel API konteks-spesifik itu nggak testable —
kupas yang pure keluar, sisain yang tipis di dalam.**

Trade-off yang diterima sadar: base64 ngembung ~33% dan data URL raksasa
bisa nyekek memori worker. Buat JSON viewport Task 2 (KB-an) ini
irrelevan; buat ZIP+media Task 4 nanti ini jadi pertanyaan terbuka yang
dicatat di bawah.

## Jalan-jalan konkret: satu klik Download yang akhirnya berhasil

Biar mekanismenya nempel, ikutin klik yang sukses dari ujung ke ujung
pasca-fix:

1. Popup kirim `SCRAPE_START` ke background (dengan timeout 30 dtk
   sebagai jaring terakhir).
2. Background teruskan ke tab aktif. Kalau tab basi → reject → Bungkus
   catch → popup terima `UNEXPECTED` + detail, bukan spinner abadi.
3. Content script scrape via `XAdapter` dalam `scrapeSafely()`. Kalau
   adapter nggak keinjek → `SCRAPE_FAILED` + pesan "reload the extension
   and the tab", bukan exception yang ngegantung channel.
4. Background rakit snapshot (dedup, drop tanpa id), validasi, encode
   ke data URL, `chrome.downloads.download`.
5. Popup terima `SCRAPE_DONE` → tampil
   `downloaded x-thread-<id>-<tanggal>.json (13 tweets)`.

Hasilnya di thread nyata: 13 tweet, JSON lolos `python3 -m json.tool`.
Satu temuan bonus dari data asli: tweet iklan (promoted) kebawa karena
ke-render di viewport, dan `createdAt`-nya kosong karena markup
tanggalnya beda. Keduanya ditangani sesuai prinsip yang udah dikunci:
ambil apa adanya, kosongin yang nggak ada, jangan ngarang — dan filter
iklan dicatat buat Task 3.

## Model mental yang lebih kuat

Ganti "test hijau = beres" dengan persamaan tiga faktor:

```text
kebenaran extension = kebenaran logic × kebenaran konteks × liveness channel
```

- **Logic** (parse bener? dedup bener?): unit test + E2E fixture. Sudah
  kuat di Task 2.
- **Konteks** (API-nya ada di sini? file ini jalan sebagai apa?):
  nggak bisa diuji dari Node — butuh checklist konteks per file
  (classic vs module, dokumen vs worker) plus test manifest
  (`classic-safe`, vocabulary pinning) yang udah ada sejak Task 1.
- **Channel** (jawabannya nyampe? kalau ujungnya basi?): butuh test
  kondisi-basi dan invariant "tiap hop wajib jawab". Baru ditambah di
  Task 2 sesudah kebakar.

Tes model ini ke pertanyaan praktis:

- *"Kenapa E2E headed hijau tapi browser merah?"* — Karena E2E-nya
  nguji logic di konteks buatan yang sehat; channel dan kapabilitas
  konteks asli nggak ikut diuji.
- *"Error channel-closed itu maksudnya apa?"* — Ada listener yang
  `return true` (janji async) tapi nggak pernah panggil respond.
  Cari throw yang kelewat atau reject yang nggak di-catch di rantai
  async-nya.
- *"`URL.X` ada di autocomplete tapi undefined pas jalan — kenapa?"* —
  Cek konteks eksekusi file-nya dulu sebelum cek versi Chrome. Type
  system nggak ngejagain ini.
- *"Taroh logic di file mana biar ketest?"* — Yang pure di modul yang
  bisa di-import Node; yang nempel `chrome.*`/DOM setipis mungkin di
  pinggir.

## Pertanyaan terbuka

- Data URL buat JSON kecil oke. Buat ZIP+media Task 4 (potensi MB-an),
  apakah tetap data URL dari worker, atau encoding + blob URL pindah ke
  content script/popup yang punya dokumen? Keputusan ini ngaruh ke
  arsitektur Task 4 — layak jadi inquiry sendiri pas sampai sana.
- Fixture E2E kita sehat-selalu. Seberapa jauh "fixture sakit" (DOM
  berubah, selector hilang, promoted content) bisa diotomatisasi tanpa
  maintenance cost yang bunuh diri tiap X ganti markup?
- Chrome 148+ ngizinin listener return promise sebagai jawaban async,
  dan Chrome 146+ bikin throw di listener reject sender —
  dua-duanya rolling out bertahap.[^messaging] Pattern `return true`
  kita tetap bener buat kompatibilitas, tapi kapan waktunya pindah?

## Referensi

[^messaging]: Google Chrome Developers, “Message passing,” Chrome for
  Developers, diakses 2026-09-07. Kontrak `return true` untuk respons
  async, return promise sejak Chrome 148, dan throw-di-listener
  me-reject sender sejak Chrome 146.
  https://developer.chrome.com/docs/extensions/develop/concepts/messaging
[^crbug]: Chromium issue tracker, “Allow extension service workers to
  use URL.createObjectURL()” (issue 40876652, dibuka 2022-11-03):
  error persis `TypeError: URL.createObjectURL is not a function` di
  MV3 service worker, direproduksi minimal.
  https://issues.chromium.org/issues/40876652
[^so-blob]: Stack Overflow, “TypeError: Error URL.createObjectURL()
  not a function” (2021): `createObjectURL` tidak diizinkan di service
  worker — pakai data URL; jawaban yang diterima nunjukin pola
  base64 → `chrome.downloads.download` yang sama dengan fix kita.
  https://stackoverflow.com/questions/68137730/typeerror-error-url-createobjecturl-not-a-function
[^so-channel]: Stack Overflow, “message port closed before a response
  was received despite return true” (2022): `return true` yang ditaruh
  di handler async yang telat (bukan di listener sinkron) bikin channel
  ditutup duluan — varian lain dari kontrak async yang wanprestasi.
  https://stackoverflow.com/questions/73867123/message-port-closed-before-a-response-was-received-despite-return-true
