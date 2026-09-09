---
title: "Kenapa yang Kesimpen Cuma Sisa Terakhir"
created: 2026-09-09
updated: 2026-09-09
status: draft
tags:
  - chrome-extension
  - virtualization
  - completeness
  - observability
sources:
  - https://web.dev/articles/virtualize-long-lists-react-window
  - https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API
  - https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
---

# Kenapa yang Kesimpen Cuma Sisa Terakhir

> Klaim X: 530 replies. Tangkapan kita: 28. Scroller jalan 23 batch,
> berhenti "idle", nggak ada error. Scroll manual di halaman yang sama:
> ratusan reply ke-render. Jadi yang rusak bukan kesabaran, bukan
> target scroll — melainkan asumsi paling dasar: bahwa yang ada di DOM
> adalah akumulasi dari yang sudah lewat.

Dokumen ini ngebahas tiga pertanyaan yang nyambung:

1. Kenapa scraper yang tiap batch-nya bener bisa ngasilin total yang salah?
2. Kenapa DOM tidak bisa diperlakukan sebagai akumulasi, dan apa penggantinya?
3. Gimana cara debug sistem malas tanpa nebak — sampai 28 jadi 396?

Dokumen pendamping: [003](./003-kenapa-scroll-sampai-habis-tidak-pernah-selesai.md)
(thread sebagai sistem malas + negosiasi timing). Dokumen ini kelanjutan
langsungnya: apa yang terjadi SETELAH negosiasi timing beres tapi
hasilnya tetap salah — dan kenapa jawabannya ada di arsitektur render,
bukan di kecepatan scroll.

## Model awal yang kelihatan bener

Sampai titik ini model kerjanya konsisten dan lolos semua test:

```text
tiap batch: klik show-more → scroll → tunggu → hitung
di akhir: scrape DOM sekali → snapshot → ZIP
```

Fixture-fotonya sempurna: tombol diklik, tweet nambah 1→2, berhenti
idle dengan alasan jelas. E2E headed hijau. Di thread nyata, 23 batch
jalan, berhenti idle. Semua instrumen bilang normal. Hasil: 28 dari 530.

Intuisinya: kalau tiap langkah bener, total pasti bener. Yang nggak
kelihatan dari dalam loop adalah asumsi yang nempel di baris paling
akhir: bahwa scrape-DOM-terakhir = union dari semua yang pernah lewat.
Asumsi itu bener di fixture (elemen cuma nambah). Di X, asumsi itu salah
secara struktural.

## Di mana model itu jebol: jendela geser, bukan tumpukan

List virtualization — alias windowing — adalah teknik render sebagian:
yang hidup di DOM cuma jendela kecil di sekitar viewport plus buffer,
dan node yang keluar jendela di-recycle (dibuang atau dipakai ulang
buat item baru) begitu user scroll.[^virtualize] Scrollbar tetap
kelihatan penuh, tapi itu ilusi: 530 baris data, ~28 node DOM.

Begitu ini dipahami, 28 bukan lagi angka misterius — itu ukuran
jendela (± overscan) di momen scrape terakhir. Dan "scrape terakhir"
adalah operasi yang salah secara definisi: dia motret SATU posisi
jendela, sementara 23 batch sebelumnya masing-masing motret posisi
berbeda yang node-nya sudah dibuang. Kita nggak kehilangan data karena
gagal load; kita kehilangan data karena menimpa hasil sendiri.

Bukti yang ngunci: kurva `history` per batch dari file nyata —
`[18, 14, 12, 22, 11, 30, 26, 24, 22, 40, ...]` — naik-turun liar.
Kalau datanya akumulasi, kurva cuma bisa naik. Kurva yang turun adalah
tanda tangan virtualizer: ini jendela geser, bukan tumpukan.

★ Insight ─────────────────────────────────────
- Fixture lama: DOM = tumpukan (append-only). Test hijau ngebuktiin
  loop, bukan asumsi.
- X nyata: DOM = jendela geser. Yang keluar jendela hilang dari DOM.
- "Ambil yang ada di DOM di akhir" = "ambil sisa terakhir".
  Satu-satunya obat: union sendiri, karena halaman nggak nyimpen.
