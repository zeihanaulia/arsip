---
title: "Kenapa Scroll Sampai Habis Tidak Pernah Selesai"
created: 2026-09-07
updated: 2026-09-07
status: draft
tags:
  - chrome-extension
  - manifest-v3
  - infinite-scroll
  - testing
sources:
  - https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API
  - https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
  - https://developer.chrome.com/docs/extensions/develop/concepts/messaging
---

# Kenapa Scroll Sampai Habis Tidak Pernah Selesai

> E2E headed hijau: klik tombol, 1 tweet jadi 2. Browser beneran:
> 16 tweet dari 292 replies. Code yang sama, completeness 8%.
> Kok bisa?

Dokumen ini ngebahas tiga pertanyaan yang nyambung:

1. Apa yang fundamental beda antara "scroll" di fixture dan "scroll"
   di thread X nyata?
2. Kenapa arsitektur request-response Task 2 yang rapi harus dirombak
   jadi state machine async di Task 3?
3. Gimana caranya ngaku "lengkap" dengan jujur kalau sumbernya males
   ngasih data?

Dokumen pendamping: [001](./001-chrome-extension-bukan-webapp-biasa.md)
(peta konteks) dan
[002](./002-kenapa-test-hijau-browser-merah.md) (logic × konteks ×
channel). Dokumen ini soal sumbu keempat yang baru muncul di Task 3:
**waktu**.

## Model awal yang kelihatan bener

Intuisi Task 3 di atas kertas sederhana banget:

```text
selama masih ada yang bisa di-load:
    klik "show more"
    scroll ke bawah
    tunggu sebentar
    scrape lagi
```

Kayak user yang sabar: scroll, tunggu, scroll, tunggu, sampai mentok.
Bedanya sama user cuma kecepatan dan konsistensi — mesin nggak capek,
nggak ke-skip. Model ini yang diimplementasi di `src/scroller.js`, dan
di fixture dia sempurna: 1 tweet jadi 2, tombol kepencet tepat sekali,
berhenti dengan alasan jelas.

Model ini adil sebagai titik mulai. Dan dia bener menjelaskan mekanisme
*aksi*-nya: klik, scroll, tunggu, hitung. Yang nggak dijelasin model ini
adalah mekanisme *reaksi*-nya — apa yang terjadi di sisi halaman antara
"gue scroll" dan "data nambah". Di fixture, reaksinya sinkron dan
instan (append langsung di click handler). Di X, reaksinya adalah sistem
malas yang punya jadwal sendiri. Seluruh gap 16-vs-292 tinggal di situ.

## Di mana model itu jebol: halaman yang males

Pola standar infinite scroll di web modern begini: satu elemen
"sentinel" ditaruh di ujung list, dan browser ngawasin kapan sentinel
itu masuk viewport pakai IntersectionObserver. Begitu berpotongan,
callback jalan: fetch chunk berikutnya, render, append, pasang sentinel
baru. MDN nyatet infinite scroll sebagai salah satu use case utama API
ini — makin banyak konten di-load dan di-render seiring scroll, supaya
user nggak perlu ganti halaman.[^intersection-observer]

Rantai ini penting karena tiap sambungannya punya timing tak tentu:
observasi sentinel (async, dihitung browser di luar main thread),
fetch network (latency), render + virtualisasi (X me-recycle DOM biar
list 292 item nggak bikin browser ngos-ngosan — ini inferensi dari
perilaku teramati, bukan klaim soal source code X). "Scroll lalu tunggu
800ms" menebak-nebak seluruh rantai itu selesai dalam 800ms. Kadang
bener. Kadang chunk-nya baru datang di milidetik ke-900 — dan scroller
udah nyatet "batch ini nambah nol".

Dua batch nol berturut-turut, scroller nyimpulin "habis" dan berhenti
dengan percaya diri. Inilah yang kemungkinan terjadi di thread nyata:
bukan kehabisan data, tapi kehabisan kesabaran. Stop condition kita
nggak bisa bedain "server nggak punya lagi" dari "server belum jawab".
Keduanya kelihatan sama: hen­ing.

★ Insight ─────────────────────────────────────
- Fixture: aksi → reaksi instan. Uji yang jalan cuma logika loop.
- X nyata: aksi → antrean async (observe → fetch → render).
  Yang diuji harusnya *negosiasi timing*, bukan cuma loop.
- "Berhenti karena sepi" selalu ambigu: sepi bisa berarti habis,
  bisa berarti telat. Stop condition yang nggak nyatet alasannya
  bikin kegagalan nggak terdiagnosis.
─────────────────────────────────────────────────

## Masalah aslinya: dokumen yang dibaca ternyata bukan dokumen

Mundur selangkah dan perhatiin asumsi paling dasarnya: scraper Task 2
ngasumsikan thread adalah *dokumen* — barang statis yang isinya tinggal
dibaca. Task 3 ngebuktiin asumsinya salah. Thread X adalah *sistem
malas*: sebagian isinya belum ada (belum di-fetch), sebagian yang udah
ada bisa hilang lagi (di-recycle virtualizer), dan urutannya pun bukan
kronologis (mode "Relevant" nyusun ulang). Kita nggak baca dokumen —
kita negosiasi sama sistem yang pelit.

