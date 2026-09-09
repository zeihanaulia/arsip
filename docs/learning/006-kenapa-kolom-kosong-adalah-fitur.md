---
title: "Kenapa Kolom Kosong Adalah Fitur"
created: 2026-09-09
updated: 2026-09-09
status: draft
tags:
  - export
  - csv
  - excel
  - honesty
sources:
  - https://www.rfc-editor.org/info/rfc4180
  - https://docs.sheetjs.com/docs/api/utilities/array
  - https://docs.sheetjs.com/docs/getting-started/installation/standalone
---

# Kenapa Kolom Kosong Adalah Fitur

> Target Task 6: file `.xlsx` yang kolomnya 1:1 dengan contoh
> `XCommentsExporter` — 43 kolom, dari Tweet Id sampai Scraped At.
> Dari DOM kita cuma punya belasan. Jadi 20+ kolom diisi apa? Kalau
> jawabannya "dikosongin", buat apa repot-repot meniru formatnya?

Dokumen ini ngebahas tiga pertanyaan yang nyambung:

1. Kenapa meniru layout pihak ketiga kalau datanya tidak ada?
2. Kapan kosong, kapan nol, dan kapan derivasi — tiga nasib field yang beda?
3. Kenapa CSV 20 baris dan XLSX butuh lib 881KB untuk data yang sama?

## Model awal yang kelihatan bener

Intuisi Task 6: petakan field snapshot ke kolom, join pakai koma,
selesai. CSV itu format paling sederhana di dunia — teks dipisah koma,
baris dipisah newline. Excel tinggal "CSV yang diformat". Dua-duanya
sepele dibanding scraper dan ZIP.

Model ini adil buat 80% pekerjaan: daftar kolom + mapping + join.
Yang 20% sisanya justru yang menentukan file-nya bisa dibuka atau
korup, jujur atau ngarang: (1) kolom kosong itu keputusan desain,
bukan kemalasan; (2) quoting CSV itu spec, bukan "tambah kutip kalau
kelihatan perlu"; (3) bytes XLSX cuma bisa lahir di satu konteks.

## Di mana model itu jebol: nol adalah klaim

Masalah pertama muncul pas mapping kolom counts. Model punya default
`metrics = {replies: 0, reposts: 0, likes: 0, views: 0}` — angka nol
yang lahir dari "tidak terbaca", bukan dari "terbaca nol". Buat kolom
Reply/Retweet/Favorite/View, nol diterusin (konsisten sama default
model). Tapi Quote Count dan Bookmark Count tidak ada di model SAMA
SEKALI — nggak ada default, nggak ada sumber DOM.