─────────────────────────────────────────────────

## Masalah aslinya: dua sumber, dua-duanya parsial

Begitu DOM ketahuan cuma jendela, muncul pertanyaan lanjutan: kalau
begitu dari mana seluruhnya? Jawabannya ada dua sumber yang
masing-masing parsial dengan cara beda:

- **DOM antar-waktu**: lengkap kalau di-union (tiap batch dicatat,
  first-seen menang), tapi tetap dibatasi apa yang pernah ke-render.
  Reply yang tidak pernah masuk viewport + overscan tidak pernah ada
  di DOM sama sekali.
- **Respons API (TweetDetail)**: lengkap per halaman (root + belasan
  reply per request, 11 request ≈ ratusan tweet), tapi paginasi milik
  X — kita cuma dapat halaman yang X mau fetch selama sesi.

Tidak ada satu sumber yang "datanya". Desain yang bener: union dari
keduanya, dedup by id. DOM memberi urutan lihat dan apa yang tampil;
API memberi yang tidak tampil plus counts/user/media asli. Merge yang
cuma "memperkaya tweet DOM" (desain awal kita!) diam-diam membuang
seluruh tweet API-only — bug yang baru kelihatan pas screenshot network
user nunjukin 11 TweetDetail berjejer sementara snapshot cuma 28.

Jembatan ke pertanyaan berikutnya: union dua sumber menyelesaikan
*isi*. Tapi sesi debug ini juga ngelahirin tiga bug *laporan* yang
hampir mengubur temuan utamanya. Kenapa instrumennya ikut rusak?

## Tiga bug laporan yang hampir menutupi bug isi

Bug isi di atas hampir nggak ketemu karena tiga bug observabilitas
menutupi jejaknya — dan ketiganya sejenis: **laporan yang menimpa,
bukan menumpuk.**

Pertama, `lastProgress` di-replace per pesan, bukan di-merge. Post fase
`mounting` (`{phase}` doang) menimpa `batches`/`stoppedWhy` hasil
expand — file bilang `viewport-only, batches: 0` padahal 23 batch
jalan kelihatan mata. Ditemukan bukan pas nulis code, tapi pas review
adversarial (Codex, cross-model) diminta "cari yang salah": dari 12
jalur yang diajukan, satu kelas (cache overwrite) dicek lawan code
asli dan ketemu instansinya baris per baris. Pelajarannya ganda:
reviewer bisa salah juga (satu temuannya berasal dari typo di prompt
kita sendiri — reconcile itu wajib, bukan opsional), tapi kelas
serangannya bener.

Kedua, `captureStats` menumbuhkan field opsional satu-satu sampai
complexity-nya jebol (16/15) — sinyal bahwa "tambah field" bukan desain
melainkan tambalan. Diekstrak jadi satu kebijakan `applyOptionalProvenance`:
satu tempat mendefinisikan apa itu "opsional tapi dipertahankan".

Ketiga, counter popup nunjukin snapshot terakhir (ikut turun pas
recycle), bukan max yang pernah terlihat. Angka yang turun bikin user
panik sia-sia; angka monoton bikin tenang beneran.

Pola umumnya: setiap tempat yang menimpa di sistem yang datanya
bergerak adalah calon bug laporan. Union bukan cuma buat tweet —
buat angka juga.

## Jalan-jalan konkret: 28 → 396

Biar mekanismenya nempel, ikutin satu run pasca-fix di thread Theo:

1. Batch berjalan, tiap batch union ke `Map` (first-seen menang) —
   bukan cuma hitung. E2E recycle (tweet lama dihapus pas tweet baru
   datang) ngebuktiin: sebelum fix 1 kesimpen, sesudah fix 2-2nya.
2. Tiap batch scroll SEMUA ancestor scrollable bertahap (bukan satu
   container, bukan teleport) — targetnya dicatat (`DIV.css-g5y9jx,...`).
3. Respons API (11 TweetDetail) di-parse, di-dedup lintas body,
   di-merge enrich + append: 152 tweet API-only masuk.