Negosiasi butuh tiga hal yang dokumen statis nggak butuh: **pemicu**
yang bener (scroll container yang tepat + klik affordance yang tepat),
**kesabaran** yang cukup (settle time + jumlah batch sepi sebelum
menyerah), dan **observabilitas** (setiap berhenti wajib bawa alasan:
`idle`, `max-batches`, `max-tweets`, `cancelled`). `ScrollStats` di code
kita sebenarnya instrumen negosiasi, bukan sekadar counter — dan
pelajaran pahitnya: instrumen yang nggak ditampilin di popup sama aja
bohong. Pas hasil 16/292 keluar, kita nggak bisa jawab "berhenti karena
apa" karena `stoppedWhy` mati di console yang nggak dibuka.

Jembatan ke pertanyaan berikutnya: kalau capture butuh waktu lama dan
kondisinya flaky, arsitektur request-response Task 2 (kirim → tunggu
jawaban) masih muat?

## Pergeseran desainnya: dari telepon ke papan pengumuman

Task 2 itu telepon: popup nelpon background, background nelpon tab,
jawaban mengalir balik di channel yang sama. Cocok buat kerjaan
detik-an. Task 3 itu kerjaan menit-an di tiga konteks yang bisa mati
kapan aja — dan di sinilah lifecycle service worker masuk sebagai
penentu desain.

Dokumentasi Chrome-nya eksplisit: worker dimatikan setelah 30 detik idle
(event/API call nge-reset timer), request tunggal yang lebih dari
5 menit dipenggal, dan variabel global hilang pas worker tidur — simpan
state ke storage, bukan memori.[^sw-lifecycle] Artinya "await satu
promise panjang" adalah desain yang rapuh: janji yang dipegang worker
bisa mati bareng worker-nya.

Makanya Task 3 ngubah pola komunikasi dari telepon jadi papan
pengumuman: START langsung di-ack ("oke, jalan"), content nempel
laporan PROGRESS ke papan (cache di background), popup ngecek papan
tiap 600ms (STATUS poll), hasil akhir ditunggu di papan sampai
diambil. Nggak ada yang nungguin janji orang lain. Kalau worker sempat
tidur dan bangun lagi, papan-nya (paling jelek) basi — tapi popup punya
timeout sendiri 10 menit sebagai pertahanan terakhir, jadi nggak ada
spinner abadi jilid dua.

Alternatifnya — koneksi awet `runtime.connect`/`Port` — dipertimbangin
dan ditolak buat sekarang: Port juga mati kalau worker tidur, jadi dia
nggak nyelesaiin masalah lifecycle, cuma mindahin represen­tasi
masalahnya. Polling lebih bodoh tapi jujur soal ketidaktahuannya: "gue
nggak tahu kabar terbaru, gue cek lagi nanti". Buat progress
satu-arah yang boleh basi, itu trade-off yang tepat.

Satu konsekuensi yang ngikut: Cancel jadi kooperatif, bukan preemptif.
Nggak ada cara ngebunuh loop yang lagi `await sleep` dari luar konteks
— jadi CANCEL cuma ngeset flag yang dicek antar batch. Cancel yang
"instant" itu ilusi di arsitektur pesan; yang ada cuma "berhenti di
checkpoint berikutnya". Desain `shouldStop` hook lahir dari keterbatasan
ini, bukan dari selera.

## Jalan-jalan konkret: satu batch expandAndScroll

Biar mekanismenya nempel, ikutin satu iterasi loop di tab:

1. **Cek bendera cancel.** Kalau user mencet Cancel, `shouldStop()`
   true → `stoppedWhy: "cancelled"`, keluar. Checkpoint kooperatif.
2. **Klik semua tombol expand** yang ketemu (`findExpandButtons`:
   match teks "show more"/"show this thread" — dipilih teks karena
   X sering ganti styling tapi jarang ganti kata affordance-nya;
   ini tebakan taktis yang dicatat, bukan kebenaran abadi).
3. **Scroll sekali** (`scrollOnce`: `scrollTop = scrollHeight` di
   `scrollingElement`, fallback body). Di sinilah kumungkinan miss:
   kalau X dengerin scroll di container dalam, scroll dokumen nggak
   nge-trigger sentinel — hipotesis utama kenapa chunk berhenti.
4. **Tidur `batchDelayMs`** (default 800ms) — jendela kesabaran per
   batch, parameter yang paling menentukan completeness.
5. **Hitung ulang.** Nambah → reset counter sepi, lapor progress
   (fire-and-forget ke background; gagal diam-diam nggak apa karena
   jawaban akhir lewat channel utama). Nggak nambah → counter sepi +1;
   di angka 2, nyerah dengan `stoppedWhy: "idle"`.

Setiap angka di atas (800ms, 2 batch sepi, 40 batch, 300 tweet) adalah
tebakan kalibrasi, bukan turunan teori. Code-nya jujur soal itu: semua
jadi parameter `ExpandOptions`, bukan konstanta tersebar. Kalibrasi
berikutnya (naikin jeda, sabar 4-5 batch sepi, scroll container dalam)
nggak butuh ubah struktur — cuma angka dan satu fungsi `scrollOnce`.

