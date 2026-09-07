---
title: "Kenapa Download Video Bukan Satu Masalah"
created: 2026-09-07
updated: 2026-09-07
status: draft
tags:
  - chrome-extension
  - manifest-v3
  - media-pipeline
  - hls
sources:
  - https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob
  - https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static
  - https://www.rfc-editor.org/info/rfc8216
---

# Kenapa Download Video Bukan Satu Masalah

> ZIP kemarin: 6 foto masuk, 2 video gagal, 0 caption. Satu pipeline,
> tiga nasib. Kalau "download medianya" satu masalah, kok hasilnya
> tiga macem?

Dokumen ini ngebahas tiga pertanyaan yang nyambung:

1. Kenapa komponen yang megang bytes nggak bisa nulis file, dan yang
   bisa nulis file nggak bisa fetch?
2. Kenapa satu URL video tidak sama dengan satu file?
3. Gimana plafon jujur tiap jenis media ditentukan bukti, bukan teori?

Dokumen pendamping: [001](./001-chrome-extension-bukan-webapp-biasa.md)
(peta konteks), [002](./002-kenapa-test-hijau-browser-merah.md)
(logic × konteks × channel). Dokumen ini soal apa yang terjadi pas
peta itu disuruh mindahin bytes beneran — retrospektif Task 4, 4b, dan
debug video (`797f2ce`, `0d3df22`, `d071aea`, `387014e`, `4234101`).

## Model awal yang kelihatan bener

Rencana Task 4 di atas kertas itu uniform dan masuk akal:

```text
inventarisir URL → fetch satu-satu → masukin ZIP → download
```

Media adalah URL, download adalah fetch, bundle adalah zip. Satu
pipeline, satu pola, tinggal diulang per file. Foto, video, caption —
bedanya cuma ekstensi. Model ini yang bikin estimasi Task 4 "Medium
(3-4 files)".

Model ini adil — dan dia bener buat tepat satu jenis media: foto
publik. Enam foto di ZIP kemarin ngebuktiin jalurnya hidup end-to-end.
Yang jebol adalah asumsi "tinggal diulang per file": tiap jenis media
ternyata punya fisika beda, dan fisika itu ditentukan siapa yang bikin
URL-nya, bukan siapa yang mau download.

## Di mana model itu jebol: tiga konteks, tiga kemampuan, nol overlap

Masalah pertama muncul sebelum satu byte pun di-fetch: nggak ada
komponen yang bisa kerja sendirian.

- **Content script** bisa fetch (ikut sesi login tab) dan bisa rakit
  ZIP (JSZip classic hidup di page context). Tapi nggak bisa manggil
  `chrome.downloads` — API itu nggak ada di daftar pendek yang boleh
  diakses langsung dari content script.
- **Service worker** bisa manggil `chrome.downloads`, tapi nggak bisa
  `URL.createObjectURL` (nggak ada dokumen sebagai jangkar — ini
  struktural, bukan bug versi; MDN nyatet pengecualiannya eksplisit
  dengan alasan memory leak[^create-object-url]), dan fetch-nya jalan
  tanpa cookies sesi halaman.
- **Popup** punya dokumen dan semua API, tapi mati tiap ditutup —
  bukan tempat buat kerjaan menit-an.

Jadi "download media ke ZIP" nggak bisa ditulis sebagai satu fungsi di
satu file. Dia harus jadi rute estafet: content fetch bytes →
background rakit JSON + manifest (di situ kontrak `ThreadSnapshot`
tinggal) → content rakit ZIP (di situ JSZip tinggal) → background
download. Itulah kenapa muncul tipe pesan `BUILD_ZIP` dan kenapa flow-
nya bolak-balik tab dua kali. Bukan over-engineering — ini satu-satunya
bentuk yang muat di peta kapabilitas MV3. Alternatifnya (duplikat logika
assembly di content biar sekali jalan) ditolak karena ngeduplikat
kontrak data yang Task 1 susah-payah tunggalin.

Jembatan ke pertanyaan berikutnya: estafetnya jalan. Tapi pas giliran
video, bytes-nya nggak ada yang bisa dibawa. Kenapa URL video bukan
kayak URL foto?

## Satu URL video tidak sama dengan satu file

Foto itu file: satu URL menunjuk satu bytes yang utuh. Dunia video X
nggak begitu. Tiga wujud berbeda, tiga fisika berbeda:

**Poster** adalah foto biasa (`pbs.twimg.com/amplify_video_thumb/...`).
Satu-satunya yang uniform. Kejutan kecilnya: path CDN-nya beda dari foto
tweet (`/media/`), jadi selector yang nyari pola path bakal miss —
untung code baca atribut `poster` apa adanya, bukan polanya. Pelajaran
umum: seleksi atribut, bukan URL.

**Blob URL** (`blob:https://x.com/<uuid>`) bukan pointer ke file —
dia identifier opaque ke objek in-memory yang dipegang pembuatnya.
MDN ngejelasin dua sifat yang menentukan nasib kita: URL-nya nyimpen
origin pembuat, dan fetch cuma bisa dari environment yang storage
key-nya cocok (state partitioning); plus pemiliknya bisa revoke kapan
aja, dan browser rilis otomatis pas dokumen unload.[^blob-urls] Jadi
"fetch blob player" itu taruhan: menang kalau partisi cocok dan belum
di-revoke, kalah kalau enggak. Bukti kita: menang di lab (Playwright,
satu partisi — test hijau), kalah di semua thread nyata (`fetch-failed`
di tiap manifest). Taruhannya murah (coba, gagal ya catat), jadi
diputuskan tetap coba — tapi plafonnya dicatat sebagai fakta
berdasarkan bukti, bukan teori.

**HLS** (`.m3u8`) bahkan bukan media — dia playlist teks yang ndaftar
segmen-segmen pendek plus varian kualitas, sesuai RFC 8216 (Apple,
2017).[^hls] "Download video HLS" artinya: resolve playlist → download
puluhan segmen → jahit ulang. Nggak ada operasi "fetch satu URL" yang
masuk akal. Makanya klasifikasi `hls-playlist` = unresolved by design,
bukan bug yang nunggu fix. Fix benerannya (donlot segmen + jahit) masuk
backlog B1, karena butuh intersepsi network — layer yang beda.

★ Insight ─────────────────────────────────────
- Foto: URL = file. Fetch → selesai.
- Blob: URL = janji in-memory yang bisa dicabut. Fetch = taruhan murah.
- HLS: URL = daftar belanja. Fetch langsung = kategori salah.
- Tiga-tiganya kelihatan kayak "URL video" di DOM. Fisikanya beda total.
─────────────────────────────────────────────────

## Jalan-jalan konkret: satu foto dan satu blob, ujung ke ujung

Biar mekanismenya nempel, ikutin dua file lewat estafet Task 4:

**Foto** (`media/HRmh...jpg`, 75KB): adapter catat `{url, type: photo}`
→ content cek `isFetchable` (https, bukan m3u8 → ya) → `fetchBytes`
dapat base64 + `image/jpeg` → `localName` jadi `media/<tweetId>-1.jpg`
→ background rakit `thread.json` + manifest (URL → localPath + mime) →
validasi → `BUILD_ZIP` ke tab → content rakit ZIP (JSZip) → background
download via data URL. Tujuh langkah, nol tebakan.

**Blob video** (`blob:https://x.com/8f60...`): adapter catat
`{url, type: video}` → `isFetchable`: bukan m3u8, skema blob →
coba → `fetch` reject (partisi/revoke, sesuai sifat blob di atas) →
`{unresolved: "fetch-failed"}` → manifest nyatet URL + alasan, bytes
nggak ada → `zipFiles` lewatin (nggak ada base64) → ZIP tetap valid
tanpa file itu. Jalur gagalnya dirancang sama seriusnya kayak jalur
sukses: tiap tahap tahu persis apa yang dilakukan kalau bytes nggak
datang.

Dua edge yang ngikut dari mekanisme ini: cap ~21MB per file (satu video
nggak boleh bunuh message channel — angka kalibrasi, bukan teori), dan
mode `separate` yang mindahin mp4 keluar ZIP via `chrome.downloads`
langsung (URL CDN publik, browser bawa cookies sendiri) dengan fallback
balik ke bundle kalau gagal. Default-nya `separate`, karena LLM nggak
bisa nonton video dan ZIP jumbo nggak bisa di-upload — keputusan produk
yang ngikutin fisika, bukan selera.

## Kasus yang nggak kejawab jalur normal: caption yang nggak ada