4. `capture` nyatet semuanya: `batches`, `history`, `scrollTarget`,
   `apiBodies`, `apiAdded`, `caps`, `phase`.
5. Hasil: 396 tweet, 0 duplikat, root ikut, 32 media (4 mp4 beneran).

Sisa 396-vs-530: tombol "Show probable spam", subset Relevant, tweet
dihapus — plafon X-nya, dan historinya datar di ujung (berhenti
legitim), bukan kepotong. Bedain "berhenti bener" dari "berhenti bug"
akhirnya bisa dibaca dari file, bukan dari keyakinan.

## Model mental yang lebih kuat

Ganti "scrape DOM terakhir" dengan:

```text
hasil = union(DOM antar-waktu, halaman API) dedup by id
DOM = jendela geser (bukan dataset)
API = halaman milik server (bukan milik kita)
capture = flight recorder (bukan pajangan)
```

- **Jendela geser**: jangan pernah baca posisi terakhir sebagai total.
  Union sendiri sejak batch pertama (termasuk viewport awal!).
- **Halaman server**: ambil semua halaman yang lewat (cap longgar,
  dedup lintas body), append yang tidak ada di DOM.
- **Flight recorder**: tiap run harus bisa jawab "kenapa berhenti,
  apa yang digerakin, apa yang kebawa" TANPA buka DevTools. Kalau satu
  pertanyaan butuh tebakan, tambahin satu field — kayak `history`,
  `scrollTarget`, `apiAdded` yang lahir tepat dari momen buntu.
- **Laporan monoton**: angka yang tampil ke manusia jangan ikut turun
  sama daur recycle. Max-so-far buat counter, union buat data.

Tes model ini ke pertanyaan praktis:

- *"Count 28 padahal batch 23 — loop-nya rusak?"* — Lihat `history`.
  Naik-turun liar = virtualisasi + union belum ada (atau belum
  reload). Datar = X tidak ngasih (sabar tidak membantu).
- *"Kok stopped-nya viewport-only padahal autoscroll ON?"* — Lihat
  `phase` + `expandError` + `caps`. Tiga field itu menunjuk tiga
  tersangka berbeda (ditimpa / throw / tab basi).
- *"API bodies ada tapi count tetap?"* — Lihat `apiAdded` vs
  `apiBodies`. Bodies tanpa additions = id tidak cocok (percakapan
  beda!) atau parse gagal — dua sebab yang penanganannya beda jauh.
- *"Thread baru kecampur thread lama?"* — Itu bug buffer lain
  (consume-then-clear), tapi pola diagnosisnya sama: curigai state
  yang hidup lebih lama dari satu run.

## Pertanyaan terbuka

- Union first-seen-menang itu bener buat teks (stabil), tapi kalau X
  mengedit tweet mid-scroll, kita simpen versi basi. Butuh
  last-write-wins per field, atau overkill?
- 396-vs-530: "Show probable spam" + subset Relevant + hapusan.
  Apakah sort Latest + scroll ulang menutup sebagian? Butuh run
  terkontrol, bukan asumsi.
- `maxBatches` 40 / `maxTweets` 300: dengan union, run panjang makin
  aman (data tidak hilang), tapi memori + waktu naik. Kapan cap-nya
  jadi interaktif (tanya user) alih-alih konstanta?

## Referensi

[^virtualize]: Jason Miller & Houssein Djirdeh, “Virtualize large
  lists with react-window,” web.dev, 2019-04-29, diakses 2026-09-09.
  Virtualisasi ("windowing"): hanya yang terlihat (+ buffer) yang
  di-render; node yang keluar jendela di-recycle/diganti elemen baru
  saat scroll.
  https://web.dev/articles/virtualize-long-lists-react-window
[^intersection-observer]: MDN Web Docs, “Intersection Observer API,”
  diakses 2026-09-07. Pola sentinel untuk infinite scroll.
  https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API
[^sw-lifecycle]: Google Chrome Developers, “The extension service
  worker lifecycle,” 2023-05-02, diakses 2026-09-07. Terminasi 30
  detik idle; state modul tidak awet.
  https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