Godaan obvious: isi 0 juga, biar rapi kayak contoh (contohnya isi 0).
Tapi 0 di kolom counts dibaca manusia sebagai fakta ("tweet ini tidak
pernah di-quote") — padahal faktanya "kita tidak tahu". Kosong (`""`)
dibaca sebagai ketidaktahuan, yang bener. Jadi aturannya:

```text
terbaca (dari DOM/API)     → nilainya, termasuk 0 beneran
tidak terbaca + ada default → default model (0), didokumentasikan
tidak terbaca + tanpa default → "" (kosong = tidak tahu)
```

Aturan yang sama berlaku ke 17 kolom user (cuma avatar yang dari DOM),
kolom relasi viewer (Favorited/Retweeted/Bookmarked — relasi *lu*
dengan tweet, bukan properti tweet), dan Language. Total 23 kolom
kosong yang disengaja, semuanya dicatat di `docs/export-columns.md`
per kolom. Dokumen itu bukan permintaan maaf — itu kontrak keterbacaan:
konsumen file bisa bedain "nol" dari "tidak tahu" tanpa tebak-tebakan.

Jembatan ke pertanyaan berikutnya: kalau prinsipnya seketat itu,
gimana ceritanya kolom Hashtags/Mentions/URLs terisi padahal DOM juga
nggak nyediain entities?

## Derivasi jujur: di tengah antara baca dan karang

Ada opsi ketiga selain "baca dari sumber" dan "kosongkan": *derivasi
dari data yang dimiliki*. Teks tweet ada di tangan; hashtag, mention,
dan URL bisa diekstrak pakai regex — deterministik, verifiable,
nggak nambah informasi di luar teks. Itu beda kategoris dari ngarang
angka followers: derivasi bisa dicek siapa aja dari teksnya, karangan
nggak bisa dicek dari mana-mana.

Makanya kolom entities terisi (derivasi) sementara kolom counts/user
kosong (tidak terderivasi). Garisnya: **hasil harus bisa direproduksi
pihak ketiga dari artefak yang sama**. Regex di atas teks memenuhi;
tebakan angka tidak.

Satu nuansa yang dicatat jujur di code: regex `\w` itu ASCII-sentris
(hashtag CJK/emoji lolos dari pantauan). Batasan implementasi, bukan
prinsip — ditulis biar kelak ada yang benerin dengan sadar.

## Mekanisme yang bener: quoting itu spec, bukan firasat

CSV kelihatan sepele sampai tweet-nya berisi koma, kutip, newline, dan
emoji — alias hampir semua tweet panjang. Aturan RFC 4180 presisi dan
kecil: field berisi koma/quote/newline wajib dikutip; kutip di dalam
di-escape jadi kutip ganda; baris dipisah CRLF; tiap baris jumlah field
sama.[^rfc4180] Implementasinya 3 baris (`quoteCsv`), dan test-nya
pakai tweet yang sengaja jahat (`Hello, "world" — ...`). Pelajaran
umum: format "sederhana" justru yang paling harus dibaca spec-nya,
karena tidak ada library yang menutupi — kita nulis quoting sendiri.

XLSX adalah cerita beda: format biner (Office Open XML) yang tidak
masuk akal ditulis tangan, jadi pakai SheetJS Community Edition via
file vendor lokal 881KB (`xlsx.full.min.js`, sesuai aturan tanpa CDN).
Pola pakainya kanonik menurut docs-nya: `book_new` → `aoa_to_sheet`
→ `book_append_sheet` → `write` base64.[^sheetjs-api][^sheetjs-standalone]
Satu keputusan desain yang penting: CSV dan XLSX consume SATU sumber
(`snapshotToRows` — header + array per tweet), jadi "kolom geser di
Excel tapi bener di CSV" mustahil secara konstruksi. Test header
mengunci 1:1 lawan header file contoh (43, diekstrak programatik dari
`.xlsx` asli ke fixture — bukan disalin tangan).

Dan karena bytes XLSX cuma bisa dibuat di page context (pola yang sama
kayak JSZip di dokumen [004](./004-kenapa-download-video-bukan-satu-masalah.md)),
alirannya ikut pola BUILD_ZIP: background kirim `{columns, rows}`,
content rakit bytes, round-trip dibuktiin baca-balik di E2E.

★ Insight ─────────────────────────────────────
- Kosong, nol, dan derivasi adalah tiga pernyataan epistemik berbeda:
  "tidak tahu", "tahu nilainya nol", "bisa dihitung dari yang ada".
  Spreadsheet yang baik membedakannya; spreadsheet yang malas
  menyamakan semua jadi 0.
- Format teks "sepele" (CSV) menuntut spec reading; format biner
  (XLSX) menuntut vendor lokal + round-trip proof. Keduanya murah
  kalau dikerjain di awal, mahal kalau jadi bug kompatibilitas.
- Satu sumber baris untuk dua format = satu kelas inkonsistensi
  yang hilang permanen.
─────────────────────────────────────────────────

## Kasus yang nggak kejawab jalur normal: kolom yang kemudian terisi

Desain kosong-jujur terbayar lunas di Task 7: respons API ternyata
menyediakan quote/bookmark counts, language, viewer flags, dan 12
kolom user (followers, bio, location, banner, verified...). Karena
kontraknya "kolom X diisi kalau sumber Y ada", pengisiannya mekanis:
tambah field ke model → petakan di grup kolom → perbarui
`export-columns.md`. Tidak ada refactor bentuk, tidak ada debat ulang
"boleh nggak diisi" — keputusannya sudah dibuat di Task 6, Task 7
tinggal mengeksekusi.

Dua kolom yang TETAP kosong sampai hari ini (`User Favourites Count`,
`User Listed Count`) adalah buktinya prinsipnya jalan dua arah: tidak
ada di API maupun DOM → tetap kosong, tetap didokumentasikan. Kalau
suatu hari sumbernya muncul, jalurnya sudah ada.

## Model mental yang lebih kuat

Ganti "isi yang ada, kosongin sisanya" dengan:

```text
setiap sel = nilai + status pengetahuan (tahu / tidak tahu / terderivasi)
kosong = tidak tahu (diformalkan, didokumentasikan per kolom)
0 = tahu nilainya nol (hanya dari sumber/default yang eksplisit)
derivasi = boleh kalau reproduksibel dari artefak yang sama
```

Tes model ini ke pertanyaan praktis:

- *"Kolom Quote Count 0 atau kosong?"* — Kosong kalau DOM-only
  (tidak ada sumber), angka kalau API merge jalan. Keduanya bener
  di konteksnya; yang salah cuma 0 tanpa sumber.
- *"Kenapa hashtag keisi tapi language kosong?"* — Hashtag terderivasi
  dari teks (reproduksibel), language butuh deteksi/API (tidak ada).
  Beda kategori, beda perlakuan — by design.
- *"CSV rusak di Excel padahal di text editor bener?"* — Cek quoting:
  koma/quote/newline tanpa kutip = kolom geser. RFC 4180, bukan selera.
- *"Mau tambah kolom baru?"* — Tambah ke `THREAD_COLUMNS` + grup
  mapping + `export-columns.md`. Test header 1:1 bakal teriak kalau
  urutannya geser.

## Pertanyaan terbuka

- Regex entities ASCII-sentris: seberapa besar miss rate hashtag
  non-Latin di thread nyata, dan layak diganti segmentasi Unicode?
- `User Favourites Count` / `User Listed Count`: adakah endpoint yang
  menyediakannya, atau memang tidak diekspos ke klien sama sekali?
- CSV kita CRLF per RFC; Sheets/Excel di macOS/Windows oke. Adakah
  konsumen (impor database?) yang butuh LF atau BOM? Belum ada laporan.

## Referensi

[^rfc4180]: Y. Shafranovich, “Common Format and MIME Type for
  Comma-Separated Values (CSV) Files,” RFC 4180, Informational,
  Oktober 2005, diakses 2026-09-09. Quoting, CRLF, header, ABNF.
  https://www.rfc-editor.org/info/rfc4180
[^sheetjs-api]: SheetJS, “Arrays of Data” (API Reference, Community
  Edition), diakses 2026-09-09. `aoa_to_sheet`, `book_new`,
  `book_append_sheet`, `write`.
  https://docs.sheetjs.com/docs/api/utilities/array
[^sheetjs-standalone]: SheetJS, “Standalone Browser Scripts,” diakses
  2026-09-09. `xlsx.full.min.js` sebagai script standalone lengkap.
  https://docs.sheetjs.com/docs/getting-started/installation/standalone