Video Theo ada tombol CC-nya. Player-nya punya subtitle. Tapi markup
`videoPlayer` dari DevTools user: `<video poster>` + `<source
blob:>` — nol `<track>`. URL subtitle X hidup di data API/JS internal,
di luar jangkauan isolated world. Jadi pilihannya: ngarang (nebak URL
subtitle dari pola) atau ngaku (`no-captions-in-dom`).

Dipilih ngaku, dengan dua lapis persiapan buat hari di mana caption
ADA: adapter inventory `<track src>` sebagai media `type: "captions"`,
dan `captionsToText()` yang ngereduksi WebVTT jadi baris siap-LLM
(buang header, timestamp, cue settings, voice tag, duplikat karaoke).
Keduanya di-test pakai fixture — jadi kalau suatu hari X nempelin
track di DOM, pipelinenya langsung jalan tanpa ubah struktur. Ini beda
penting antara "belum bisa" dan "nggak siap": yang pertama fakta
lapangan, yang kedua utang desain. Kita cuma punya yang pertama.

## Model mental yang lebih kuat

Ganti "download media = fetch semua URL" dengan:

```text
media pipeline = routing kapabilitas + plafon per jenis (berbasis bukti)
setiap URL berakhir di: bundled | separate | unresolved+alasan
```

- **Routing kapabilitas**: fetch di tab (sesi), rakit data di worker
  (kontrak), rakit ZIP di page (JSZip), download di worker
  (`chrome.downloads`). Tiap langkah tinggal di tempat yang BISA.
- **Plafon per jenis**: foto = bytes; mp4 langsung = bytes (coba);
  blob = taruhan (coba, catat kalahnya); HLS = unresolved by design;
  caption = kalau ada track-nya. Plafon ditulis dari bukti thread
  nyata, bukan dari docs.
- **`unresolved` sebagai output kelas satu**: manifest alasan
  (`blob-stream`, `hls-playlist`, `fetch-failed`, `too-large`,
  `skipped-by-mode`) sama pentingnya kayak file-nya. Silent-drop
  adalah satu-satunya kegagalan yang nggak termaafkan di pipeline ini.

Tes model ini ke pertanyaan praktis:

- *"Kenapa foto masuk tapi video enggak?"* — Lihat manifest, cari
  URL-nya. `fetch-failed` = partisi/revoke (coba B1). `hls-playlist`
  = kategori salah, bukan bug. `blob-stream` tanpa percobaan = code
  lama, update dulu.
- *"Kenapa ZIP-nya jumbo?"* — Cek mode video. `bundle` + mp4 gede =
  salah setting buat kebutuhan LLM; ganti `separate`/`posters-only`.
- *"Caption-nya mana?"* — Kalau manifest nggak punya entry
  `captions`, DOM-nya memang nggak nyediain. Bukan bug scraper.
- *"Bisa tambah jenis media baru?"* — Tambah cabang di adapter
  (inventory), aturan di `isFetchable`, ekstensi di peta MIME.
  Tiga titik, nggak lebih.

## Pertanyaan terbuka

- B1 (intersepsi network): `webRequest` observasional cukup buat
  nyatet varian mp4 + subtitle, atau perlu hook MAIN world? Bukti apa
  yang mutusin tanpa bangun dua-duanya?
- Cap 21MB/file dan data-URL ZIP: di titik mana thread raksasa bikin
  channel jebol duluan — dan apakah jawabannya valmist (keep it) atau
  download per-file langsung?
- `thread.md` Task 5: caption `.vtt` yang ke-download diformat inline
  (hemat upload) atau referensi path (hemat token)?

## Referensi

[^blob-urls]: MDN Web Docs, “blob: URLs,” diakses 2026-09-07.
  Blob URL adalah identifier opaque ke objek in-memory; fetch tunduk
  pada state partitioning (storage key harus cocok dengan environment
  pembuat); browser melepas otomatis saat dokumen unload.
  https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob
[^create-object-url]: MDN Web Docs, “URL: createObjectURL() static
  method,” diakses 2026-09-07. Tidak tersedia di Service Workers
  karena potensi memory leak.
  https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static
[^hls]: R. Pantos & W. May, “HTTP Live Streaming,” RFC 8216,
  Informational, Agustus 2017. m3u8 adalah playlist teks penunjuk
  segmen media; player fetch playlist lalu segmen satu-satu via HTTP.
  https://www.rfc-editor.org/info/rfc8216