## Kasus yang nggak kejawab jalur normal: relasi yang nggak ada di DOM

Task 3 juga ditagih "reply-tree": siapa-reply-siapa. Masalahnya, DOM
viewport X nggak nyimpen info parent — nggak ada `in_reply_to` yang bisa
diintip dari isolated world. Pilihannya dua: ngarang (isi `replyTo`
dengan tebakan posisi) atau ngaku (isi yang pasti, tandai sisanya).

`assignThreadRelations` milih ngaku, dengan aturan tiga tingkat:

- `conversationId` selalu keisi: dari id di URL thread, fallback id
  tweet pertama kalau URL-nya bukan thread (mis. `/home`).
- `replyTo` cuma diisi kalau adapter beneran tahu (hari ini: nggak
  pernah) — selain itu null.
- `inferred`: false hanya buat tweet yang id-nya sama persis dengan
  id di URL (root yang pasti); true buat sisanya, termasuk semua hasil
  fallback.

Bukti di data nyata: 16/16 `conversationId` keisi, 16/16 `inferred:
true`, `replyTo` null semua. Kelihatannya kayak "fitur mati", padahal
itu kontrak kejujuran yang disengaja: posisi DOM bukan parenthood, dan
exporter Task 5 dilarang mengira begitu. Pohon reply beneran — kalau
nanti dibutuhkan — butuh sumber yang hari ini nggak ada di DOM, dan
dokumen ini nyatet kekurangan itu sebagai batas, bukan sebagai TODO
yang pura-pura gampang.

## Model mental yang lebih kuat

Ganti "scroll sampai habis" dengan:

```text
capture = negosiasi dengan sistem malas
completeness = pemicu_tepat × kesabaran × stop_condition_observabel
```

- **Pemicu tepat**: scroll container yang bener + klik affordance yang
  bener. Salah satu miss, chunk nggak datang seberapa pun sabarnya.
- **Kesabaran**: settle time dan ambang sepi harus dikalibrasi ke timing
  chunk nyata, bukan angka enak. 800ms/2-batch itu draf pertama.
- **Stop observabel**: setiap berhenti wajib bawa alasan. Stop tanpa
  alasan = bug yang nggak bisa di-debug (pelajaran 16/292).

Tes model ini ke pertanyaan praktis:

- *"Udah scroll 40 batch kok cuma 16?"* — Cek `stoppedWhy` dulu. `idle`
  di batch awal + jeda pendek = kepagian, bukan kehabisan. Naikin jeda
  dan ambang sepi sebelum nuduh X.
- *"Kenapa scroll dokumen nggak nambah apa-apa?"* — Cari tahu siapa
  yang dengerin scroll: dokumen atau container dalam (virtualizer)?
  Sentinel IntersectionObserver nempel di root scroll yang mana?
- *"Progress di popup macet?"* — Polling boleh basi; itu desain. Yang
  penting timeout keseluruhan tetap jalan dan Cancel tetap ngefek di
  checkpoint berikutnya.
- *"replyTo null semua — scraper-nya rusak?"* — Bukan. Itu kontrak:
  nggak ada info parent di DOM, jadi null + `inferred: true`. Yang
  rusak itu ekspektasi bahwa posisi = parenthood.

## Pertanyaan terbuka

- Kalibrasi Task 3 (jeda 800ms, sepi 2 batch, scroll dokumen) vs data
  16/292: tuning berikutnya mengarah ke scroll container dalam +
  `stoppedWhy` tampil di popup. Seberapa jauh completeness bisa didorong
  sebelum mentok login wall / rate limit X?
- Polling STATUS tiap 600ms selama job menit-an: boros tapi simpel.
  Di titik mana (ukuran job? jumlah konteks?) `runtime.connect` Port
  jadi layak dipertimbangkan ulang?
- Kalau pohon reply beneran dibutuhkan Task 5, dari mana parenthood
  diambil kalau DOM nggak nyediain? (URL `/status` per tweet? Pola
  "in reply to" di teks? Atau terima flat + urutan DOM sebagai
  presentasi final?)

## Referensi

[^intersection-observer]: MDN Web Docs, “Intersection Observer API,”
  diakses 2026-09-07. Infinite scroll sebagai use case utama: makin
  banyak konten di-load dan di-render seiring scroll; deteksi via
  persimpangan sentinel dengan viewport.
  https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API
[^sw-lifecycle]: Google Chrome Developers, “The extension service
  worker lifecycle,” 2023-05-02, diakses 2026-09-07 (diverifikasi
  langsung). Terminasi setelah 30 detik idle, request tunggal >5 menit
  dipenggal, variabel global hilang — simpan ke storage.
  https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
[^messaging]: Google Chrome Developers, “Message passing,” diakses
  2026-09-07. Dipakai untuk pola `runtime.connect`/Port sebagai
  alternatif polling yang dipertimbangkan.
  https://developer.chrome.com/docs/extensions/develop/concepts/messaging
