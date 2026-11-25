# Implementation Plan: X Thread Downloader (Chrome Extension MV3)

> Terakhir diperbarui: 2026-11-25
> Revisions Log: lihat bagian "Revisions Log" di akhir dokumen.

## Overview

Bangun extension Chrome MV3 DOM-only (tanpa API key / backend) yang dari tab X aktif mengambil tweet utama + semua comments/replies yang ke-load, download media secara lokal, lalu export sekali klik ke HTML rapi (preset LLM), JSON, CSV, Excel — dengan opsi autoscroll on/off. V1 fokus X saja. Repo saat ini kosong, jadi mulai dari scaffold.

Sumber intent: `docs/intent/x-thread-downloader.md`. Referensi kolom Excel: file `XCommentsExporter_asidorenko__12_2026-09-07_15-47.xlsx` (43 kolom: Tweet Id, Full Text, Tweet Url, Media URLs, counts, user info, dst.).

## Architecture Decisions

- **MV3 + content script di tab aktif + service worker tipis + popup**: content script yang pegang DOM/scroll/download blob (hindari CORS/CSP issue di popup), service worker cuma orkestrasi + `chrome.downloads`, popup cuma UI picker. Rationale: constraint "murni dari halaman yang dibuka".
- **Kontrak data dulu (`Tweet` schema) sebelum exporter**: semua exporter (HTML/JSON/CSV/Excel) consume satu `ThreadSnapshot` yang sama, jadi perubahan selector DOM tidak merembet ke 4 exporter.
- **Media di-bundle sebagai ZIP (HTML + `media/` + data file)**: single-file hasil download = gampang upload ke ChatGPT dan dibuka offline. Rationale: intent "media di-download lokal".
- **Lib minimal, zero-build dulu**: vanilla JS + `JSZip` + `SheetJS (xlsx)` via vendor lokal (tanpa bundler di Task 1-6, build step baru kalau perlu di Task 8). Rationale: repo kosong, fail fast di logic scraping dulu bukan di toolchain.
- **Selector DOM diisolasi di satu modul adaptor (`x-adapter.js`) dengan fallback multi-selector**: DOM X berubah-ubah; satu file yang boleh brittle, sisanya stabil.
- **Substack = deteksi berbasis konten + inject on-demand (Phase 8)**: publication bisa memakai custom domain tak terbatas, jadi `detectAdapter(url)` yang host-based tidak cukup. Deteksi dari `preloads-json`/DOM, inject via `activeTab` + `chrome.scripting.executeScript`, komentar dari same-origin API. Detail dan konsekuensinya di Phase 8.

## Dependency Graph

```
ThreadSnapshot schema + message protocol (Task 1)
    │
    ├── DOM scraper minimal, viewport-only (Task 2)
    │       │
    │       ├── auto-expand + autoscroll + dedup/order/reply-tree (Task 3)
    │       │       │
    │       │       ├── media inventory + fetch blob + zip bundle (Task 4)
    │       │       │       │
    │       │       │       ├── HTML LLM-ready offline (Task 5)
    │       │       │       │
    │       │       │       └── CSV + Excel + JSON final (Task 6)
    │       │       │
    │       │       └── popup UI + progress + error (Task 7, perlu kontrak Task 1 + hasil Task 2-6)
    │       │
    │       └── QA hardening + packaging (Task 8, perlu semuanya)
```

Urutan implementasi bottom-up mengikuti graf di atas. Tiap task adalah vertical slice yang meninggalkan sistem dalam keadaan working.

## Task List

### Phase 0: Foundation + first working slice

## Task 1: Scaffold MV3 + kontrak data ThreadSnapshot

**Description:** Scaffold extension MV3 minimal (manifest, service worker, content script stub, popup stub) plus kontrak `ThreadSnapshot` / `Tweet` schema dan message protocol popup↔content yang dipakai semua task berikutnya.

**Acceptance criteria:**
- [x] `Load unpacked` di `chrome://extensions` sukses tanpa error/warning manifest
- [x] Ada `ThreadSnapshot` schema terdokumentasi (field wajib: id, text, url, createdAt, user{...}, media[], metrics{}, replyTo, conversationId) dan message protocol (`SCRAPE_START`, `SCRAPE_PROGRESS`, `SCRAPE_DONE`, `SCRAPE_ERROR`) dipakai konsisten
- [x] Popup stub bisa ping content script di tab x.com dan terima respons

**Verification:**
- [x] Load unpacked manual: extension muncul, klik popup tidak error console
- [x] Manual check: buka thread X apapun, popup stub tampil "connected: true"

**Dependencies:** None

**Files likely touched:**
- `manifest.json`
- `src/model.js` (schema + contoh fixture 2 tweet)
- `src/messaging.js` (protocol)
- `src/content.js` (stub)
- `src/popup.html`, `src/popup.js` (stub)

**Estimated scope:** Medium (3-5 files)

## Task 2: Scraper minimal + download JSON (viewport-only, tanpa autoscroll)

**Description:** Vertical slice E2E pertama: content script parse semua `article[data-testid="tweet"]` yang SUDAH ke-load di viewport menjadi `ThreadSnapshot`, kirim ke service worker, download sebagai 1 file `.json`. Tanpa autoscroll — ini baseline yang membuktikan path scrape→download jalan.

**Acceptance criteria:**
- [x] Di thread X nyata, klik Download → 1 file `.json` terdownload berisi array tweets (id, text, url, user, timestamp terisi, tidak kosong)
- [x] Tweet duplikat (DOM double-render) ter-dedup by id
- [x] Tidak butuh scroll: hanya klaim "visible/loaded tweets", tidak janji lengkap

**Verification:**
- [x] Manual check di 2 thread nyata (1 thread kecil <20 replies, 1 thread media): file JSON valid (`python3 -m json.tool`), jumlah tweet > 0, buka 3 tweet url acak valid
- [x] Console content script tanpa error fatal

**Dependencies:** Task 1

**Files likely touched:**
- `src/x-adapter.js` (selector tweet, parse user/text/url/timestamp)
- `src/content.js` (scrape + dedup)
- `src/background.js` (terima snapshot → `chrome.downloads.download`)

**Estimated scope:** Medium (3 files)

### Checkpoint: Foundation

- [x] Extension load unpacked bersih
- [x] Slice scrape→JSON download jalan di 2 thread nyata
- [x] Review dengan human sebelum lanjut (selector X rapuh — kunci pola selector sekarang atau revisi)

### Phase 1: Capture lengkap + media lokal

## Task 3: Auto-expand + autoscroll opsional + ordering + reply-tree

**Description:** Lengkapi capture: klik semua "Show more replies / Show more" yang ada, autoscroll bertahap sampai habis ATAU sampai user stop (opsi on/off dari popup), lalu dedup + urutkan + bangun `replyTo` / `conversationId` agar thread terbaca siapa-reply-siapa.

**Acceptance criteria:**
- [x] Dengan autoscroll ON di thread 50+ replies, jumlah tweet hasil > jumlah viewport-only (Task 2) dan tidak ada duplikat id
- [x] Dengan autoscroll OFF, perilaku identik Task 2 (tidak scroll sendiri)
- [x] Ada progress event ke popup (mis. `scraped: N tweets`) dan mekanisme stop (timeout / batas N / tombol cancel)
- [x] `replyTo` / `conversationId` terisi bila info ada di DOM/URL; bila tidak ada, fallback urutan DOM + penanda `inferred: true` (tidak ngarang id)

**Verification:**
- [x] Manual check di 1 thread panjang (50+ replies): bandingkan count ON vs OFF, cek tidak hang (stop < 60 dtk atau sampai habis)
- [x] Manual check cancel mid-scroll tidak merusak snapshot parsial (tetap bisa download)

**Dependencies:** Task 2

**Files likely touched:**
- `src/scroller.js` (baru: scroll loop + expand clicker + stop condition)
- `src/content.js` (orkestrasi scrape ulang per batch)
- `src/x-adapter.js` (expand-button selectors + replyTo parse)

**Estimated scope:** Medium (3 files)

## Task 3b: Tuning completeness + observabilitas + styling dasar popup

**Description:** Tindak lanjut observasi thread nyata (16/292): kalibrasi kesabaran scroller ke timing chunk X yang malas, tampilkan alasan berhenti di popup agar tiap percobaan bisa dibaca, dan kasih styling dasar ke popup yang sekarang mentah (slice awal Task 7, final UI tetap di Task 7).

**Acceptance criteria:**
- [x] Scroller tahan chunk lambat: fixture yang append setelah 2.5 dtk tetap ke-capture dengan default options (idle tolerance jadi parameter `maxIdleBatches`, default 4; `batchDelayMs` default 1500ms)
- [x] Status popup menampilkan alasan berhenti (`idle` / `max-batches` / `max-tweets` / `cancelled`) + jumlah batch, bukan cuma count
- [x] Popup punya styling dasar yang rapi: tombol full-width, spacing konsisten, status `role="status"`, label untuk checkbox, kontras cukup, keyboard-navigable (native elements + focus visible)
- [x] Tidak ada console error saat popup dibuka; wiring (download → polling → cancel) covered test UI

**Verification:**
- [x] E2E slow-fixture hijau (RED dulu lawan default lama)
- [x] UI test Playwright hijau (stub `chrome.*`, tidak ada console error)
- [x] Screenshot popup headed dicek manual
- [x] Manual check di thread nyata yang sama: count naik vs 16 + `stoppedWhy` terbaca

**Dependencies:** Task 3

**Files likely touched:**
- `src/scroller.js` (`maxIdleBatches`, defaults 1500ms/4)
- `src/content.js` (teruskan stats akhir), `src/background.js` (cache `stoppedWhy`)
- `src/popup.html`, `src/popup.css` (baru), `src/popup.js` (tampilkan alasan + wiring test)
- `tests/fixtures/thread-expand-slow.html` (baru), `tests/e2e.test.js`, `tests/popup-ui.test.js` (baru)

**Estimated scope:** Medium (4-5 files)

## Task 4: Media inventory + download lokal + bundle ZIP

**Description:** Dari snapshot, inventarisir media (images, GIF, video poster + varian terbaik yang bisa di-fetch sebagai blob), download via content script (agar ikut sesi/login tab), simpan sebagai `media/<tweetId>-<idx>.<ext>`, rewrite referensi ke path lokal, bundle jadi ZIP siap upload.

**Acceptance criteria:**
- [x] Di thread berisi foto, hasil ZIP berisi `media/` dengan file gambar yang bisa dibuka (bukan 0-byte / bukan HTML error page)
- [x] Manifest di ZIP (`media-manifest.json`) memetakan URL asli → path lokal + tipe
- [x] Video/GIF: minimal poster/thumbnail ter-download; bila varian mp4 langsung bisa di-fetch, ikut sertakan, bila tidak (mis. m3u8/HLS) catat di manifest sebagai `unresolved` + URL asli tetap disimpan (tidak silent-drop)
- [x] Nama file aman (sanitize, tanpa collision)

**Verification:**
- [x] Manual check di 1 thread foto + 1 thread video/GIF: unzip, buka tiap file media, cek manifest lengkap
- [x] Manual check offline: putus internet, file di ZIP tetap terbuka (untuk yang sudah ter-bundle)

**Dependencies:** Task 3

**Files likely touched:**
- `src/media.js` (baru: inventory + fetch blob + sanitize + manifest)
- `src/zip.js` (baru: bundling via JSZip vendor)
- `vendor/jszip.min.js` (baru)

**Estimated scope:** Medium (3-4 files)

## Task 4b: Opsi video terpisah + ekstraksi caption (LLM tidak makan video)

**Description:** Video itu besar dan LLM tidak bisa proses video — jadi bytes video jangan dipaksa masuk ZIP/upload. Kasih opsi di popup: video masuk ZIP vs download terpisah per-file vs cuma poster. Dan ambil caption/subtitle sebagai pengganti konten video buat konteks LLM (best-effort DOM-only: elemen `<track>` kalau ada; kalau tidak ada, catat `no-captions-in-dom` — URL subtitle X hidup di data API/JS internal, di luar jangkauan isolated world).

**Acceptance criteria:**
- [x] Opsi popup `videoMode`: `bundle` / `separate` (default — video itu berat dan LLM tidak memprosesnya) / `posters-only` (bytes video di-skip, poster + manifest tetap ada)
- [x] Caption: `<track src>` di-inventory + di-fetch jadi teks (mis. `media/<id>-cc.en.vtt` + teks bersih di `thread.md` Task 5); tanpa `<track>`, manifest catat alasan, bukan karangan
- [x] Status popup laporkan mode + ringkasan media (foto N, video bundled/separate/skipped, caption ada/tidak)

**Verification:**
- [x] E2E fixture: video + `<track>` → caption ke-fetch jadi teks; tanpa track → alasan tercatat
- [x] Manual check di thread video nyata (mis. tweet Theo yang ada CC): mode separate hasilkan file mp4 + ZIP tanpa video + caption kalau DOM menyediakannya

**Dependencies:** Task 4

**Files likely touched:**
- `src/x-adapter.js` (inventory `<track>`)
- `src/media.js` (fetch vtt + strip jadi teks)
- `src/content.js` / `src/background.js` (mode video, download terpisah)
- `src/popup.html`, `src/popup.js` (opsi mode)

**Estimated scope:** Medium (4-5 files)

### Checkpoint: Capture

- [x] Thread panjang + media ter-capture jadi ZIP parsial (JSON + media) end-to-end
- [x] Upload ZIP/JSON hasil ke ChatGPT manual: konteks thread kebaca (cek shows stopper sebelum bangun 3 exporter)
- [x] Review dengan human sebelum lanjut

### Phase 2: Exporters (semua consume ThreadSnapshot yang sama)

## Task 5: Exporter HTML rapi + teks LLM-ready (offline-first)

**Description:** Render `thread.html` yang rapi dibaca manusia DAN hemat token buat LLM: header thread, tweet urut (reply indent/tree), user + timestamp + metrics ringkas, teks penuh, media sebagai `<img>/<video>` ke path lokal `media/`, plus `thread.md`/`thread.txt` plain-text sebagai alternatif upload ringan.

**Acceptance criteria:**
- [x] Buka `thread.html` dari ZIP secara offline: teks lengkap terbaca, urutan reply jelas, gambar tampil dari `media/` lokal (tanpa internet)
- [x] Ada `thread.md` (atau `thread.txt`) satu file/$INLINE yang kalau di-upload ke ChatGPT, model bisa jawab "siapa bilang apa" tanpa missing mayor (tes 3 pertanyaan probe)
- [x] Escape HTML benar (tidak jebol layout kalau tweet berisi `<`, `&`, emoji, link); link asli tetap bisa diklik

**Verification:**
- [x] Manual check offline open `thread.html` di Chrome (cache disabled)
- [x] Manual check upload `thread.md` ke ChatGPT: 3 probe (ringkasan, siapa-reply-siapa, ada media apa) terjawab benar
- [x] Manual check 1 thread berisi karakter aneh/emoji/mention/hashtag tidak merusak render

**Dependencies:** Task 4

**Files likely touched:**
- `src/export-html.js` (baru)
- `src/export-md.js` (baru, atau gabung ke export-html)
- `src/content.js` / `src/background.js` (tambah pilihan format)

**Estimated scope:** Medium (2-3 files)

## Task 6: Exporter JSON final + CSV + Excel (kolom ala XCommentsExporter)

**Description:** Finalisasi exporter data: JSON terstruktur penuh, CSV flat, dan `.xlsx` yang kolomnya meniru contoh XCommentsExporter (43 kolom: Tweet Id, Full Text, Tweet Url, Media URLs, Media Types/Count, Created At, Conversation Id, Reply refs, counts, language, URLs, hashtags, mentions, user fields, Scraped At). Field yang tidak ada di DOM diisi kosong + didokumentasikan, bukan dihalu.

**Acceptance criteria:**
- [x] Header `.xlsx` 1:1 dengan contoh (urutan + nama kolom sama), 1 baris per tweet, `Media URLs` menunjuk path lokal bila ter-download + URL asli bila tidak
- [x] CSV bisa dibuka di Excel/Sheets tanpa kolom geser (quoting benar untuk teks berisi koma/newline/quote)
- [x] JSON valid dan memuat semua field schema Task 1 + `scrapedAt` + `mediaManifest`
- [x] Dokumen `docs/export-columns.md` memetakan tiap kolom → sumber DOM atau `empty (no DOM source)` secara jujur

**Verification:**
- [x] Bandingkan header xlsx hasil vs header file contoh via script (diff header = kosong)
- [x] Buka CSV + xlsx di spreadsheet: tidak ada baris rusak pada thread berisi koma/quote/newline/emoji
- [x] `python3 -m json.tool` lolos untuk JSON hasil

**Dependencies:** Task 4 (butuh media manifest); paralelisable dengan Task 5 setelah Task 4 selesai

**Files likely touched:**
- `src/export-json.js` (baru/finalisasi)
- `src/export-csv.js` (baru)
- `src/export-xlsx.js` (baru, via SheetJS vendor)
- `vendor/xlsx.full.min.js` (baru)
- `docs/export-columns.md` (baru)

**Estimated scope:** Medium (4-5 files)

### Checkpoint: Exporters

- [x] Dari 1 thread yang sama dihasilkan 5 artefak konsisten (json/csv/xlsx/html/md) dengan tweet count yang sama
- [x] Upload `thread.md`/HTML ke ChatGPT lolos 3 probe; xlsx/csv/json dibuka tanpa corrupt
- [x] Review dengan human sebelum polish UI

### Phase 3: Mekanisme utama (naik prioritas — DOM-only jauh dari ekspektasi)

## Task 7: Network response capture via MAIN-world hook

**Description:** Berhenti mengandalkan DOM malas sebagai sumber utama dan berhenti menebak nama endpoint. Hook di MAIN world membungkus `fetch`/`XHR` dan menangkap SEMUA respons JSON X (tanpa filter nama endpoint), teruskan ke isolated world via event. Popup dapat tombol "Download network log" untuk mengunduh hasil tangkapan — dari log itulah endpoint data + parser dilatih. Tanpa permission baru, tanpa API key, tanpa backend — tetap hak sesi tab.

**Acceptance criteria:**
- [x] Mekanisme hook terbukti di fixture: `fetch` + `XHR` yang di-stub tertangkap + payload sampai ke content script (E2E)
- [x] Tombol popup "Download network log" menghasilkan 1 file JSON berisi entri `{url, status, mime, truncated, body}` dengan cap ukuran/jumlah
- [x] Parser (`x-graphql.js`) dilatih dari **network log asli hasil tangkapan user** (BUKAN tebakan skema): tweet, counts, user, varian mp4, subtitle terekstrak
- [x] Hasil gabungan: counts bukan 0 lagi bila API menyediakannya; video mp4 langsung ter-download; subtitle masuk caption; DOM fallback tidak regresi (semua test lama hijau)
- [x] Tidak ada request ke server manapun selain X/CDN-nya; tidak ada `eval`/remote-code; hook hanya baca respons, tidak mengubah request

**Verification:**
- [x] E2E mekanisme (stub fetch/XHR) hijau headed
- [x] Parser hijau lawan fixture dari network log asli
- [x] Manual check thread Theo: counts terisi, mp4 ke-download (mode separate), subtitle ada bila API menyediakannya

**Dependencies:** Task 4 (media pipeline dipakai ulang); **blocker eksternal**: user browse thread dengan hook aktif lalu klik Download network log, kirim file-nya

**Files likely touched:**
- `src/hook-main.js` (baru, classic, world MAIN: bungkus fetch/XHR + forward event)
- `src/content.js` (buffer tangkapan + layani `DUMP_NETWORK`, bridge event MAIN→isolated)
- `src/background.js` (download log JSON)
- `src/popup.html`, `src/popup.js` (tombol Download network log)
- `src/x-graphql.js` (baru SETELAH log asli ada: parser respons → Tweet mentah; kontrak: tidak ngarang field)
- `manifest.json` (content_scripts world MAIN kedua)

**Estimated scope:** Large (5-6 files) — slice: tangkapan generik + tombol dulu, parser setelah log asli ada

### Phase 4: UX + QA packaging

## Task 8: Popup UI final (preset tujuan + opsi + progress + error)

**Description:** Popup production-ready: pilih preset (`Buat LLM` → html+md+media zip; `Data` → json/csv/xlsx+media zip; `Custom` checklist format), toggle autoscroll, tombol Download, progress bar (N tweets, N media), state error yang jelas (bukan tab, login wall, thread privat/kosong).

**Acceptance criteria:**
- [x] Alur 1-klik: buka thread → klik extension → Download → ZIP terdownload tanpa buka devtools
- [x] Progress terlihat selama scrape + download media; cancel berfungsi
- [x] Error state eksplisit per kasus: bukan halaman thread, 0 tweet terdeteksi, media gagal sebagian (tetap hasilkan ZIP + `errors.json`, tidak gagal total)

**Verification:**
- [x] Manual check 3 skenario: thread kecil, thread panjang+media, halaman bukan-thread (mis. home) → pesan error benar
- [x] Manual check preset LLM vs Data menghasilkan isi ZIP yang berbeda sesuai preset
- [x] Tidak ada error console yang tidak tertangani

**Dependencies:** Task 5, Task 6

**Files likely touched:**
- `src/popup.html`, `src/popup.js`, `src/popup.css` (atau 1 file)
- `src/content.js` (terima opsi format + autoscroll + cancel)
- `src/background.js` (progress relay + final download)

**Estimated scope:** Medium (3-4 files)

## Task 9: Hardening + packaging + uji ChatGPT E2E

**Description:** Keras-kan yang rapuh: fallback selector adaptor, batas memori/thread raksasa, sanitasi nama file, permission minimal (`activeTab`, `scripting`, `downloads` — tanpa `host_permissions` luas bila bisa), ikon, `README` instalasi unpacked, dan uji E2E final termasuk upload ke ChatGPT.

**Acceptance criteria:**
- [x] `permissions` minimal dan terjustifikasi di README; tidak ada `eval`/remote-code; tidak ada request ke server manapun (verifikasi via DevTools Network selama scrape: hanya ke x.com/pbs.twimg.com)
- [x] Lolos uji di 3 thread nyata berbeda (kecil, panjang, media/video) + 1 halaman bukan-thread
- [x] Ada `README.md` instalasi (load unpacked) + cara pakai + batasan dikenal (video HLS, tweet terproteksi, DOM X bisa berubah)
- [x] Hasil akhir: 1 ZIP per download yang siap upload ke ChatGPT dan lolos 3 probe diskusi

**Verification:**
- [x] Checklist manual 3 thread + catat hasil (count tweet, media ok/unresolved)
- [x] Network check: tidak ada egress selain CDN X selama operasi
- [x] Muat ulang extension dari folder bersih dan ulangi alur 1-klik tanpa error

**Dependencies:** Task 7

**Files likely touched:**
- `manifest.json` (final permissions, icons)
- `icons/*` (baru)
- `README.md` (baru)
- `src/x-adapter.js` (fallback selector + batas)
- `TESTLOG.md` (baru, catat hasil 3 thread)

**Estimated scope:** Medium (4-5 files)

### Checkpoint: Complete

- [x] Semua acceptance criteria Task 1-9 terpenuhi
- [x] ZIP final dari thread nyata bisa di-upload ke ChatGPT dan diajak diskusi tanpa missing mayor
- [x] Siap review manusia; belum publish ke Chrome Web Store (out of scope v1)

## Backlog (post-V1, belum di-commit ke task)

(tidak ada — semua dipromosikan)

## Phase 5: V2 situs generik (target pertama: O'Reilly, scope arsip-halaman)

Keputusan terkunci (2026-09-10): situs pertama O'Reilly spesifik
(bukan readability generik), scope arsip halaman saja — HTML/MD +
gambar lokal + ZIP, tanpa CSV/XLSX/thread-model.

## Task 10: Kontrak SiteAdapter + registrasi (X jadi implementasi pertama)

**Description:** Definisikan kontrak adapter tanpa mengubah perilaku X:
`detect(url, document)`, `scrapeArticles()`, `scrollMore()`,
`mediaInventory()`. Bungkus `x-adapter.js` agar memenuhi kontrak;
seluruh suite harus tetap hijau (refactor murni).

**Acceptance criteria:**
- [ ] Ada `src/sites/registry.js` (atau setara): daftar adapter +
  fungsi `detectAdapter(url, document)` yang memilih tepat satu
- [ ] `x-adapter.js` memenuhi kontrak tanpa berubah perilaku
  (seluruh test Task 1-9 hijau tanpa modifikasi ekspektasi)
- [ ] Aturan AGENTS.md diperbarui: query DOM situs HANYA di file
  adaptornya masing-masing

**Estimated scope:** Small-Medium (2-3 files)

## Task 11: Adapter O'Reilly (article + gambar)

**Description:** Adapter `learning.oreilly.com`: deteksi halaman chapter,
scrape judul + body + gambar konten, scroll per section bila perlu.
Fixture dari HTML asli yang disimpan user (seperti pola markup video).

**Acceptance criteria:**
- [ ] Fixture `tests/fixtures/oreilly-chapter.html` dari halaman asli
  (anonymisasi bila perlu) + E2E: judul, paragraf berurutan, gambar
  ter-inventory — hijau headed
- [ ] Tidak ada selector X yang bocor ke adapter ini (dan sebaliknya)

**Dependencies:** Task 10; **blocker eksternal**: 1 file HTML halaman
O'Reilly tersimpan (Ctrl+S, webpage HTML only) dari user

**Estimated scope:** Medium (2-3 files)

## Task 12: Manifest + popup routing + ZIP untuk O'Reilly

**Description:** Daftarkan match O'Reilly di manifest (tanpa
`<all_urls>` blanket), popup deteksi adapter dan ganti pesan
unsupported jadi alur download normal, ZIP isi HTML/MD/gambar pakai
pipeline yang sama (tanpa CSV/XLSX/thread-model).

**Acceptance criteria:**
- [ ] Di halaman O'Reilly: Check connection `connected: true`,
  Download menghasilkan ZIP (HTML/MD/gambar lokal, bisa dibuka offline)
- [ ] Di situs lain yang belum didukung: pesan unsupported tetap eksplisit
- [ ] Jalur X tidak regresi (seluruh suite hijau + 1 download ulang
  thread nyata)

**Verification:**
- [ ] Manual check 1 chapter O'Reilly panjang + gambar: unzip, buka
  HTML offline, upload MD ke ChatGPT dan ajak diskusi

**Dependencies:** Task 11

**Estimated scope:** Medium (3-4 files)

### Checkpoint: V2-OReilly

- [ ] Chapter O'Reilly terarsip end-to-end dan bisa didiskusikan di ChatGPT
- [ ] Jalur X tidak regresi
- [ ] Review human sebelum adapter situs ketiga

## Phase 6: V2 adapter ketiga — transcript YouTube (scope: 1 video → MD buat LLM)

Keputusan terkunci (`docs/ideas/youtube-transcript.md`): arah E + timestamp per segmen
dipertahankan. Jalur utama **B** (parse `timedtext` json3 + `captionTracks` dari buffer
tangkapan network — terbukti ketangkap 247KB/1196 events di log asli 2026-09-10, pola
persis X Task 7: tangkap → parse → pakai). Jalur A (scrape panel DOM) turun jadi fallback
yang tidak dibangun sekarang. Tanpa fetch tambahan (konsumsi body tangkapan langsung —
URL timedtext ada expiry), tanpa `media.js`, tanpa scroller, tanpa xlsx. Parser respons
network YouTube HANYA di `src/youtube-graphql.js` (aturan AGENTS.md diperluas mengikuti
pola `x-graphql.js`). Egress tambahan yang sah: `youtube.com`, `googlevideo.com`,
`gstatic.com`. Tanpa backend (batasan keras tetap berlaku).

Keputusan branching (diputus human 2026-09-11): kerja di branch baru dari `main`
(contoh: `experiment/youtube`), BUKAN dari `experiment/oreilly`. Konsekuensi: mesin
multi-site (registry, routing `site:`, caps per-site — hasil Task 10-12 yang hidup di
`experiment/oreilly`) harus dibawa masuk dulu via merge sebelum Task adapter. `main`
tetap steril X-only; `experiment/oreilly` tetap pisah; penggabungan final diputus belakangan.

## Dependency Graph (Phase 6)

```
Branch experiment/youtube dari main (Task 13a) ✅
    │
    ├── Engine multi-site cherry-pick (Task 13b) ✅ registry + hook/content youtube +
    │       │   netlog gate. Routing download dipindah ke Task 16 (porting bersih,
    │       │   bukan merge mentah — commit oreilly campur engine + kode chapter).
    │       │   Suite hijau syarat keluar.
    │
    └── Sampel timedtext + shape notes (Task 13c)
            │
            ├── youtube-graphql.js: parse bodies → VideoPayload (Task 14)
            │       │
            │       └── exporter video.md + video.json (Task 15, paralelisable dgn Task 14
            │               │   setelah kontrak VideoPayload dikunci di Task 14)
            │               │
            │               └── wiring: registry + manifest + content route buffer (Task 16)
            │                       │
            │                       └── background path + popup + tests + manual (Task 17)
```

Urutan bottom-up mengikuti graf. Tiap task vertical slice; sistem tetap working setiap selesai.

## Task 13a: Branch experiment/youtube dari main

**Description:** Titik mulai bersih sesuai putusan human: branch baru dari ujung `main`
(X-only stabil), bukan dari `experiment/oreilly`. Tanpa perubahan kode — cuma penanda mulai.

**Acceptance criteria:**
- [ ] Branch `experiment/youtube` ada, parent = ujung `main`, working tree bersih
- [ ] `tasks/todo.md` Phase 6 ada di branch ini

**Verification:**
- [ ] `git log --oneline -1` parent sama dengan ujung `main`; `git status` bersih

**Dependencies:** None

**Files likely touched:** (none — penanda branch)

**Estimated scope:** XS

## Task 13b: Engine multi-site cherry-pick (bawa mesin, bukan merge mentah)

**Description:** (Diputus human: cherry-pick, bukan merge.) Ambil dari `experiment/oreilly`
yang murni mesin: registry Task 10 + gitignore local-only. Commit oreilly sisanya campur
engine + kode chapter spesifik — routing download-nya di-porting bersih di Task 16, bukan
ditarik mentah. Hook MAIN + content di-inject di YouTube + gate network-log dibuka via
registry (jalur B butuh buffer tangkapan). Status: ✅ selesai (`85d2de0`, `6be668c`,
`fdd0659`), suite hijau 118/118.

**Acceptance criteria:**
- [x] `src/sites/registry.js` kenal `youtube` (hosts + stack hook + content)
- [x] Manifest match youtube untuk hook MAIN + content.js; JSON valid
- [x] Tombol network log bisa dipakai di tab YouTube (terbukti: log 32 entri ketangkap)
- [x] Suite hijau, X tidak regresi

**Dependencies:** Task 13a

**Estimated scope:** Small (selesai)

## Kontrak VideoPayload (dikunci di Task 14, dikonsumsi Task 15-17)

```js
{ videoId, title, url, duration, segments: [{ t: "12:34", seconds: 754, text }], lang }
```

- `t`: timestamp verbatim `"mm:ss"` dari `tStartMs` (rujukan menit buat prompt ChatGPT);
  `seconds` derivasi jujur (floor), bukan dari sumber lain.
- Field yang tidak ada di payload diisi kosong + jujur — dilarang mengarang (aturan warisan Phase 5).
- Parser respons network YouTube HANYA di `src/youtube-graphql.js` (aturan AGENTS.md diperluas
  mengikuti pola `x-graphql.js`). Tidak ada query DOM YouTube di tahap ini (jalur B murni buffer).

## Task 13c: Sampel timedtext + shape notes (bahan latih parser)

**Description:** Ekstrak sampel KECIL dari network log asli user (bukan 247KB mentah — ambil
~10 events ber-teks + 1 blok `captionTracks` + 1 player `videoDetails`) jadi
`tests/fixtures/timedtext-sample.json`, plus catatan bentuk (`docs/notes/youtube-timedtext.md`:
json3 events/segs, captionTracks fields, sinyal tidak-adanya-caption). Output = fixture +
catatan, bukan kode produksi.

**Acceptance criteria:**
- [ ] Fixture kecil (< 20KB) memuat: events ber-teks + event kosong + captionTracks 1 track +
  videoDetails judul/durasi
- [ ] Catatan shape: field apa → dipakai buat apa; apa sinyal jujur "video ini tidak punya caption"
- [ ] File log 770KB milik user TIDAK masuk repo (tetap di Downloads)

**Verification:**
- [ ] Fixture valid JSON; `tStartMs`/teks sampel cocok dengan isi log asli (spot-check 3 events)

**Dependencies:** None (log asli sudah disediakan user; paralelisable dengan Task 13b —
keduanya prasyarat Task 14)

**Files likely touched:**
- `tests/fixtures/timedtext-sample.json` (baru)
- `docs/notes/youtube-timedtext.md` (baru)

**Estimated scope:** Small (2 files, mostly ekstraksi)

## Task 14: Parser YouTube — timedtext + captionTracks jadi VideoPayload

**Description:** `src/youtube-graphql.js` (classic script, expose `XYouTubeGraphql`, pola
`x-graphql.js`): `extractSegments(timedtextBody)` → segmen `{t, seconds, text}` (skip event
tanpa `segs`/teks kosong, gabung multi-seg, jaga urutan); `extractTracks(playerBody)` →
daftar track jujur; `extractVideoMeta(playerBody)` → judul/durasi/videoId. TDD lawan fixture
Task 13c: RED dulu, GREEN sesudahnya. Tanpa fetch, tanpa DOM — fungsi murni atas string.

**Acceptance criteria:**
- [ ] E2E (real Chromium, headed bila diminta): N segmen berurutan + timestamp `mm:ss`
  verbatim ter-parse dari fixture; event kosong di-skip; video-tanpa-caption (tanpa
  captionTracks) → penanda jujur (bukan error, bukan karangan)
- [ ] Body corrupt / bukan JSON / bentuk tak dikenal → hasil kosong jujur, tidak throw
  (kontrak "API strictly upgrade path" ala X)
- [ ] `npm run verify` hijau (biome + tsc + suite lama tanpa regresi)

**Verification:**
- [ ] Test parser baru hijau (RED dulu terlihat)
- [ ] `npm run verify` penuh hijau

**Dependencies:** Task 13b, Task 13c (kontrak + fixture + infra dari keduanya)

**Files likely touched:**
- `src/youtube-graphql.js` (baru)
- `tests/youtube-graphql.test.js` (baru, pola `graphql.test.js`)
- `tests/fixtures/timedtext-sample.json` (dari Task 13c)

**Estimated scope:** Medium (2-3 files)

### Checkpoint: Parser

- [ ] VideoPayload terkunci dan ter-parse dari fixture log asli
- [ ] Jalur B final (A tetap fallback tak-dibangun; hook sudah di stack sejak Task 13b)
- [ ] Review human singkat sebelum exporter (kontrak dikunci = Task 15-17 bisa jalan di atasnya)

## Task 15: Exporter video.md + video.json (LLM-ready)

**Description:** `renderVideoMarkdown(payload, url)` + JSON payload di `src/export-html.js` (atau modul
export baru bila lebih rapi): `# Judul`, link video, durasi, segmen sebagai `[mm:ss] teks` per baris,
escape benar. Unit test lawan VideoPayload sintetis (timestamp aneh, teks berisi `<>&`, segmen kosong).

**Acceptance criteria:**
- [ ] MD berisi judul + URL + durasi + semua segmen `[t] teks` berurutan, lolos upload ChatGPT
  (probe: "bahas bagian menit X" terjawab dengan rujukan menit benar)
- [ ] Karakter aneh/emoji di-escape, tidak jebol layout; segmen teks kosong di-skip jujur
- [ ] Unit test hijau (RED dulu)

**Verification:**
- [ ] `node --test tests/export.test.js` hijau
- [ ] Manual check: upload MD fixture ke ChatGPT, 1 probe menit terjawab benar

**Dependencies:** Task 14 (kontrak VideoPayload)

**Files likely touched:**
- `src/export-html.js` (tambah renderVideo*)
- `tests/export.test.js`

**Estimated scope:** Small-Medium (2 files)

## Task 16: Wiring tab — content route buffer + background path + registry final

**Description:** Content `SCRAPE_START` route `site: "youtube"` → ambil bodies tangkapan
(`timedtext` + `player`, pola `timelineApiBodies`: newest-first, capped) → parse via
`XYouTubeGraphql` → `SCRAPE_DONE {video}`. Tanpa fetch media, tanpa DOM clicking.
Registry final: stack youtube = `hook + content + jszip` (tambah jszip untuk BUILD_ZIP;
tanpa adapter-DOM karena jalur B murni buffer). Background `downloadVideo()`: validasi
envelope, rakit `video.md` + `video.json`, BUILD_ZIP di tab, download `<videoid>.zip`.

**Acceptance criteria:**
- [ ] `detectAdapter("https://www.youtube.com/watch?v=...") === "youtube"` (sudah hijau sejak 13b)
- [ ] E2E content: buffer stub berisi timedtext + player → `SCRAPE_DONE` berisi `video`
  payload + tanpa field `media` (tidak ada yang di-fetch)
- [ ] Buffer kosong / tanpa timedtext → `EMPTY_TRANSCRIPT` eksplisit (bukan hang, bukan ZIP kosong)
- [ ] `manifest.test.js` tetap hijau; JSON manifest valid
- [ ] Jalur X tidak regresi (suite penuh hijau; O'Reilly tidak ada di branch ini)

**Verification:**
- [ ] `node --test` penuh hijau + `npm run verify` hijau
- [ ] Load unpacked branch: halaman YouTube tidak console-error (content script ke-inject diam)

**Dependencies:** Task 14, Task 15

**Files likely touched:**
- `src/sites/registry.js`
- `manifest.json`
- `src/content.js` (route + parse sekali)
- `src/background.js` (`downloadVideo` + `safeVideoId`)
- `tests/registry.test.js`, `tests/e2e.test.js`, `tests/manifest.test.js`

**Estimated scope:** Medium (4-5 files)

### Checkpoint: Wiring

- [ ] Registry kenal 3 adapter; manifest valid; content route youtube jalan di fixture
- [ ] Suite penuh hijau, X + O'Reilly tidak regresi
- [ ] Review human sebelum popup (wiring tab = fondasi UI)

## Task 17: Popup + tests + uji manual video asli

**Description:** Popup deteksi youtube via registry, label tombol "Download transcript", kirim
`site: "youtube"`, teks hasil `downloaded <id>.zip (N segments)`, `expectedCaps` youtube =
`["zip"]` (tanpa hook/media/scroller/sheet — stack terkurus). Popup-ui test: routing site +
ping sehat. Lalu manual di 2 video asli (satu bercaption, satu tanpa caption → error
EMPTY_TRANSCRIPT eksplisit) + upload MD ke ChatGPT 1 probe menit.

**Acceptance criteria:**
- [ ] Di video YouTube: tombol "Download transcript", klik → `<videoid>.zip` berisi
  `video.md` + `video.json` (+ `errors.json` hanya bila relevan)
- [ ] Check connection di tab YouTube: `connected: true` polos (tanpa warning stale)
- [ ] Di video tanpa caption: pesan eksplisit (bukan ZIP kosong, bukan hang)
- [ ] Di situs tak dikenal: pesan unsupported tetap eksplisit
- [ ] Probe ChatGPT: rujukan menit dari MD benar

**Verification:**
- [ ] `node --test tests/popup-ui.test.js` hijau (test routing + ping youtube baru)
- [ ] `npm run verify` penuh hijau
- [ ] Manual check 2 video asli + 1 probe ChatGPT, catat hasil

**Dependencies:** Task 16

**Files likely touched:**
- `src/popup.js` (deteksi + label + caps)
- `tests/popup-ui.test.js`
- `tasks/todo.md` (centang)

**Estimated scope:** Medium (2-3 files + kerja manual)

### Checkpoint: Complete (Phase 6)

- [ ] Semua acceptance Task 13-17 terpenuhi
- [ ] MD dari video asli didiskusikan di ChatGPT dengan rujukan menit benar
- [ ] Jalur X + O'Reilly tidak regresi
- [ ] Review human; branch tetap pisah sampai diputuskan merge

## Phase 7: X Article (long-form) sebagai root thread

## Task 18: Tangkap X Article (network + DOM) jadi root tweet

**Description:** Root thread bisa berupa X Article, bukan tweet biasa — body-nya
tidak ada di `[data-testid="tweetText"]` dan tidak dibaca parser `tweet_results`.
Dua jalur diisi: (a) `x-graphql.js` membaca `result.article.article_results.result`
(title + DraftJS `content_state` + `media_entities`) dan render ke Markdown;
(b) `x-adapter.js` mendeteksi reader DOM (`[data-testid="twitterArticleReadView"]`,
`twitter-article-title`, `twitterArticleRichTextView`, blok `longform-*`) sebagai
fallback. Kontrak `Tweet` dapat `isArticle` + `article {title,text,coverUrl}`;
`tweet.text` diisi `# title` + body supaya semua exporter ikut menampilkan tanpa
menambah kolom tabular.

**Acceptance criteria:**
- [x] Payload API `article_results.result` jadi root tweet: title, cover, media,
  dan body (heading/list/quote/link/atomic-media)
- [x] Reader DOM jadi root tweet saat network dump tidak ada
- [x] Dua sighting (reader + tweet cell) merge: teks terpanjang, user/media/metrics diisi
- [x] `tweet.isArticle`/`article` mengalir ke JSON; MD/HTML menandai "X Article"
- [x] Header tabular 43 kolom tidak berubah; body masuk kolom Full Text

**Verification:**
- [x] `tests/graphql.test.js`, `tests/model.test.js`, `tests/export.test.js` hijau
- [x] `tests/e2e.test.js` (reader DOM nyata di Chromium) hijau
- [x] `npm run quality` + `npm test` hijau

**Files touched:** `src/model.js`, `src/x-graphql.js`, `src/x-adapter.js`,
`src/export-html.js`, `tests/*`, `tests/fixtures/x-article-detail.json`,
`tests/fixtures/thread-article.html`, `docs/export-columns.md`, `README.md`

**Estimated scope:** Medium (2 jalur + kontrak + fixture)

### Checkpoint: X Article

- [ ] Manual E2E di thread artikel asli: root + body + media ikut ter-download
- [ ] Warning "Root tweet not captured" hilang di popup
- [ ] Review human sebelum lanjut

## Risks and Mitigations (tambahan Phase 6)

| Risk | Impact | Mitigation |
|------|--------|------------|
| Panel transcript tidak bisa dibuka programmatic / struktur shadow-DOM keras | Low | Tidak relevan lagi — jalur A turun jadi fallback tak-dibangun; jalur B tidak sentuh DOM panel |
| YouTube ganti layout panel (lebih sering dari X/O'Reilly) | Med | Isolasi selector di `youtube-adapter.js` + fallback multi-selector; error jujur bila panel tak dikenal |
| Video/tanpa caption (pemilik matikan, live, musik berlisensi) | Med | Guard EMPTY_TRANSCRIPT eksplisit; bukan ZIP kosong |
| Bahasa track panel tidak deterministik (multi-bahasa) | Low | Catat `lang` dari track jujur (vssId/kind); pilih-pilih bahasa out of scope MVP |
| Manifest match `youtube.com` ditolak review Web Store (out of scope) | Low | Tetap unpacked-load seperti V1/V2; tanpa host_permissions blanket |

## Open Questions

- ~~Branch dari `experiment/oreilly` (rekomendasi) atau porting plumbing ke `main`?~~
  Diputus 2026-09-11: branch dari `main`, merge `experiment/oreilly` masuk belakangan (Task 13b).
- Sinkronkan checkbox Phase 5 di `tasks/plan.md` + `tasks/todo.md` cabang `main` dengan status asli (sudah selesai di `experiment/oreilly`)? Diusulkan: ya, saat Phase 6 mulai, agar plan tidak berbohong.
- ~~Perlu `hook-main.js` di stack YouTube untuk masa depan (timedtext fallback), atau tetap tanpa hook sampai plan B aktif? Default: tanpa hook.~~
  Terjawab: hook WAJIB di stack (jalur B konsumsi buffer tangkapan) — sudah masuk sejak Task 13b.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Selector DOM X berubah sewaktu-waktu | High | Isolasi di `x-adapter.js` + fallback multi-selector; Task 2-3 kunci pola lebih dulu; catat batas di README |
| Video/GIF X memakai HLS (m3u8) tidak bisa fetch sebagai 1 blob | Med | Minimal poster ter-bundle; varian mp4 langsung diambil bila ada; sisanya catat `unresolved` di manifest, jangan silent-drop |
| Thread raksasa (ratusan media) bikin memori/ZIP jumbo, upload ChatGPT mentok limit | Med | Batas + cancel + mode viewport-only; preset LLM pakai md/txt ringan; dokumentasikan batas |
| `counts` (likes/views) dan field user lengkap tidak ada di DOM | Low | Isi kosong jujur + `docs/export-columns.md`; jangan ngarang angka |
| Permission/CSP Chrome blokir fetch media dari content script | Med | Fetch dari content script (konteks tab), bukan popup/background; fallback `chrome.downloads` per-file bila blob gagal |

## Open Questions

- ZIP satu file vs folder terpisah — default ZIP (gampang upload), perlu opsi "tanpa zip"? (default: ZIP; diputus di Task 7 bila user minta)
- Kualitas video: ambil varian mp4 tertinggi yang terdeteksi, atau cukup poster? (default: mp4 bila fetchable, fallback poster)
- Quote-tweet dihitung sebagai 1 tweet terpisah + relasi `quotedId`, atau inline? (default: terpisah + relasi)
- Batas thread raksasa: cap default berapa tweet/media sebelum minta konfirmasi? (usulan: 300 tweet / 100 media, diputus saat Task 3)

## Parallelization Opportunities

- Aman paralel setelah Task 4: Task 5 (HTML/MD) dan Task 6 (CSV/Excel/JSON) bisa jalan paralel karena kontrak schema sama
- Harus sekuensial: Task 1 → 2 → 3 → 4 (rantai DOM), lalu 7 → 8 (UI + hardening di atas semuanya)
- Butuh koordinasi: format `ThreadSnapshot` dikunci di Task 1 sebelum exporter mana pun ditulis

## Phase 8: Substack article + comments (custom domain, on-demand injection)

**Status:** planned 2026-11-03, revised after adversarial review. Branch:
`experiment/substack` dari `main`.
**Sumber:** `docs/ideas/substack.md` (bukti halaman + hasil uji comments API).
**Dependensi phase:** kode Phase 7 sudah di `main`; checkpoint manual X Article tidak
memblokir Phase 8 karena Substack tidak menyentuh jalur X.

**Kenapa phase terpisah:** Substack bukan adapter host-based. Publication bisa memakai
custom domain tak terbatas, jadi deteksi harus berbasis konten (`preloads-json`/DOM) dan
script di-inject on-demand lewat `activeTab` + `chrome.scripting.executeScript`. Ini
mekanisme baru; jangan campur dengan registry host X/YouTube dan jangan tambah
`content_scripts.matches` untuk Substack.

**Keputusan yang dikunci di phase ini:**

- **Deteksi + identitas post:** `script#preloads-json[type="application/json"]` + guard
  object `post` + path `/p/<slug>`. Canonical path dari `post.canonical_url` **wajib
  dibandingkan** dengan `location.pathname` (normalisasi trailing slash). Kalau beda,
  `preloads` dianggap stale: adapter fetch `GET /api/v1/posts/{slug}` dari slug di URL
  aktif, lalu verifikasi `slug`/`canonical_url` response. **DOM tidak pernah jadi sumber
  artikel.** Marker `article.newsletter-post` hanya dipakai untuk mendeteksi "ini
  halaman post" saat `preloads` absen; isi artikel tetap harus datang dari preloads yang
  canonical-nya cocok atau dari API. Kalau keduanya gagal → `POST_IDENTITY_MISMATCH`,
  jangan arsipkan post yang salah dan jangan pakai ID dari preload stale.
- **Injection:** `activeTab` + `scripting.executeScript`, file classic yang idempotent.
  Semua file yang di-inject harus bisa dieksekusi dua kali di isolated world yang sama.
  Setiap file set `globalThis.<Nama>.version = 1`; `ensureSubstackInjected(tabId)`
  memetakan file → global yang harus ada (`SubstackDetect`, `SubstackAdapter`,
  `SubstackArticle`, `XMedia`, `JSZip`, `__arsipSubstackContent`) dan inject hanya file
  yang globalnya belum ada, urut `SUBSTACK_INJECTION`. `src/media.js` punya top-level
  `const MIME_EXTENSIONS`; bungkus dengan IIFE guard. Tidak ada `host_permissions`,
  tidak ada `content_scripts.matches` untuk Substack.
- **Job state dimiliki content script, bukan service worker:** `src/substack-content.js`
  menyimpan `{ jobId, documentToken, postId, sourceUrl, options, state, cancelRequested,
  progress, result, errors, saveState, downloadId }`. `SCRAPE_START` kedua saat state
  belum terminal → `BUSY`. Service worker cuma relay tipis; kalau worker mati, popup
  tetap bisa reconnect dengan bertanya status ke tab. Ini menghindari lock hilang saat
  MV3 worker di-terminate.
- **Save lifecycle (content-owned, idempoten, attempt-scoped):** `saveState` ∈
  `idle | saving | saved | failed`, plus `saveStartedAt`, `attemptId` (acak per
  klaim), `expectedFilename` (dibekukan saat `DOWNLOAD_STARTED`), dan `downloadId`
  (opsional). **Klaim atomik:** hanya `SAVE_RESULT` (diteruskan background ke tab)
  yang boleh memindahkan `idle`/`failed` → `saving`, membuat `attemptId` baru, dan
  membalaskan `payload`; `GET_RESULT` **read-only**.
  `saving`/`saved` → balas `{ alreadySaved: true, saveState, downloadId }`.
  **Fencing attempt menyeluruh (di setiap batas async):** `BUILD_ZIP`,
  `DOWNLOAD_STARTED`, `MARK_SAVED`, `SAVE_FAILED` semuanya membawa `attemptId`;
  transisi dengan `attemptId` yang tidak cocok dengan attempt aktif **diabaikan**.
  - **Background:** cek flag abort **setelah setiap `await`** di pipeline render/ZIP.
    **Commit authorization + boundary:** content memberi izin commit saat
    mengembalikan byte ZIP (men-set `savePhase: "commit-authorized"` untuk attempt);
    background hanya boleh melanjutkan bila izin itu ada. **Tepat sebelum
    `chrome.downloads.download`**, validasi ulang (1) flag abort, (2) `tab.url` vs
    `sourceUrl` save ini, (3) attempt masih aktif → gagal → tidak memanggil download.
    **Jendela cross-process yang tidak bisa dihilangkan (dokumentasikan, jangan
    dijanjikan atomik):** antara validasi terakhir dan panggilan `download()` ada jeda
    lintas proses — karena itu **setelah `downloadId` ada**, background **revalidasi
    ulang** `tab.url` + STATUS job (`invalidated?`): bila terinvalidasi →
    `chrome.downloads.cancel(downloadId)` + **rekonsiliasi state terminal**
    (`search({ id })`): `complete` → ZIP keburu jadi → biarkan + catat diagnostic
    `downloaded-after-invalidation` di content record (job/pending →
    `SCRAPE_STATUS.postDownloadDiagnostics` → popup; **bukan** `errors.json` ZIP yang
    byte-nya sudah final), `interrupted` → buang + `SAVE_FAILED`, `in_progress` →
    tunggu. **`cancel()` tidak dianggap bukti "tidak ada ZIP"** — status nyata dari
    `search` yang menentukan transisi berikutnya.
  - **Content:** di dalam `buildZip`, cek `attemptId`/state **sebelum mulai** dan
    **sebelum mengembalikan byte ZIP** (setelah await terakhir) → selain attempt,
    **revalidasi juga `location.href` vs `job.sourceUrl` dan generasi job** →
    basi/berubah → `STALE_ATTEMPT`/`TAB_CHANGED`, byte tidak dikirim. Saat byte
    dikembalikan, set `savePhase: "commit-authorized"` (izin commit attempt-scoped).
  - **Invalidasi menghubungkan ke save:** saat content meng-invalidasi job (URL
    berubah), STATUS membalas `invalidated: true`; background yang sedang memegang
    pipeline save untuk job itu **membatalkan controller-nya** (AbortController) →
    berhenti di batas async berikutnya. Jendela antara pembatalan dan submit yang
    sudah dijelaskan di atas ditangani oleh revalidasi pasca-`downloadId` — hasilnya
    selalu salah satu dari: tidak pernah dipanggil, dibatalkan, atau (bila keburu
    complete) dicatat eksplisit; **tidak pernah** "ZIP terinvalidasi yang diam-diam
    lolos".
  - **Pipeline hidup dimiliki worker itu sendiri; deadline terikat fase `savePhase`
    yang eksplisit:** `savePhase` ∈ `idle → claiming → rendering → commit-authorized
    (byte ZIP dikembalikan content) → submission-pending (masuk **tepat sebelum**
    `chrome.downloads.download()` dipanggil, **tanpa `await` di antaranya**) →
    submitted (**masuk di invocation**; `downloadId` diisi belakangan begitu promise
    resolve — penerimaan id **bukan** batas fase) → done/failed`. Recovery **tidak
    pernah** menghancurkan pipeline yang sedang dipegang worker lain/dirinya sendiri.
    `SAVE_ATTEMPT_TIMEOUT_MS` (120 dtk) berlaku **hanya untuk fase pre-submission**
    (`rendering`, `commit-authorized`, `submission-pending` — semua fase sebelum
    invocation): lewat itu → pemilik pipeline menghancurkan sendiri + `SAVE_FAILED`
    (retryable). **Begitu invocation terjadi (fase `submitted`)**, timer **dihentikan**
    — termasuk saat promise `download()` tertunda (delayed-id): phase sudah
    `submitted`, timer mati, ownership dipertahankan; tunggu id/`onChanged`, lalu
    **rekonsiliasi dulu** (`complete` → `MARK_SAVED`, `interrupted` → `SAVE_FAILED`)
    sebelum retry diizinkan. Recovery hanya mengklaim attempt yang **tidak dimiliki
    worker ini**.
  - **Reclaim tanpa `downloadId` = tiga syarat:** `Date.now() - saveStartedAt >
    SAVE_ABANDONED_MS` (60 dtk) **dan** worker ini tidak memegang pipeline in-flight
    untuk attempt itu **dan** **dua kali** `search({ query: [jobId] })` dengan jeda
    ≥ 1 dtk **tidak menemukan kandidat `complete`/`in_progress` yang relevan**
    ("kosong" didefinisikan di sini: kandidat `interrupted` lama **diabaikan** —
    mereka bukan bukti tersimpan dan bukan penghalang reclaim). Menangkap download
    yang baru terdaftar; attempt A yang pernah `interrupted` tidak bisa mengunci
    attempt B selamanya.
  **Setiap batas gangguan punya transisi eksplisit:**
  - Klaim sudah, render/ZIP/download gagal → background kirim
    `SAVE_FAILED { jobId, documentToken, attemptId }` → `saveState: "failed"`
    (result tidak dibuang, retry boleh). Kegagalan **permanen** (mis.
    `ARCHIVE_TOO_LARGE` dari Stage B) → `SAVE_FAILED { ..., terminal: true, code }`
    → state `error` (terminal, lock lepas).
  - `saving` + `downloadId` → `chrome.downloads.search({ id: downloadId })`:
    `complete` → `MARK_SAVED`; `in_progress` → tunggu; `interrupted` → `SAVE_FAILED`.
  - `saving` **tanpa** `downloadId` (worker mati sebelum `DOWNLOAD_STARTED`) →
    background jalankan reclaim (lihat tiga syarat di atas); sebelum syarat terpenuhi
    → popup menampilkan "masih menyimpan" — jangan mencabut save yang masih hidup.
    **Tidak pernah** menganggap filename post yang sama hari sebagai bukti job ini
    tersimpan.
  - Release lock hanya setelah `MARK_SAVED` (download **complete**), `DISMISS` yang
    sah, atau transisi terminal.
- **Kegagalan terminal vs save yang bisa diulang:** capture gagal permanen
  (`POST_IDENTITY_MISMATCH`, `POST_NOT_FOUND`, `ARTICLE_TOO_LARGE`,
  `ARCHIVE_TOO_LARGE`, `TAB_CHANGED` yang terdeteksi) → state `"error"` = **terminal**;
  job dilepas dan `SCRAPE_START` berikutnya boleh jalan **tanpa reload tab** (tidak
  ada `BUSY` permanen). `state: "ready"` dengan `saveState` `idle`/`failed` tetap
  memegang lock; popup menawarkan Save atau **`DISMISS`** → content membuang result →
  state `"idle"` (lock lepas). **`DISMISS` ditolak (`SAVE_IN_PROGRESS`) bila
  `saveState === "saving"`** — tidak boleh membuang result yang sedang di-download;
  batalkan save dulu (atau tunggu selesai) baru dismiss. `SAVE_FAILED` (tanpa
  `terminal`) tidak melepas lock — hanya `MARK_SAVED`, `DISMISS` sah, atau `error`.
- **Invalidasi navigasi (menutup jalur BUSY permanen):** content memvalidasi
  `location.href` vs `job.sourceUrl` di **setiap** pesan masuk yang menyentuh job
  (termasuk `SCRAPE_STATUS`). Mismatch (SPA navigation dengan dokumen yang sama,
  reload parah, dll) → **invalidasi job saat itu juga**: state → `error` +
  `reason: "tab-changed"`, result dibuang, lock lepas; pesan membalas `TAB_CHANGED`.
  Setelah itu `SCRAPE_START` untuk post baru (atau post yang sama setelah kembali)
  jalan tanpa reload tab. Tidak ada state yang menggantung hanya karena URL berubah.
- **Filename + identitas rekonsiliasi:** `substack-<subdomain>-<slug>-<date>-<jobId>.zip`
  (jobId **lengkap** dari `crypto.randomUUID()`, slug dipotong supaya total ≤ 200
  karakter, sanitasi filesystem-safe). Filename dihitung background sekali saat
  `DOWNLOAD_STARTED` dan **dibekukan di content** (`expectedFilename`); recovery tidak
  menghitung ulang tanggal/nama. Pencarian: `downloads.search({ query: [jobId] })` —
  `query` bertipe `string[]` (bukan string). **Kepemilikan diverifikasi:** `byExtensionId
  === chrome.runtime.id` **dan** `filename` mengandung `jobId` **dan** `endsWith(".zip")`
  (collision counter Chrome ` (1)` tidak merusak aturan ini); nama persis disukai tapi
  bukan satu-satunya syarat. `downloads.search({ filename })` tidak dipakai (harus
  absolute path). **Urutan deterministik** saat banyak kandidat: ada `complete` →
  `MARK_SAVED`; kalau tidak, `in_progress` terbaru (`startTime` terbesar) → monitor;
  selainnya → `SAVE_FAILED`. Retry memakai `jobId` yang sama (attemptId yang
  membedakan), jadi kandidat lama `interrupted` tidak menutupi attempt baru.
- **Job identity + document binding (tiga kelas skema):**
  - **Bootstrap (binding belum ada):** `PING`, `SCRAPE_START` — request tanpa
    `jobId`/`documentToken`; `SCRAPE_START` membalas binding **baru**
    `{ jobId, documentToken, state: "started" }`. Karena belum ada token yang
    bisa dibandingkan, validasi ack = cek bentuk + echo `site`/`tabId`.
  - **Discovery (read-only, tokenless):** `SCRAPE_STATUS` hanya `{ site, tabId }`;
    balasan memuat binding + state lengkap. `PING` dan `SCRAPE_START` juga tanpa
    binding (bootstrap); `SCRAPE_STATUS` adalah satu-satunya pesan **tanpa job** yang
    sah dijalankan setelah job terbentuk.
  - **Bound operation (wajib `site` + `jobId` + `documentToken`):** `SAVE_RESULT`,
    `SCRAPE_CANCEL`, `DISMISS`, `BUILD_ZIP`, `GET_RESULT`, `MARK_SAVED`,
    `DOWNLOAD_STARTED`, `SAVE_FAILED`. **Echo binding hanya berlaku untuk kelas
    ini** (dan balasannya); `PING` dan `SCRAPE_STATUS` dikecualikan karena tidak
    membawa job. Background membandingkan echo balasan dengan yang dikirim — inilah
    validasi binding (return value `tabs.sendMessage` tidak punya argumen `sender`,
    jadi klaim validasi `sender.documentId` pada jalur reply **tidak dipakai**).
  - **Validasi URL dua lapis (stateless-safe), cakupannya terpisah tegas:**
    - **Pesan dari popup** (`SCRAPE_START`, `SAVE_RESULT`, `SCRAPE_CANCEL`, `DISMISS`)
      membawa `sourceUrl`; background membandingkan dengan `tab.url` → mismatch →
      `TAB_CHANGED`.
    - **Pesan internal background→tab** (`BUILD_ZIP`, `GET_RESULT`,
      `DOWNLOAD_STARTED`, `MARK_SAVED`, `SAVE_FAILED`) **tidak membawa `sourceUrl`**
      dan tidak divalidasi URL-nya di background — pengaman URL-nya adalah cek
      content: setiap pesan yang menyentuh job dibandingkan `location.href` vs
      `job.sourceUrl` (lihat keputusan "Invalidasi navigasi": mismatch → invalidasi
      + `TAB_CHANGED`). Jadi tidak ada pesan yang meminta field yang tidak ada di
      bentuknya.
  - Content memvalidasi `sender.id === chrome.runtime.id` untuk pesan masuk;
    mismatch → abaikan. Dokumen baru (reload) punya token berbeda → `JOB_LOST`.
  - Background **tidak pernah** meneruskan pesan Substack ke "tab aktif" secara
    buta: tanpa `tabId` eksplisit → `SCRAPE_ERROR { code: "BAD_BINDING" }`. Pesan tanpa
    `site` jatuh ke handler lama X/YouTube seperti biasa.
  - Substack tidak memakai `SCRAPE_PROGRESS` runtime; progres via `SCRAPE_STATUS`
    (polling). Background me-route `payload.site === "substack"` **sebelum** handler
    `lastProgress`/`lastResult` lama.
- **Single-flight per tab:** hanya satu job Substack per tab. Popup yang dibuka ulang
  membaca `SCRAPE_STATUS` (diproksikan ke tab), reconnect ke job aktif, dan bisa Cancel.
  Job X/YouTube tidak memakai lock ini; state Substack tidak pernah menyentuh
  `lastProgress`/`lastResult` global.
- **Protokol pesan (eksplisit; `src/messaging.js` ikut diubah di Task 19):** tipe baru
  `GET_RESULT`, `SAVE_RESULT`, `SAVE_SUBMIT`, `MARK_INVALIDATED`, `MARK_SAVED`,
  `DOWNLOAD_STARTED`, `SAVE_FAILED`, `DISMISS` masuk ke `MESSAGE_TYPES` +
  `MessageType` + test vocabulary. Kelas skema (bootstrap / discovery / bound)
  mengikuti keputusan "Job identity + document binding" di atas. Bentuk:
  - `PING` (bootstrap, tanpa job): request opsional `{ site?, tabId? }`; response
    `{ connected: true, caps: { media, zip, substack } }` — **dikecualikan** dari
    echo binding (tidak ada job untuk diecho); response bentuk lain = reject.
  - `SCRAPE_START` (bootstrap; popup→background→tab): `{ site, tabId, sourceUrl,
    postId, options }` — tanpa binding (belum ada). Content menjawab **sinkron dengan
    ack** `SCRAPE_DONE { jobId, documentToken, state: "started", site, tabId }`
    (return `false`) lalu capture jalan async; **selesai/tidaknya diamati lewat
    polling `SCRAPE_STATUS`**, bukan respond kedua. Validasi ack = bentuk + echo
    `site`/`tabId` (echo di sini mengacu ke field request, bukan token yang belum
    ada). Ack langsung membuat cancel saat capture berjalan bisa di-binding.
  - `SCRAPE_STATUS` (discovery; popup→background→tab): request `{ site, tabId }`
    (tokenless, read-only); balasan `{ jobId, documentToken, state, progress, options,
    sourceUrl, postId, resultAvailable, saveState, saveStartedAt, attemptId,
    expectedFilename, downloadId, errorCode, errorReason, errors, invalidated,
    postDownloadDiagnostics, pendingAttempts }` — **dikecualikan** dari echo binding.
    `errorCode`/`errorReason`/`errors` adalah **outcome terminal yang dipersistensi**
    (`cancelled-before-article`, `POST_IDENTITY_MISMATCH`, `ARTICLE_TOO_LARGE`,
    `ARCHIVE_TOO_LARGE`, `tab-changed`, `POST_NOT_FOUND`, dst.) supaya popup —
    termasuk setelah reopen — bisa menjelaskan kegagalan dengan benar;
    `invalidated: true` memberi tahu background bahwa pipeline save untuk job ini
    harus dibatalkan; `postDownloadDiagnostics` = daftar diagnostic pasca-download
    (mis. `downloaded-after-invalidation`) dari **record document-scoped** (lihat
    bawah) — **bukan** di ZIP yang byte-nya sudah final; `pendingAttempts` = daftar
    attempt submitted yang belum direkonsiliasi **dengan identitas lengkapnya**
    (`{ jobId, documentToken, attemptId, saveStartedAt, submittedAt, downloadId:
    number|null, expectedFilename, sourceUrl, savePhase, invalidated, invalidatedAt }`)
    supaya recovery bisa berjalan **independen dari state job saat ini** (START baru
    tidak menyembunyikan attempt lama) dan elapsed reclaim memakai timestamp attempt
    itu sendiri.
  - `GET_RESULT` (bound; background→tab): `{ site, jobId, documentToken }` → balas
    `SCRAPE_DONE { payload, errors, options, jobId, documentToken }` — **read-only**,
    capture payload untuk inspeksi/diagnostik; tidak mengklaim save; tidak divalidasi
    URL di background (kontrol URL ada di content).
  - `SAVE_RESULT` (bound; popup→background→tab): `{ site, tabId, jobId,
    documentToken, sourceUrl }` (tanpa options — options ikut job). Background
    memvalidasi `tab.url` vs `sourceUrl` lalu **meneruskan SAVE_RESULT yang sama ke
    tab** (content juga memvalidasi `location.href` vs `job.sourceUrl` sebelum
    klaim); balasan `SCRAPE_DONE { claimed: true, attemptId, payload, errors,
    options }` atau `{ alreadySaved: true, saveState, downloadId }`. Hanya setelah
    `claimed` background render + `BUILD_ZIP` (ber-`attemptId`) + `SAVE_SUBMIT` +
    download + `DOWNLOAD_STARTED` + (complete) `MARK_SAVED`; gagal → `SAVE_FAILED`
    (ber-`attemptId`, `terminal: true` bila permanen).
  - `SAVE_SUBMIT` (bound; background→tab): `{ site, jobId, documentToken, attemptId,
    sourceUrl, expectedFilename, downloadId: null }` — dikirim **sebelum commit
    checks + invocation**; content membuat/akui record `pendingAttempt` (identitas
    lengkap) lalu membalas `SCRAPE_DONE { submitted: true }`. Background **hanya
    melanjutkan ke invocation setelah ack ini** — jadi identitas recovery sudah ada
    di content sebelum `downloads.download()` dipanggil (menutup jendela worker mati
    tepat setelah invocation). `DOWNLOAD_STARTED` nanti mengisi `downloadId` record
    yang sama. **Routing pesan terminal** (`DOWNLOAD_STARTED`/`MARK_SAVED`/
    `SAVE_FAILED`) diarahkan ke record yang cocok `jobId`+`attemptId` — boleh
    `pendingAttempt` lama, bukan hanya attempt aktif job sekarang; job baru tidak
    boleh terpengaruh.
  - `MARK_INVALIDATED` (bound; background→tab): `{ site, jobId, documentToken?,
    attemptId, observedUrl, reason }` — dikirim **setiap kali background sendiri
    mengamati mismatch URL** untuk suatu attempt (commit boundary, reconcile, atau
    pemeriksaan popup), **sebelum** background melanjutkan cancel/reconcile/abort.
    Content menandai **monotonik** `invalidated: true` + `invalidatedAt` pada record
    `pendingAttempt` yang cocok `attemptId` (dan proyeksi job bila cocok) — **tanpa
    memandang `location.href` saat ini dan tanpa pernah di-reset**, lalu membalas
    `SCRAPE_DONE { invalidated: true, jobId, attemptId }`. Karena flag sudah tertulis
    di content, URL yang kembali ke nilai semula **setelah** ini tidak menghapus
    riwayat, dan worker yang mati belakangan tetap meninggalkan flag yang benar.
    Jadi observasi invalidasi dari background maupun content keduanya persist di
    record yang sama.
  - `BUILD_ZIP` (bound; background→tab): `{ site, jobId, documentToken, attemptId,
    files }` → content memvalidasi binding **dan `attemptId` masih aktif** (basi →
    `SCRAPE_ERROR { code: "STALE_ATTEMPT" }`, background batal sebelum download) →
    balas `SCRAPE_DONE { zipBase64, jobId, documentToken }` atau
    `SCRAPE_ERROR { code: "JOB_LOST" }`.
  - `SCRAPE_CANCEL` (bound; popup→background→tab): `{ site, tabId, jobId,
    documentToken, sourceUrl }`; content set `cancelRequested`, **tidak** melepas
    job; balasan `SCRAPE_DONE { cancelled: true }` hanya acknowledgement.
  - `DISMISS` (bound; popup→background→tab): `{ site, tabId, jobId, documentToken,
    sourceUrl }` → content membuang `result`/`errors` **hanya bila `saveState`
    `idle`/`failed`**; `saveState === "saving"` → `SCRAPE_ERROR { code:
    "SAVE_IN_PROGRESS" }` (tidak boleh membuang result yang sedang di-download) →
    state `"idle"`; lock lepas; balasan `SCRAPE_DONE { dismissed: true }`.
  - `DOWNLOAD_STARTED` / `MARK_SAVED` / `SAVE_FAILED` (bound; background→tab):
    `{ site, jobId, documentToken, attemptId, downloadId?, terminal?, code? }` —
    transisi dengan `attemptId` basi diabaikan content; `SAVE_FAILED` dengan
    `terminal: true` → state `error` (lock lepas), tanpa itu → `saveState: "failed"`.
- **Artikel:** `preloads.post` (hanya bila canonical cocok) → `GET /api/v1/posts/{slug}`
  (stale SPA / preloads absen). DOM hanya marker deteksi. `post.identity` mencatat
  `"preloads"` atau `"api"`.
- **Komentar:** same-origin `GET /api/v1/post/{post_id}/comments?all_comments=true`.
  DOM-only tidak dipakai karena halaman post cuma merender 2 komentar. Body komentar
  dibaca dengan stream cap **16 MB**; response di atas itu → `state: "too_large"` tanpa
  dikirim ke background.
- **Transport content→background:** kontrak terpisah dari snapshot. Content mengirim
  `{ article, media, embeds, commentsRaw | null, commentsState, errors }` — `embeds`
  **ikut selalu** (inventaris embed tidak boleh hilang di transport; diuji lewat
  recovery + render ZIP). `commentsRaw` hanya boleh dikirim bila ukuran UTF-8 seluruh
  envelope ≤ 24 MB. Kalau lewat, content mengosongkan `commentsRaw` dan mengirim
  `commentsState: { state: "too_large" }`. `items: []` adalah field snapshot hasil
  normalisasi di background, bukan cara membuang raw tree.
- **Budget & degradasi (SATU definisi otoritatif; semua bagian merujuk ke sini):**
  - **Stage A — content→background (envelope):** media mentah ≤ 12 MB; body komentar
    ≤ 16 MB (stream; fallback `response.blob()` → cek `blob.size` — satuan byte,
    bukan `.length`); envelope UTF-8 ≤ 24 MB. Ukur dengan
    `new TextEncoder().encode(JSON.stringify(payload)).byteLength` — **ukur ulang
    envelope LENGKAP setelah setiap langkah degradasi** (bukan hanya anggota
    `article`). Urutan degradasi di content: buang `base64` media terbesar dulu →
    kosongkan `commentsRaw` → bila masih > 24 MB: (a) `article` saja > 24 MB →
    `ARTICLE_TOO_LARGE`; (b) `article` muat tapi envelope residu (metadata + embeds +
    errors + field lain) > 24 MB → `ENVELOPE_TOO_LARGE` — keduanya **terminal eksplisit**
    (gagal; tidak ada janji "artikel tetap" yang mustahil, tidak ada ceiling yang
    dilanggar diam-diam). Fixture batas: artikel < 24 MB tetapi envelope residu
    > 24 MB → `ENVELOPE_TOO_LARGE`.
  - **Stage B — render→ZIP:** input ZIP = **jumlah byte file terdecode** (media bytes +
    teks) ≤ 32 MB. Urutan: render dari set retained → ukur; > 32 MB → drop media
    terbesar → update manifest + **re-render semua output** → ukur ulang; masih > 32 MB
    → drop `comments.items` → **recompute stats ke tree retained** → re-render; masih
    > 32 MB → `ARCHIVE_TOO_LARGE` (`SAVE_FAILED { terminal: true }` → state `error`).
    **Stats setelah degradasi selalu menggambarkan output retained** (bukan observasi
    pra-degradasi): drop komentar Stage B → `state: "too_large"`, `reason:
    "zip-budget"`, `items: []`, `captured: 0`, `truncated: true`, `dropped: published`
    (`published` tetap angka yang pernah diamati), `topLevel`/`maxDepth` dihitung ulang
    dari retained (0), `errors.json` mencatat observasi pra-drop
    (`observedCaptured`, byte) supaya tidak ada angka yang hilang diam-diam. CSV di-
    **skip** bila `items` kosong (matrix preset: `comments.csv` hanya bila items tidak
    kosong). Setelah degradasi, setiap referensi `media/...` di MD/HTML/JSON wajib
    resolve ke file yang masuk ZIP, dan summary `post.json` == `comments.json` stats ==
    baris CSV (bila CSV ada) (test Stage B fixture khusus memaksa drop komentar).
  - Pengukuran selalu byte (UTF-8 / `Blob.size` / byte file), bukan `.length`
    (UTF-16). Tidak ada dua urutan degradasi yang berbeda di dua task.
- **Output:** `post.md`, `post.html`, `post.json`, `comments.json`, `comments.csv`
  (data preset), `media/`, `media-manifest.json`, `errors.json`.
- **Preset matrix (otoritatif, jangan reuse `filterFilesByPreset` thread):**
  - Selalu: `media/*`, `media-manifest.json`, `errors.json` (bila ada), dan
    `comments.json` (bila komentar di-include).
  - `llm`: `post.md`, `post.html`.
  - `data`: `post.json`, `comments.csv` — `comments.csv` hanya diikutkan bila
    `comments.items` tidak kosong (state `too_large` pasca-Stage B → tanpa CSV).
  - `custom`: pilihan user di antara `post.md`, `post.html`, `post.json`,
    `comments.csv`; sidecar wajib tetap ikut.
  Implementasi di `src/substack-presets.js` + test matrix; `post.*`/`comments.*` tidak
  boleh lolos lewat `filterFilesByPreset` thread.
- **Cap komentar** default **2.000 node published**; urutan ikut API (`best_first`),
  tidak di-sort ulang di client. `maxComments` divalidasi integer 1..10.000; nilai
  invalid → default 2.000. Endpoint tidak punya pagination, jadi cap + guard byte
  dilakukan di client.
- **`automod_hidden_comments`** tidak dimasukkan; hanya dihitung di stats dan
  `errors.json`.
- **Avatar komentator** tidak di-download; HTML memakai inisial. Nama/handle/photoUrl
  tetap ada di `comments.json`.
- **Akses (ambil seadanya, tanpa klaim kelengkapan):** arsip selalu mengikuti sesi
  login tab — tidak ada yang dipotong atau dilewati; penanda hanya menggambarkan
  apa yang terlihat, bukan menjamin kelengkapan. Dua field:
  - `post.access`: `"open"` (konten publik, `audience === "everyone"`) atau
    `"session"` (konten berbayar/gated — diarsipkan seadanya sesuai sesi login saat
    ini; kalau user login + berbayar, body penuh dan komentar ikut apa adanya).
  - `post.bodyTruncated`: `true` = **ada bukti** konten terpotong (marker DOM `.paywall`
    ada, ATAU audience berbayar + `wordcount > 0` + rasio kata body/`wordcount` <
    0,9); `false` = `audience === "everyone"` dan body ada; `null` = tidak bisa
    dipastikan (body kosong, atau berbayar tanpa marker dan `wordcount` hilang).
    (Nama `bodyTruncated` — bukan `truncated` — supaya tidak tertukar dengan
    `comments.truncated` yang berarti kecap komentar.) `bodyRatio` selalu dicatat.
    **Tidak ada lagi** trichotomies `full`/`preview`/`unknown` yang bikin bingung —
    kita tidak pernah mengklaim "lengkap", hanya "terpotong" bila ada bukti.
  - Tampilan: warning "konten mungkin terpotong" hanya bila `bodyTruncated === true`;
    `access: "session"` + `bodyTruncated: null` → info ringan "diarsipkan sesuai
    sesi login" (tanpa warning, tanpa klaim); `open` → tanpa warning.
- **Cancel:** job-scoped; **artikel tetap di-ZIP sebagai partial hanya bila artikel
  sudah tersedia**; komentar ditandai `cancelled`. Cancel **sebelum artikel ada**
  (mis. saat fetch API artikel masih jalan → AbortController membatalkan): outcome
  terminal eksplisit `error` + `reason: "cancelled-before-article"` (lock lepas, tanpa
  ZIP — memang tidak ada yang bisa diarsipkan; popup menjelaskan ini), bukan ZIP
  kosong dan bukan `BUSY` menggantung. Job dengan artikel tetap **aktif** sampai
  download ZIP partial **complete** (`saveState: "saved"`), baru lock dilepas. Cancel
  tidak boleh membebaskan `BUSY` lebih awal; `interrupted` → `saveState: "failed"` +
  retry, result tidak dibuang.
- **Media origin allowlist + kebijakan response di `fetchBytes` (kontrak yang bisa
  ditegakkan):** hanya `substackcdn.com`/`*.substackcdn.com`, `*.substack.com`,
  `substack-post-media.s3.amazonaws.com`, dan origin publication. **URL awal** di luar
  allowlist → `unresolved: "external-origin"` **tanpa fetch**. `XMedia.fetchBytes`
  menerima opsi opsional `validateResponse(response)` yang dipanggil **setelah headers,
  sebelum body dibaca** (lempar → abort, byte aplikasi tidak dikonsumsi); default tanpa
  opsi = perilaku X persis seperti sekarang. Substack memakai policy: `response.url`
  final di luar allowlist → throw. **Residual risk yang diakui (bukan bisa ditegakkan
  sempurna):** `fetch` mengikuti redirect otomatis, jadi host di luar allowlist
  (termasuk host final) **bisa dihubungi sebelum** validasi final — mencegahnya butuh
  `webRequest` (permission baru, tidak diizinkan). Rumusan acceptance: "URL awal hanya
  allowlist (tanpa fetch bila tidak); response final di luar allowlist ditolak sebelum
  body aplikasi dibaca; redirect otomatis bisa menghubungi host di luar allowlist —
  residual risk tercatat di README + `errors.json` (`redirect-hop`)" — jangan pernah
  mengklaim "nol request ke luar allowlist".
- **Escaping semua field non-HTML (HTML **dan** Markdown, per konteks):**
  - HTML: `renderSubstackHtml`/`renderCommentsHtml` memakai `escapeHtml` (pola
    `src/export-html.js`) untuk judul, nama, body komentar, caption, alamat, dan
    placeholder embed.
  - Markdown teks polos: `escapeMarkdownText` — escape backslash **dulu**, lalu
    delimiter (`*`, `_`, `` ` ``, `[`, `]`, `<`, `>`), dan konstruk blok pada awal
    baris (`#`, `>`, `-`, `+`, `*`, fence backtick **dan** tilde `~~~`, ordered marker
    generik `N.`/`N)` untuk N apa pun, `---`, `===` setext, indentasi awal ≥ 4 spasi
    atau tab yang di-expand dulu) supaya body komentar tidak bisa menyuntik
    heading/list/thematic break/code block.
  - Markdown multiline (body komentar per baris): escape tiap baris termasuk konstruk
    blok di awal baris (daftar yang sama dengan teks polos, termasuk `~~~`, `N.`/
    `N)` generik, dan indentasi tab/spasi); pertahankan struktur tree (indentasi) yang
    dibangun renderer.
  - Link label: aturan teks polos **plus** `[`/`]`.
  - **Tabel GFM:** sel selalu di-escape (aturan teks polos + `|` → `\|`); karakter
    baris (`\n`) di sel diubah jadi `<br>`; fixture sel `a|b`.
  - **Code span:** delimiter backtick berjumlah `n` = run backtick terpanjang di
    dalam isi + 1; **cabang padding spasi** hanya bila isi diawali **dan** diakhiri
    spasi **dan** isi mengandung karakter non-spes CommonMark tidak meng-strip spasi
    batas untuk isi yang seluruhnya spasi — jadi `" "`/`"  "` **tidak** dipadding);
    cabang terpisah: isi diawali/diakhiri backtick → padding supaya run tidak
    menyatu. Fixture: kode berisi/mulai/akhiri backtick, `" a "`, `" "`, `"  "` —
    assert **teks kode hasil render identik** dengan input (bukan cuma substring).
  - **Code fence:** fence **backtick** atau **tilde** sepanjang ≥ 3 dan lebih panjang
    dari fence internal terpanjang (bukan `#` — itu heading); fixture kode berisi
    ``` fence dan `~~~`.
  - Link destination (URL dari data): `encodeMarkdownDestination` — hanya
    `http(s)`/`mailto`, encode spasi/`<`/`>`/`(`/`)` yang tidak aman, bungkus dalam
    `<...>`; URL yang gagal validasi → tampilkan sebagai teks biasa, jangan link.
    Fixture: `https://x.example/)[forged](https://evil.example/)` tidak menghasilkan
    link kedua.
  - Elemen yang dibangun renderer (anchor footnote, link gambar lokal) tetap mentah
    karena itu output tepercaya. Test fixture jahat untuk **kedua** renderer, per
    konteks: body `<img onerror=...>`, `**bold**`, `[x](javascript:...)`, `# heading`,
    `- list`, `---`, sel tabel `a|b`, kode dengan backtick/fence, nama
    `</a><script>` → tidak pernah menjadi markup/struktur rusak; anchor/link buatan
    renderer tetap berfungsi.
- **Footnote/ID:** sanitizer mempertahankan `id` pada **semua elemen yang dipertahankan**
  (termasuk `h1-h6`, `p`, `li`, `sup`, `span`, `a`) yang match
  `^[A-Za-z][A-Za-z0-9_-]{0,63}$`, diprefix `arsip-`; `href="#x"` di-rewrite ke
  `#arsip-x` bila targetnya ada. Tabrakan `id` deterministik: yang pertama menang,
  sisanya dibuang + dicatat. Wrapper yang dibuang memindahkan `id` ke elemen
  pengganti. Fragment link yang targetnya tidak ada dibuang. Di Markdown, target yang
  dipertahankan dieksplicit sebagai anchor `<a id="arsip-x"></a>`. **Verifikasi memakai
  input sebagai rujukan:** parse body mentah → kumpulkan pasangan reference→target
  internal → assert setiap pasangan itu ada di `post.md` **dan** `post.html` (atau
  dicatat sebagai dropped dengan alasan); nol referensi + nol target **tidak** bisa
  lulus.
- **Diagnostics:** `scrapeArticle` mengembalikan `errors[]`; content meneruskannya;
  `ArticleSnapshot.errors` menyimpan `{ scope, reason, detail }`; `errors.json` dibangun
  dari situ + media/embeds/access. `POST_IDENTITY_MISMATCH`, `markdown-fallback`,
  `declared-mismatch`, `external-origin`, dan `external-embed` tidak boleh hilang di
  transport.

**Kontrak baru (`ArticleSnapshot`, ringkas):**

```js
{
  site: "substack",
  sourceUrl, scrapedAt,
  post: {
    id, slug, title, subtitle, canonicalUrl, publishedAt,
    identity: "preloads" | "api",
    author: { name, handle, photoUrl },
    publication: { name, subdomain, customDomain },
    audience: "everyone" | "only_paid" | "founding" | "unknown",
    access: "open" | "session",
    bodyTruncated: boolean | null,
    bodyRatio: number | null,
    bodyHtml,            // canonical: tersanitasi (dipakai renderer HTML)
    bodyHtmlSource,      // original mentah dari API/preloads; TIDAK pernah dirender
    bodyMarkdown, bodyText,
    wordcount: number | null,
    reactionCount: number | null,
    commentCountDeclared: number | null,
    tags: string[], audioUrl: string | null, podcastUrl: string | null
  },
  comments: {
    included,
    state: "captured" | "empty" | "restricted" | "unavailable" |
      "cancelled" | "too_large",
    reason: string | null,
    order: "api",
    declared: number | null,
    published: number | null, captured: number | null,
    topLevel: number | null, maxDepth: number | null,
    filtered: { total: number | null, byStatus: Record<string, number> } | null,
    promoted: number | null, automodHidden: number | null,
    truncated: boolean | null, dropped: number | null,
    mismatch: number | null,
    duplicates: number | null,
    items: CommentNode[]
  } | null,
  media: [{ id, url, type: "photo", localPath, mime, bytes, alt, caption,
    unresolved }],
  embeds: [{ url, provider, unresolved: "external-embed" }],
  errors: [{ scope: "article" | "comments" | "media" | "embeds" | "access",
    reason, detail }]
}
```

`CommentNode`: `{ id, parentId, originalParentId, depth, author: { name, handle,
photoUrl, isAuthor }, date, editedAt, body, likes: number | null,
restacks: number | null, replyCount: number | null, pinned, reparentedFrom, url,
children[] }`. Field yang tidak ada di API = `null`/kosong; render sebagai `—`,
bukan `0`.

Definisi statistik (dipakai di acceptance + fixture; beku dari fixture
`tests/fixtures/substack-comments-tomas.json` + expected
`tests/fixtures/substack-comments-tomas-expected.json`, bukan angka hidup):

- `declared` = `post.commentCountDeclared`; `null` kalau field tidak ada (bukan `0`).
- `published` = jumlah **ID unik** published setelah filter + dedupe, sebelum cap.
  (Node duplikat tidak menggandakan populasi; `duplicates` dihitung terpisah.)
- `captured` = jumlah node di tree **normalized + capped**.
- `topLevel` = jumlah root di tree normalized + capped.
- `maxDepth` = kedalaman maksimum tree normalized + capped (root = 0).
- `filtered.total` = jumlah node unik yang difilter; `byStatus` = status primer
  (`deleted`, `blocked`, `moderator_removed`, `suppressed` bila status kosong).
- `promoted` = jumlah node published yang di-reparent dari parent yang difilter.
- `automodHidden` = `automod_hidden_comments.length`.
- `truncated` = `captured < published`; `dropped` = `published - captured`.
- `mismatch` = `declared - published` **hanya bila `declared !== null`**; `null` bila
  `declared` tidak ada. Tidak pernah mengklaim sebab.
- **Statistik yang tidak pernah diamati** (state `unavailable`/`cancelled`, atau
  `too_large` dengan `reason` selain `"zip-budget"` — raw memang tidak pernah
  diproses): `published`, `captured`, `topLevel`, `maxDepth`, `filtered`, `promoted`,
  `dropped`, `truncated`, `mismatch`, `duplicates` = **`null`**, bukan `0`. Render
  sebagai `—`. **Pengecualian `too_large` + `reason: "zip-budget"` (Stage B):**
  observasi sudah terjadi, jadi `published`/`filtered`/`promoted`/`duplicates`
  mempertahankan angka observasi, sementara `captured: 0`, `truncated: true`,
  `dropped: published`, `topLevel`/`maxDepth` dihitung ulang dari retained (0);
  observasi pra-drop dicatat di `errors.json` (`observedCaptured`).
- `duplicates` = jumlah kemunculan ID duplikat yang dibuang. Kebijakan dedupe:
  **traverse semua kemunculan**; node dipertahankan pada kemunculan pertama, tapi
  children dari kemunculan berikutnya tetap di-traverse dan di-merge (di-dedupe
  rekursif) — jangan buang balasan published yang unik hanya karena parent-nya
  duplikat. **Pencegahan siklus (wajib):** selama DFS, jaga himpunan `ancestors`
  (id pada jalur dari root ke node sekarang); bila ID kemunculan ∈ `ancestors`, edge
  itu **dibuang** (jangan pernah menyimpan anak ke leluhurnya), children published-nya
  dipromosikan ke parent terdekat yang bukan leluhur (atau root), dan kejadian ini
  dihitung di `duplicates` — hasil normalisasi dijamin DAG. `parentId` yang menunjuk
  ID tidak ada → perlakukan sebagai root, catat.
- `author.isAuthor` = `metadata.is_author === true`; field API yang tidak ada
  (`likes`, `restacks`, `replyCount`, `date`, dll) = `null` (bukan `0`); render `—`.
- `url` = `<canonical>/comment/<id>` (sudah diverifikasi 200 di Substack).
- `originalParentId` = parent dari tree mentah; `parentId` = parent setelah reparent.
- Normalisasi Tomas (fixture beku, tree 1.050 node mentah): `published 1045`,
  `captured 1045`, `topLevel 727`, `maxDepth 8`, `filtered.total 5` (`deleted 1`,
  `blocked 3`, `moderator_removed 1`), `promoted 6`, `dropped 0`, `truncated false`,
  `duplicates 0`. `declared 1061` dan `mismatch 16` berasal dari payload live; kalau
  live drift, catat angka aktual + mismatch, jangan gagalkan unit test.
- `maxComments` validasi: integer 1..10.000, default 2.000; non-integer/negatif/
  >10.000 → default 2.000.

**Dependency graph (Phase 8):**

```
SubstackDetect.probe + SUBSTACK_INJECTION + ArticleSnapshot (T19)
    │
    ├── popup probe/inject + job identity + post.json/post.md dasar (T19)
    │        └── Checkpoint: Injection + article JSON
    │
    ├── sanitasi body + converter MD/HTML + media CDN + ZIP (T20)
    │        └── Checkpoint: Article slice
    │
    └── comments fetch + normalize/reparent/cap + render (T21)
             └── Checkpoint: Comments
                     │
                     └── popup UX + docs + regression + manual E2E (T22)
                              └── Checkpoint: Complete
```

Critical path: T19 → T20 → T21 → T22. T20 dan T21 tidak paralel penuh karena sama-sama
menyentuh `post.md`/`post.html`; modul `substack-comments.js` + fixture bisa disiapkan
paralel dengan T20, tapi integrasinya setelah T20.

## Task 19: Deteksi Substack + inject on-demand + artikel → ZIP pertama

**Description:** Bangun jalur Substack pertama yang utuh: popup memprobe tab aktif,
meng-inject adapter saat user klik, content script mengambil artikel dari
`preloads-json` atau API, background merender `post.json` + `post.md` dasar, lalu ZIP
di-download. Belum ada komentar, belum ada fetch media, belum ada HTML offline. DOM
hanya dipakai sebagai marker deteksi, bukan sumber body.

Detail:

- `src/sites/substack-detect.js` (classic, IIFE, idempotent) → `globalThis.SubstackDetect`:
  - `readPreloads(doc)` parse `script#preloads-json`; return `null` bila tidak ada/JSON
    rusak.
  - `normalizePath(path)` buang trailing slash; `postSlug(path)` ambil `/p/<slug>`.
  - `probe(doc, href)`:
    - `currentPath` wajib `/p/<slug>`; selain itu `{ ok: false, reason: "not-a-post" }`.
    - `preloads.post` valid bila `id` numerik dan `canonical_url` path == `currentPath`.
      Return `{ ok: true, stale: false, postId, slug, title, canonicalUrl,
      publication }`.
    - Bila `preloads.post` ada tapi canonical beda → `{ ok: true, stale: true, slug:
      currentSlug, reason: "stale-preloads" }`; adapter wajib fetch API.
    - Bila preloads tidak ada tapi marker DOM `article.newsletter-post` +
      `.post-title` ada → `{ ok: true, stale: true, identity: "dom", slug:
      currentSlug, reason: "dom-detect-only" }`. Ini **hanya deteksi**, bukan sumber
      artikel: adapter tetap wajib mengambil body dari API.
    - Bila tidak ada marker apa pun → `{ ok: false, reason: "no-post-markers" }`.
  - `detectAccess({ audience, bodyHtml, wordcount, domHasPaywall })` →
    `{ access, bodyTruncated, bodyRatio }` (precedence tegas, tanpa klaim
    kelengkapan):
    - `access`: `audience === "everyone"` → `"open"`; selainnya → `"session"`.
    - `bodyTruncated`:
      - `domHasPaywall` true → `true` (bukti marker).
      - Audience berbayar + `wordcount > 0` + rasio kata body/`wordcount` < 0,9 →
        `true`.
      - `audience === "everyone"` + body ada → `false`.
      - Body kosong, atau berbayar tanpa marker + `wordcount` hilang → `null`.
    - `bodyRatio` selalu dihitung bila ada body + wordcount, selain itu `null`.
    - Contoh hasil: free penuh → `open`/`false`; anonymous berbayar terpotong →
      `session`/`true`; subscriber penuh (tanpa marker, rasio ≥ 0,9) →
      `session`/`null` (info "sesuai sesi login", tanpa warning).
- `src/sites/substack-adapter.js` (classic, IIFE) → `globalThis.SubstackAdapter`:
  - `scrapeArticle({ includeComments: false })` → `{ article, media: [], comments: null,
    embeds: [], errors: [] }`.
  - Resolusi identitas (fetch API pakai timeout **30 dtk** + `signal` dari
    AbortController job; `validateResponse` cek final-URL same-origin sebelum body
    dibaca — sama seperti media):
    1. `preloads.post` hanya bila canonical path == current path → `identity:
       "preloads"`.
    2. Selain itu `GET /api/v1/posts/{currentSlug}` same-origin; verifikasi response
       `slug`/`canonical_url` == current path → `identity: "api"`. Ini jalur stale SPA
       dan preloads-absen. Timeout/abort/gagal → lanjut ke langkah 3.
    3. Selain itu throw `POST_IDENTITY_MISMATCH` dengan pesan actionable ("reload
       halaman / pastikan URL post benar"). **DOM tidak dipakai sebagai sumber body**;
       tidak ada jalur `identity: "dom"`.
  - Field: `id`, `slug`, `title`, `subtitle`, `canonicalUrl`, `publishedAt`,
    `audience`, `wordcount`, `bodyHtml` (mentah dulu), `bodyText` (teks blok),
    `author` dari `post.publishedBylines[0]`/`pub.author_name`, `publication` dari
    `preloads.pub`, `access`/`bodyTruncated`/`bodyRatio` (hasil `detectAccess`),
    `reactionCount`, `commentCountDeclared`, `tags` dari
    `post.postTags`, `audioUrl`/`podcastUrl`.
  - Tidak ada fetch komentar dan tidak ada fetch media di task ini.
- `src/substack-content.js` (classic, IIFE) — listener khusus Substack, pemilik state
  job:
  - State `job = { jobId, documentToken, postId, sourceUrl, options, state,
    cancelRequested, progress, result, errors, saveState, saveStartedAt, attemptId,
    expectedFilename, downloadId, jobGeneration, retired }` + `AbortController` capture
    di module scope. `documentToken` = acak saat `SCRAPE_START` pertama di dokumen
    ini. `saveState` ∈ `idle | saving | saved | failed`.
    `globalThis.__arsipSubstackContent = { version: 1 }` supaya inject ulang tidak
    mendaftarkan listener kedua.
  - **Dua record document-scoped yang TERPISAH dari `job`:**
    - `pendingAttempts[]` — attempt submitted yang belum direkonsiliasi, dibuat oleh
      `SAVE_SUBMIT` (sebelum invocation), diisi `downloadId` oleh `DOWNLOAD_STARTED`,
      dihapus setelah outcome direkonsiliasi. **`SCRAPE_START`/invalidasi tidak
      menghapus record ini.** Identitas lengkap per record: `{ jobId, documentToken,
      attemptId, saveStartedAt (immutable, salinan dari klaim), submittedAt,
      downloadId: number|null, expectedFilename, sourceUrl, savePhase, invalidated
      (monotonic), invalidatedAt }`.
    - `diagnostics[]` — diagnostic pasca-download (mis. `downloaded-after-invalidation`
      dengan `attemptId`/`downloadId`/`at`), **dipertahankan terpisah dari job
      aktif dan dari pending yang sudah clear**: tidak dihapus oleh rekonsiliasi,
      START baru, atau invalidasi; hanya dibersihkan oleh kebijakan eksplisit
      (FIFO maks 20 entri per dokumen; dokumen reload/navigasi = record hilang
      alami). Inilah yang membuat diagnostic tetap terlihat popup setelah
      reconcile → START B → close/reopen popup.
  - **State job:** `article | comments | media | finishing | ready | error | idle`.
    Non-terminal (memegang `BUSY`): `article`, `comments`, `media`, `finishing`, dan
    `ready` dengan `saveState !== "saved"`. **Terminal** (lock lepas, `SCRAPE_START`
    baru boleh jalan tanpa reload): `error` (capture gagal permanen:
    `POST_IDENTITY_MISMATCH`, `POST_NOT_FOUND`, `ARTICLE_TOO_LARGE`,
    `ARCHIVE_TOO_LARGE`, atau invalidasi `tab-changed`), `idle` (awal / setelah
    `DISMISS` sah), dan `ready` dengan `saveState === "saved"` (job selesai
    tersimpan).
  - **Fencing generasi capture:** setiap job punya `jobGeneration` (increment di
    `SCRAPE_START` dan saat invalidasi). Pekerjaan async capture (article/comments/
    media) membawa `gen` + `AbortController` sejak awal; **setiap tulisan ke `job`**
    (progress, result, error) wajib memeriksa `gen === job.generation` && state
    non-terminal — kalau tidak, tulisan **dibuang**. Invalidasi/START baru membatalkan
    capture lama lewat AbortController, jadi callback telat dari job A tidak bisa
    menghidupkan result A atau menimpa job B. Test: A berhenti di tengah fetch →
    navigasi → invalidasi → START B → A resolve/reject → A dibuang.
  - **Validasi masukan + invalidasi navigasi:** abaikan pesan bila
    `sender.id !== chrome.runtime.id`. Sebelum menerima **pesan yang menyentuh job**
    (termasuk `SCRAPE_STATUS`) pada job yang **belum retired**, bandingkan
    `location.href` ternormalisasi dengan `job.sourceUrl` → mismatch (SPA navigation
    dengan dokumen yang sama, dll): **invalidate job saat itu juga** (state → `error`
    + `reason: "tab-changed"`, result dibuang, lock lepas, `job.retired = true`
    **membuang binding `sourceUrl` lama**, AbortController capture dibatalkan) lalu
    balas `SCRAPE_ERROR { code: "TAB_CHANGED" }` / STATUS dengan state terminal.
    **Flag invalidasi pending bersifat monotonic:** pada **setiap** guard pass, semua
    `pendingAttempts` unresolved yang `sourceUrl`-nya ≠ `location.href` saat ini
    ditandai `invalidated: true` + `invalidatedAt` — **tidak pernah di-reset** walau
    URL kembali ke nilai semula (riwayat invalidasi hidup di record, bukan di
    perbandingan URL terakhir). **Job retired tidak lagi memicu guard** (STATUS
    berikutnya tidak mengembalikan `TAB_CHANGED` berulang) dan **admission
    `SCRAPE_START` tidak dipengaruhi job lama** — START untuk post baru (atau post
    yang sama setelah kembali) selalu diuji terhadap `sourceUrl` request-nya sendiri,
    jalan tanpa reload (tidak ada `BUSY` permanen, tidak ada penolakan berulang).
    Semua balasan bound operation mengulang `jobId` + `documentToken` (echo binding;
    `PING`/`SCRAPE_STATUS` dikecualikan).
  - `PING` → `{ type: "PING", payload: { connected: true, caps: { media: true,
    zip: true, substack: 1 } } }`.
  - `SCRAPE_START` (bootstrap; payload `{ site, tabId, sourceUrl, postId, options }`):
    - State non-terminal → `SCRAPE_ERROR { code: "BUSY" }`. State `ready` belum
      tersimpan → popup menawarkan Save/`DISMISS` dulu; START baru setelah `idle`/
      `error`.
    - Buat `jobId` baru + `documentToken` baru; simpan `options` (immutable);
      state → `"article"`; **jawab sinkron** `SCRAPE_DONE { jobId, documentToken,
      state: "started", site, tabId }` (return `false`) lalu jalankan capture async.
      Selesai/tidak diamati lewat polling `SCRAPE_STATUS` (bukan respond kedua).
    - `saveState` diset `idle` untuk job baru; `attemptId`/`downloadId` direset.
  - `SCRAPE_STATUS` (discovery; payload `{ site, tabId }`, tokenless read-only):
    respond `{ jobId, documentToken, state, progress, options, sourceUrl, postId,
    resultAvailable: !!job.result, saveState, saveStartedAt, attemptId,
    expectedFilename, downloadId, errorCode, errorReason, errors, invalidated,
    postDownloadDiagnostics, pendingAttempts }`;
    state `"idle"` bila belum pernah job; `errorCode`/`errorReason`/`errors`
    dipersistensi dari outcome terminal (cancel-before-article, identity mismatch,
    oversize, tab-changed) supaya popup bisa menjelaskan setelah reopen;
    `invalidated: true` bila job baru saja di-invalidasi karena URL berubah;
    `postDownloadDiagnostics` dibaca dari record `diagnostics[]` document-scoped
    (bukan dari job, jadi tetap ada setelah START baru); `pendingAttempts` = salinan
    record `pendingAttempts[]` dengan identitas lengkap — **reconcile berjalan untuk
    tiap record ini independen dari `saveState` job saat ini** (job baru tidak boleh
    menyembunyikan attempt lama).
  - `BUILD_ZIP` (bound; payload `{ site, jobId, documentToken, attemptId, files }`):
    - Validasi `jobId`/`documentToken` (cek `location.href` vs `job.sourceUrl`
      lewat aturan invalidasi di atas); mismatch → `SCRAPE_ERROR { code: "JOB_LOST" }`.
    - **`attemptId` wajib masih aktif**; basi → `SCRAPE_ERROR { code:
      "STALE_ATTEMPT" }` (background batal sebelum `downloads.download` — revoke
      tidak pernah menghasilkan ZIP ganda).
    - Pakai `XMedia.buildZip` + `XMedia.bytesToBase64` (fungsi generik, nama
      historis); `return true`; respond async `SCRAPE_DONE { zipBase64, jobId,
      documentToken }`.
  - `GET_RESULT` (bound; payload `{ site, jobId, documentToken }`): balas
    `SCRAPE_DONE { payload, errors, options, jobId, documentToken }` bila cocok —
    **read-only, tidak mengklaim save**; mismatch → `JOB_LOST`.
  - `SAVE_RESULT` (bound; payload `{ site, jobId, documentToken }`): **klaim atomik** —
    `idle`/`failed` → `saving` + `saveStartedAt = Date.now()` + `attemptId` baru,
    balas `SCRAPE_DONE { claimed: true, attemptId, payload, errors, options, jobId,
    documentToken }`; `saving`/`saved` → balas `SCRAPE_DONE { alreadySaved: true,
    saveState, downloadId }`. Tidak ada dua save yang sama-sama melewati klaim.
  - `DISMISS` (bound; payload `{ site, jobId, documentToken }`): **hanya bila
    `saveState` `idle`/`failed`** (state `ready` yang belum save); `saveState:
    "saving"` → `SCRAPE_ERROR { code: "SAVE_IN_PROGRESS" }` (tidak boleh membuang
    result yang sedang di-download). Sah → buang `result`/`errors` → state `"idle"`;
    balas `SCRAPE_DONE { dismissed: true, jobId, documentToken }`.
  - `SCRAPE_CANCEL` (payload `{ site, jobId, documentToken }`): set
    `cancelRequested = true`; respond `SCRAPE_DONE { cancelled: true }` (ack). Job
    **tidak** berakhir sampai download ZIP partial complete.
  - `SAVE_SUBMIT` (bound; payload `{ site, jobId, documentToken, attemptId,
    sourceUrl, expectedFilename, downloadId: null }`): **sebelum invocation** —
    **admission first-time ketat:** jobId cocok dengan job aktif **dan** job tidak
    retired **dan** `attemptId` == attempt klaim saat ini **dan** `saveState ===
    "saving"` **dan** guard URL lolos → baru boleh membuat record; selain itu →
    `SCRAPE_ERROR { code: "STALE_ATTEMPT" | "JOB_LOST" }` dan **tidak ada record
    yang dibuat** (pesan basi/terlambat tidak boleh menghidupkan attempt yang sudah
    dicabut/digantikan). **Pengiriman duplikat** (record unresolved sudah ada untuk
    `jobId`+`attemptId` sama) → ack tanpa mereset identitas/phase/timestamp/
    `downloadId`; record yang sudah resolved tidak pernah dibuat ulang. Record =
    `{ jobId, documentToken, attemptId, saveStartedAt (salinan immutable dari klaim),
    submittedAt, downloadId: null, expectedFilename, sourceUrl, savePhase:
    "submission-pending", invalidated: false, invalidatedAt: null }`.
  - `MARK_INVALIDATED` (bound; payload `{ site, jobId, documentToken?, attemptId,
    observedUrl, reason }`): **tanpa guard URL** (justru pesan untuk kasus URL sudah
    berubah) dan tidak tergantung job aktif — cari record `pendingAttempts` yang
    cocok `attemptId` → set `invalidated: true` + `invalidatedAt` + `reason`
    (**monotonik, tidak pernah di-reset**), tulis-menulis ke proyeksi job bila cocok;
    tidak ada record cocok → tetap ack `{ invalidated: true }` (idempoten, tidak
    error). Balas `SCRAPE_DONE { invalidated: true, jobId, attemptId }`.
  - **Aturan tulis-menulis (write-through):** setiap submitted attempt punya **dua
    proyeksi** dari identitas yang sama: proyeksi di `job` (bila attempt masih job
    aktif) dan record di `pendingAttempts[]`. Setiap update (`downloadId`, phase,
    invalidated) **menulis ke keduanya bila keduanya ada**; setiap outcome terminal
    (`MARK_SAVED`/`SAVE_FAILED`/`DISMISS` attempt) **selalu menghapus record
    `pendingAttempts` yang cocok** (diagnostic pindah dulu ke `diagnostics[]` bila
    ada) — record tidak pernah tertinggal setelah outcome jelas, jadi save sukses
    tidak bisa terus-menerus di-reconcile. Reconcile bekerja pada **union yang
    dide-duplikasi per `{jobId, attemptId}`** (record pending = otoritatif untuk
    attempt terpisah; proyeksi job hanya bayangan saat aktif) — overlapping STATUS
    tidak menggandakan kerja.
  - `DOWNLOAD_STARTED` (payload `{ site, jobId, documentToken, attemptId,
    downloadId, filename }`): tulis-menulis ke proyeksi job aktif **dan** record
    cocok `jobId`+`attemptId` (`downloadId`, savePhase `submitted`, `filename`);
    tidak cocok keduanya → abaikan.
  - `MARK_SAVED` (payload `{ site, jobId, documentToken, attemptId }`): tulis-menulis
    (attempt aktif → `saveState: "saved"` idempoten; record cocok → resolved) lalu
    **hapus record cocok** dari `pendingAttempts[]`; tidak cocok → abaikan.
  - `SAVE_FAILED` (payload `{ site, jobId, documentToken, attemptId, terminal?,
    code? }`): attempt aktif → `terminal: true` → state `error` (terminal, lock
    lepas), selainnya → `saveState: "failed"` + reset `downloadId` (result tidak
    dibuang, retry boleh); record cocok → pindahkan diagnostic bila ada ke
    `diagnostics[]` lalu **hapus record**; tidak cocok → abaikan. Dipanggil
    background saat render/ZIP/download gagal, saat `ARCHIVE_TOO_LARGE` (terminal),
    atau saat rekonsiliasi gagal memenuhi tiga syarat reclaim.
- `src/sites/substack-scripts.js` (ESM): `SUBSTACK_DETECT_SCRIPT` dan
  `SUBSTACK_INJECTION` (urutan T19: detect → adapter → `vendor/jszip.min.js` →
  `src/media.js` → `src/substack-content.js`). Task 20 menyisipkan
  `src/sites/substack-article.js` sebelum adapter. Popup mengimpor daftar ini; jangan
  hardcode path di popup. Setiap file classic mengekspos `version: 1`.
- `src/media.js`: bungkus body dengan IIFE guard `if (globalThis.XMedia) return;`
  (behavior-preserving) supaya aman dieksekusi ulang. `fetchBytes` menerima opsi
  opsional `validateResponse(response)` yang dipanggil **setelah headers, sebelum
  stream dibaca** (throw → abort, byte tidak dikonsumsi) dan `signal` eksternal
  (AbortSignal capture) yang digabung dengan timeout controller internal (abort
  eksternal membatalkan saat headers maupun saat body dibaca); mengembalikan
  `finalUrl` (`response.url`) + `redirected`; default tanpa opsi = perilaku X tidak
  berubah. `vendor/jszip.min.js` diuji ulang dua kali; kalau vendor tidak idempotent,
  inject hanya bila `globalThis.JSZip` belum ada.
- `src/substack-model.js` (ESM): `createArticleSnapshot`, `validateArticleSnapshot`
  (id numerik, title fallback "Untitled", body tidak kosong, URL http(s)).
- `src/substack-export.js` (ESM): `renderSubstackJson(snapshot)` dan
  `renderSubstackMarkdown(snapshot)` versi dasar (judul, metadata, bodyText). Versi
  terstruktur menyusul di Task 20.
- `src/substack-presets.js` (ESM): `SUBSTACK_PRESET_FILES` matrix + `presetSubstackFiles(files,
  preset, custom)`; `media/*`, `media-manifest.json`, `errors.json`, `comments.json`
  selalu ikut; `llm` = `post.md`/`post.html`; `data` = `post.json`/`comments.csv`;
  `custom` = pilihan user di antara file text. Jangan pakai `filterFilesByPreset` dari
  `src/snapshot.js` (hanya mengenali `thread.*`).
- `src/background.js` (relay tipis, tanpa job state):
  - `src/messaging.js`: tambah `GET_RESULT`, `SAVE_RESULT`, `SAVE_SUBMIT`,
    `MARK_SAVED`, `DOWNLOAD_STARTED`, `SAVE_FAILED`, `DISMISS` ke `MESSAGE_TYPES` +
    `MessageType`; test vocabulary diperluas (lihat bawah); routing X/YouTube tidak
    berubah.
  - Listener me-route payload `site: "substack"` **sebelum** handler
    `lastProgress`/`lastResult` lama (jangan merge progress Substack ke state global).
    Pesan Substack **tanpa `tabId` eksplisit** → `SCRAPE_ERROR { code: "BAD_BINDING" }`;
    jangan pernah meneruskan ke "tab aktif" secara buta.
  - `readScrapeOptions` menerima `site: "substack"`, `includeComments`,
    `maxComments`, `tabId`, `sourceUrl`, `postId`, `preset`, `custom`.
  - `SCRAPE_START` Substack: validasi `tab.url` vs `sourceUrl` (normalisasi) →
    `chrome.tabs.sendMessage(tabId, ...)`; ack `{ jobId, documentToken, state:
    "started" }` diteruskan ke popup (capture selesai → polling STATUS).
  - `SCRAPE_STATUS` Substack: request tokenless `{ site, tabId }` → proxy ke tab;
    balasan memuat `documentToken`, `options`, `saveState`, `saveStartedAt`,
    `attemptId`, `expectedFilename`, `downloadId`, `pendingAttempts`,
    `postDownloadDiagnostics`. **Rekonsiliasi save adalah bagian dari handler STATUS
    ini** (entry point yang bisa dipanggil, bukan helper tersembunyi): background
    menjalankan logika reconcile untuk **tiap record di `pendingAttempts` (independen
    dari `saveState` job saat ini — attempt lama tetap direkonsiliasi walau job baru
    sudah START)** dan, bila balasan tab menunjukkan `saveState: "saving"` untuk job
    aktif, untuk attempt aktif itu juga (search by id / by `query: [jobId]` + filter
    kepemilikan + tiga syarat reclaim + cek invalidasi `pendingAttempt.sourceUrl`);
    hasil per record disertakan sebagai `reconcile: { action: "marked-saved" |
    "monitoring" | "failed" | "still-saving", downloadId?, jobId?, attemptId? }`
    dalam respons ke popup. Test menjalankan jalur ini lewat **runtime listener
    nyata** (bukan memanggil helper langsung), termasuk skenario attempt lama
    setelah START job baru.
  - **Validasi URL hanya untuk pesan dari popup** (`SCRAPE_START`, `SAVE_RESULT`,
    `SCRAPE_CANCEL`, `DISMISS` — semuanya membawa `sourceUrl`): `chrome.tabs.get(tabId)`
    + bandingkan URL ternormalisasi → beda → `SCRAPE_ERROR { code: "TAB_CHANGED" }`.
    Pesan internal background→tab (`BUILD_ZIP`, `GET_RESULT`, `DOWNLOAD_STARTED`,
    `MARK_SAVED`, `SAVE_FAILED`) **tidak membawa `sourceUrl` dan tidak divalidasi URL
    di background** — kontrolnya ada di content (invalidasi `location.href` vs
    `job.sourceUrl`). Teruskan `{ site, jobId, documentToken }` (+ `attemptId` untuk
    save messages); semua balasan bound di-echo dan dibandingkan; jangan simpan di
    memory worker (kecuali AbortController pipeline save yang sedang berjalan —
    state per-request, bukan state job).
  - **Save path (klaim dulu, baru render, fencing menyeluruh):** popup
    `SAVE_RESULT { site, tabId, jobId, documentToken, sourceUrl }` → validasi URL tab
    → **teruskan SAVE_RESULT yang sama ke tab** (content juga memvalidasi
    `location.href` vs `job.sourceUrl` sebelum klaim) → bila `claimed` (+ `attemptId`),
    render + preset dari `options` hasil klaim dengan **AbortController** yang
    didaftarkan untuk attempt ini (+ timer `SAVE_ATTEMPT_TIMEOUT_MS` 120 dtk yang
    berlaku **hanya fase pre-submission**: `rendering`/`commit-authorized`/
    `submission-pending`; timer dihentikan begitu `downloads.download()` dipanggil)
    → `BUILD_ZIP { attemptId }` →
    content memvalidasi attempt + URL + generasi (basi → `STALE_ATTEMPT` → batal) →
    hitung filename sekali (`substack-<subdomain>-<slug>-<YYYY-MM-DD>-<jobId>.zip`,
    sanitasi filesystem-safe) → **kirim `SAVE_SUBMIT { attemptId, sourceUrl,
    expectedFilename }` dan tunggu ack** (record `pendingAttempts` dibuat di content
    **sebelum** invocation) → **commit boundary: revalidasi abort + `tab.url` vs
    `sourceUrl` save + attempt** (gagal → tidak memanggil download) → **daftarkan
    observer `chrome.downloads.onChanged` untuk `downloadId` dulu (buffer event per
    id)** → **masuk fase `submission-pending` lalu `chrome.downloads.download()`
    langsung (tiga langkah sync, tanpa `await` di antaranya — timer pre-submission
    berhenti di invocation)** → kirim `DOWNLOAD_STARTED { attemptId,
    downloadId, filename }` (filename dibekukan di content) → rekonsiliasi langsung
    `search({ id })` (ZIP kecil bisa `complete` sebelum `DOWNLOAD_STARTED` sampai —
    event terbuffer + search menutup celah ini) → `complete` (dari buffer/search) →
    `MARK_SAVED` (idempoten). **Batal setelah `download()` dipanggil:**
    `chrome.downloads.cancel(downloadId)` lalu `search({ id })` → `complete` →
    `MARK_SAVED` (ZIP sudah ada; jangan retry), `interrupted` → `SAVE_FAILED`,
    `in_progress` → tunggu. Gagal render/ZIP/start sebelum commit → `SAVE_FAILED
    { attemptId }` (result tidak dibuang); `ARCHIVE_TOO_LARGE` (Stage B habis
    degradasi) → `SAVE_FAILED { attemptId, terminal: true, code }` → content state
    `error`. Balasan STATUS dengan `invalidated: true` (URL berubah) → batalkan
    AbortController pipeline ini. `GET_RESULT` tidak pernah dipakai untuk memulai
    save (read-only).
  - **Record attempt submitted dibuat SEBELUM invocation:** sebelum commit checks,
    background mengirim `SAVE_SUBMIT { jobId, documentToken, attemptId, sourceUrl,
    expectedFilename }` dan **menunggu ack** — baru setelah itu commit boundary +
    invocation. Content menyimpan record di `pendingAttempts[]` (identitas lengkap,
    `downloadId: null`) **terpisah dari `job`** (START baru / invalidasi capture
    **tidak** menghapus record ini); `DOWNLOAD_STARTED` mengisi `downloadId` belakangan.
    Jadi identitas recovery sudah ada di content sebelum `downloads.download()`
    dipanggil (worker mati tepat setelah invocation pun record tetap ada). Semua
    rekonsiliasi — termasuk yang jalan setelah worker mati dan **setelah START job
    baru** (loop `pendingAttempts` dari STATUS, independen dari `saveState` job;
    union dide-duplikasi per `{jobId, attemptId}`) — **invalidation-aware dengan
    urutan: (1) cek flag monotonic `pendingAttempt.invalidated` dulu (kalau `true`,
    tetap terinvalidasi WALAU `location.href` sudah kembali sama dengan
    `sourceUrl` — kembali ke URL lama tidak memulihkan validitas), (2) baru
    bandingkan `location.href` vs `pendingAttempt.sourceUrl`**: tidak terinvalidasi +
    cocok → `MARK_SAVED` biasa; terinvalidasi (baik lewat flag maupun URL beda) →
    `MARK_SAVED` **dengan** diagnostic `downloaded-after-invalidation`. Kandidat
    `in_progress` yang terinvalidasi → `cancel` + rekonsiliasi. Elapsed reclaim untuk
    record terpisah memakai **`pendingAttempt.saveStartedAt`** (salinan immutable dari
    klaim — bukan `saveStartedAt` job baru, bukan `submittedAt`), jadi attempt lama
    tetap bisa di-reclaim setelah START B (tidak ditunda selamanya oleh timestamp job
    baru). Diagnostic
    pasca-download **tidak** dimasukkan ke ZIP yang byte-nya sudah final — tujuannya:
    record document-scoped `diagnostics[]` → `SCRAPE_STATUS.postDownloadDiagnostics`
    → popup (bertahan lewat reconcile, START baru, dan popup reopen; FIFO 20/dokumen).
  - **Rekonsiliasi tanpa `downloadId`:** `chrome.downloads.search({ query: [jobId] })`
    — `query` bertipe `string[]`; **filter kepemilikan:** `byExtensionId ===
    chrome.runtime.id` **dan** `filename` mengandung `jobId` **dan** `endsWith(".zip")`
    (collision counter Chrome ` (1)` tidak merusak aturan); nama persis
    (`expectedFilename` dari STATUS) disukai tapi bukan syarat tunggal. Urutan
    (**semua invalidation-aware lewat `pendingAttempt.sourceUrl`**): ada `complete` →
    cek `location.href` vs `pendingAttempt.sourceUrl`: cocok → `MARK_SAVED`; beda →
    `MARK_SAVED` + diagnostic `downloaded-after-invalidation` (di content record →
    STATUS → popup; bukan ke ZIP yang byte-nya sudah final); tidak ada `complete` →
    `in_progress` terbaru → kalau tidak valid lagi → `cancel` + rekonsiliasi, kalau
    valid → monitor + kirim ulang `DOWNLOAD_STARTED`; selainnya (hanya `interrupted`
    lama) → **kandidat diabaikan untuk keperluan "kosong"** → `SAVE_FAILED` **hanya
    bila memenuhi tiga syarat reclaim**: elapsed > `SAVE_ABANDONED_MS` (60 dtk)
    **dan** worker ini tidak memegang pipeline in-flight **dan** dua kali search
    ber-jeda ≥ 1 dtk tanpa kandidat `complete`/`in_progress`. **Recovery tidak pernah
    menghancurkan pipeline yang hidup** — pipeline yang dipegang worker punya deadline
    `SAVE_ATTEMPT_TIMEOUT_MS` yang **hanya berlaku pre-submission** (fase
    `rendering`/`commit-authorized`/`submission-pending`) dan menghancurkan dirinya
    sendiri lewat itu; pasca-invocation tidak ada paksaan gagal. Filename yang sama
    hari **bukan** bukti job ini tersimpan; `jobId` penuh menjamin unik; kandidat
    `interrupted` attempt lama tidak mengunci reclaim attempt baru.
  - `DISMISS`: diteruskan ke tab; content menolak (`SAVE_IN_PROGRESS`) bila `saving`;
    kalau sah, state job kembali `idle`; lock lepas.
  - `SAVE_RESULT` membawa binding + `sourceUrl` lengkap; popup tidak mengirim
    `options` (ikut job), jadi recovery tidak bisa mengubah isi archive.
- `src/popup.js`:
  - `detectActiveSite()` — host X/YouTube lewat registry; selain itu inject
    `SUBSTACK_DETECT_SCRIPT` lalu jalankan `executeScript({ func: () =>
    globalThis.SubstackDetect.probe(document, location.href) })`. Simpan
    `{ site, tabId, sourceUrl, postId, stale }`.
  - Saat popup open, `SCRAPE_STATUS` (**tokenless discovery**: `{ site, tabId }`) dulu;
    kalau `state` aktif untuk tab yang sama, reconnect (polling + Cancel dengan
    `jobId` + `documentToken` dari STATUS) dan jangan mulai job baru.
    `saveState: "saving"` → popup cukup membaca `reconcile` dari handler
    `SCRAPE_STATUS` (background yang menjalankan search + filter kepemilikan +
    tiga syarat reclaim): `marked-saved` → selesai; `monitoring` → tunggu;
    `failed` → tawarkan retry; `still-saving` → tampilkan "masih menyimpan"
    (jangan mencabut save yang masih hidup). `resultAvailable` + `saveState`
    `idle`/`failed` → tawarkan "Lanjutkan download" (kirim `SAVE_RESULT` dengan
    binding + `sourceUrl`). `resultAvailable` + `saveState` `idle` (belum save) →
    tawarkan Save atau **Dismiss** (kirim `DISMISS`; ditolak `SAVE_IN_PROGRESS`
    bila `saving`) untuk melepas lock tanpa download.
  - Klik Download: re-probe; kalau `tab.url` beda dari cache, buang cache. Panggil
    `ensureSubstackInjected(tabId)` lalu kirim `SCRAPE_START` dengan `site`, `tabId`,
    `sourceUrl`, `postId`, `options`. **Ack langsung** berisi `jobId` +
    `documentToken` (dipakai untuk Cancel saat capture berjalan); selesai/tidaknya
    diamati lewat polling STATUS.
  - `ensureSubstackInjected(tabId)`:
    1. `PING` untuk memastikan koneksi — **tidak** dipakai sebagai shortcut
       "semua siap": capability yang diiklankan listener tidak membuktikan dependency
       ada.
    2. Selalu jalankan `executeScript({ func: () => ({ detect:
       globalThis.SubstackDetect?.version, adapter:
       globalThis.SubstackAdapter?.version, article:
       globalThis.SubstackArticle?.version, media: !!globalThis.XMedia,
       zip: !!globalThis.JSZip, content: !!globalThis.__arsipSubstackContent }) })`.
    3. Inject hanya file yang globalnya belum ada, urut `SUBSTACK_INJECTION`;
       `substack-content.js` terakhir. Partial injection (content ada, adapter hilang)
       → inject adapter saja; semua file idempotent. Ulang PING setelah inject.
- `src/popup.html`: tambah checkbox `includeComments` (hidden untuk X/YouTube) dan
  input `maxComments` di Advanced (hidden untuk X/YouTube). Task 22 merapikan tampilan;
  task ini cukup wiring.

**Acceptance criteria:**
- [ ] Probe `true` di 3 publication: satu `*.substack.com`, dua custom domain
  (`unchartedterritories.tomaspueyo.com`, `www.thefp.com`/`www.slowboring.com`).
- [ ] Probe `false` di `/archive`, homepage publication, `/about`, dan situs non-Substack.
- [ ] Probe `true` + `stale: true` saat `preloads.post` beda dengan URL aktif; download
  memakai `/api/v1/posts/{slug}` dan menghasilkan post yang benar.
- [ ] Klik Download di post Substack menghasilkan ZIP
  `substack-<subdomain>-<slug>-<date>-<jobId>.zip` (jobId penuh, unik per capture;
  slug dipotong agar total ≤ 200 karakter):
  preset `llm` berisi `post.md` + sidecar wajib; preset `data` berisi `post.json` +
  sidecar wajib (acceptance dijalankan per preset, bukan menggabungkan keduanya).
- [ ] Skema pesan (tiga kelas, ada test positif untuk tiap kelas): `PING` =
  bootstrap tanpa job (response `{ connected, caps }`, dikecualikan echo);
  `SCRAPE_START` = bootstrap tanpa binding (ack berisi binding baru + echo
  `site`/`tabId`); `SCRAPE_STATUS` = discovery tokenless (dikecualikan echo);
  semua operasi **bound** membawa `site` + `jobId` + `documentToken` (+ `sourceUrl`
  dari popup untuk pesan popup-originated) dan **hanya balasan bound** yang
  meng-echo binding untuk dicocokkan background; save messages membawa `attemptId`.
- [ ] Pesan Substack tanpa `tabId` → `BAD_BINDING` (tidak diteruskan ke tab aktif
  secara buta); pesan tanpa `site` tetap jatuh ke jalur X/YouTube lama.
- [ ] `post.json` memuat id, slug, title, subtitle, canonical URL, author, publication,
  tanggal, audience, access, bodyTruncated, bodyRatio, bodyHtml, bodyText,
  commentCountDeclared.
- [ ] `post.md` dasar bisa di-upload ke ChatGPT dan menjawab "artikel ini tentang apa".
- [ ] Akses seadanya sesuai precedence `detectAccess`: free post body penuh →
  `access: "open"` + `bodyTruncated: false` (walau `wordcount` hilang); free post
  body kosong → `bodyTruncated: null`; anonymous berbayar terpotong (marker `.paywall`
  ATAU rasio < 0,9) → `access: "session"` + `bodyTruncated: true` + warning; subscriber
  penuh (berbayar, tanpa marker, rasio ≥ 0,9) → `access: "session"` +
  `bodyTruncated: null` (info "diarsipkan sesuai sesi login", **tanpa** warning,
  **tanpa** klaim kelengkapan); berbayar + `wordcount` hilang tanpa marker → `null`.
  Tidak ada field `full`/`preview`/`unknown` lagi.
- [ ] Buka popup dua kali / klik Download dua kali tanpa reload: tidak ada error
  "Identifier has already been declared"; tidak ada listener ganda; `SUBSTACK_INJECTION`
  dieksekusi dua kali di isolated world yang sama tetap sukses; state job tetap
  konsisten (tidak ada job kedua).
- [ ] Reload tab saat fetch: token dokumen berubah → `JOB_LOST`, bukan ZIP post yang
  salah. Pindah tab lain: `BUILD_ZIP` tetap ke tab job (tabId), bukan tab aktif.
- [ ] Terminasi service worker saat job jalan (chrome://serviceworker-internals atau
  DevTools), lalu buka popup: `SCRAPE_STATUS` dari tab masih menunjukkan job aktif;
  popup reconnect, bukan mulai job baru.
- [ ] Dua `SCRAPE_START` beruntun: yang kedua dapat `BUSY`; popup yang dibuka ulang
  reconnect ke job aktif dan bisa Cancel; setelah ZIP partial ter-download barulah
  job berakhir (tidak ada `BUSY` menggantung setelah cancel).
- [ ] Dua `SAVE_RESULT` beruntun / popup reopen saat `saveState: "saving"`: tidak ada
  ZIP ganda (klaim atomik; `GET_RESULT` tidak pernah mengklaim).
- [ ] Terminasi worker di **setiap** batas save: (a) setelah klaim sebelum render →
  recovery `downloads.search({ query: [jobId] })` + filter kepemilikan
  (`byExtensionId` + jobId di filename); belum lewat `SAVE_ABANDONED_MS` (60 dtk) →
  "masih menyimpan" (**tidak** `SAVE_FAILED`); lewat + tanpa pipeline in-flight +
  dua search tanpa `complete`/`in_progress` (kandidat `interrupted` lama diabaikan)
  → `SAVE_FAILED` → retry — termasuk skenario: attempt A pernah `interrupted`,
  retry B klaim, worker mati sebelum submit B → A **tidak** mengunci reclaim B;
  (b) setelah `download()` sebelum `DOWNLOAD_STARTED` → ketemu via query →
  `MARK_SAVED`/tunggu, tidak ada download kedua; (c) setelah `DOWNLOAD_STARTED` →
  via `search({ id })`. Tidak ada state `saving` yang menggantung tanpa jalan keluar.
- [ ] Popup reopen **saat save masih hidup**: pipeline dipegang worker → `reconcile:
  "still-saving"` (recovery **tidak pernah** menghancurkan pipeline hidup), tidak ada
  `SAVE_FAILED`, tidak ada klaim ulang; **deadline `SAVE_ATTEMPT_TIMEOUT_MS` 120 dtk
  hanya untuk fase pre-submission** (`rendering`/`commit-authorized`/
  `submission-pending`): pemilik pipeline menghancurkan sendiri → `SAVE_FAILED` →
  retry (attempt lama tidak pernah mencapai `downloads.download`, dicegah
  `STALE_ATTEMPT` di `BUILD_ZIP`); **setelah invocation (fase `submitted`) timer
  berhenti** — tidak memaksa gagal; id ditunggu lalu rekonsiliasi dulu (`complete` →
  `MARK_SAVED`, `interrupted` → `SAVE_FAILED`) sebelum retry; tidak ada ZIP ganda.
- [ ] Callback basi: `SAVE_FAILED`/`MARK_SAVED`/`DOWNLOAD_STARTED` dengan `attemptId`
  lama diabaikan setelah retry (attempt B tidak dirusak attempt A); `BUILD_ZIP`
  dengan attempt basi → `STALE_ATTEMPT`, download tidak pernah dimulai.
- [ ] Revoke **di dalam async boundary**: (a) saat ZIP sedang dibuat → content cek
  attempt + URL + generasi sebelum mengembalikan byte → `STALE_ATTEMPT`/`TAB_CHANGED`,
  byte tidak sampai ke download; (b) saat `downloads.download()` tertunda (mock
  menggantung) lalu revoke → begitu id ada → `chrome.downloads.cancel(id)` lalu
  **rekonsiliasi `search({ id })`**: `complete` → `MARK_SAVED` (ZIP sudah ada, tidak
  dianggap gagal, tidak ada retry/duplikat), `interrupted` → `SAVE_FAILED` — test
  khusus kasus completion mendahului resolusi `download()`; (c) reclaim tanpa
  `downloadId` memenuhi **tiga syarat** (elapsed > 60 dtk + tanpa pipeline in-flight
  + dua `search` tanpa `complete`/`in_progress` ber-jeda ≥ 1 dtk).
- [ ] **Navigasi saat save/ZIP berjalan (termasuk jendela cross-process yang
  didokumentasikan):** (a) navigasi di tengah pembuatan ZIP → content revalidasi URL
  sebelum kembalikan byte → byte tidak dikirim; (b) invalidasi setelah ZIP diterima
  background tapi sebelum commit → cek `tab.url` vs `sourceUrl` di commit boundary →
  download tidak dipanggil; (c) STATUS membalas `invalidated: true` → background
  membatalkan AbortController pipeline-nya; (d) **invalidasi di jendela antara
  validasi terakhir dan `download()`** (test deterministik: content meng-invalidasi
  setelah respons validasi terakhir, sebelum submit) → id tetap diterima → revalidasi
  pasca-id → `cancel` + rekonsiliasi: `interrupted` → dibuang, `complete` → diagnostic
  `downloaded-after-invalidation` **di content record → `SCRAPE_STATUS.
  postDownloadDiagnostics` → popup** (bukan `errors.json` ZIP yang byte-nya sudah
  final; tidak pernah "lolos diam-diam", tidak pernah dianggap gagal untuk retry).
  Janji yang dipegang: **setiap ZIP job terinvalidasi berakhir di "dibatalkan" atau
  "dicatat di STATUS", bukan diam-diam**.
- [ ] Rekonsiliasi **invalidation-aware setelah worker mati** (fixture gabungan:
  worker mati setelah invocation sebelum validasi pasca-id → navigasi dalam dokumen →
  buka popup): record `pendingAttempt` **dibuat oleh `SAVE_SUBMIT` sebelum invocation**
  (ack-nya jadi prasyarat commit; test worker mati tepat setelah invocation pun record
  sudah ada) dan bertahan terpisah dari capture job; `SCRAPE_STATUS` mengekspos
  `pendingAttempts` dengan identitas lengkap → reconcile berjalan **independen dari
  `saveState` job** (kasus: A submitted → worker mati → navigasi → START B → STATUS →
  reconcile A tetap jalan, untuk kandidat `complete` **dan** `in_progress`, tanpa
  mengubah job B); kandidat `complete` di-check (flag monotonic dulu, lalu
  `pendingAttempt.sourceUrl`) → terinvalidasi → `MARK_SAVED` + diagnostic;
  `in_progress` terinvalidasi → `cancel` + rekonsiliasi; pesan terminal di-routing ke
  record yang cocok `jobId`+`attemptId`.
- [ ] **URL kembali ke nilai semula tidak memulihkan validitas:** A submit → navigasi
  (record A di-flag `invalidated`) → START B → kembali ke URL A → reconcile A **tetap
  terinvalidasi** (flag menang atas perbandingan URL): `complete` → `MARK_SAVED` +
  diagnostic, `in_progress` → `cancel` — test untuk kedua kandidat.
- [ ] **Write-through + tidak ada record tertinggal:** outcome terminal selalu
  menghapus record `pendingAttempts` yang cocok (save sukses → record hilang, tidak
  di-reconcile berulang, navigasi berikutnya tidak menghasilkan diagnostic palsu);
  update `downloadId` menulis ke proyeksi job **dan** record; reconcile memakai union
  dide-duplikasi `{jobId, attemptId}` (test STATUS ber-overlap tidak menggandakan
  kerja).
- [ ] **Admission `SAVE_SUBMIT` ketat:** jobId bukan job aktif / job retired /
    attemptId bukan attempt klaim aktif / `saveState ≠ saving` / guard URL gagal →
    `STALE_ATTEMPT`/`JOB_LOST` dan **tidak ada record dibuat**; pengiriman duplikat
    untuk record unresolved → ack tanpa reset identitas/phase/timestamp/`downloadId`;
    record resolved tidak dibuat ulang (test job retired + duplikat tertunda).
- [ ] **Timestamp reclaim terpisah:** A submit (ack) → worker mati sebelum invocation
  → START B → reclaim A memakai `pendingAttempt.saveStartedAt` (immutable) — elapsed
  dihitung dari klaim A, bukan job B; A tetap bisa di-reclaim setelah SAVE_ABANDONED_MS
  (tidak ditunda selamanya).
- [ ] Retensi diagnostic: reconcile A selesai → START B → tutup/buka popup →
  diagnostic A (`postDownloadDiagnostics`) **masih terlihat** (record `diagnostics[]`
  document-scoped, FIFO 20, tidak dihapus reconcile/START/invalidasi).
- [ ] Deadline terikat fase `savePhase`: kedaluwarsa **setelah `commit-authorized`
  tapi sebelum invocation** → `submission-pending` masih kena timer → self-abort
  `SAVE_FAILED`; kedaluwarsa **setelah invocation tapi sebelum id diterima** (promise
  `download()` tertunda) → **phase sudah `submitted`** (invocation = batas fase, id
  bukan) → timer mati → tunggu id → rekonsiliasi (`complete` → `MARK_SAVED`) → retry
  hanya setelah itu; test menegaskan phase + status timer yang sebenarnya. Tidak ada
  jalur yang memaksa gagal pada attempt yang sudah dipanggil.
- [ ] Fencing generasi capture: job A berhenti di tengah fetch → navigasi →
  invalidasi → `SCRAPE_START` job B → A resolve/reject → tulisan A **dibuang**
  (result/progress A tidak menghidupi dirinya sendiri atau menimpa B); AbortController
  A dibatalkan.
- [ ] Rekonsiliasi save punya entry point nyata: popup cukup membaca `reconcile`
  dari handler `SCRAPE_STATUS` (dijalankan lewat **runtime listener** di test, bukan
  helper langsung) → `marked-saved`/`monitoring`/`failed`/`still-saving`.
- [ ] `SCRAPE_STATUS` berulang setelah invalidasi lalu `SCRAPE_START` di URL baru:
  STATUS tidak mengembalikan `TAB_CHANGED` berulang (binding lama sudah retired) dan
  START diterima (admission START tidak dipengaruhi job lama) — tanpa reload.
- [ ] Fetch API artikel: timeout 30 dtk + abort; cancel sebelum artikel tersedia →
  outcome terminal `cancelled-before-article` (lock lepas, tanpa ZIP kosong, tidak
  `BUSY` menggantung); partial ZIP tetap dijanjikan hanya setelah artikel ada.
- [ ] Terminal failure (`POST_IDENTITY_MISMATCH`, `ARTICLE_TOO_LARGE`,
  `ARCHIVE_TOO_LARGE` via `SAVE_FAILED { terminal: true }`): state `error`, lock
  lepas; klik Download lagi **tanpa reload tab** memulai job baru (tidak `BUSY`
  permanen).
- [ ] `ready` dengan `saveState` `idle`/`failed`: popup menawarkan Save atau
  `DISMISS`; `DISMISS` melepas lock dan membuang result; `saveState: "saving"` →
  `DISMISS` ditolak `SAVE_IN_PROGRESS` (result tidak dibuang saat download berjalan).
- [ ] SPA navigation dengan dokumen yang sama (token tetap): pesan job berikutnya →
  **invalidasi** (state `error` + `tab-changed`, lock lepas) + `TAB_CHANGED`, lalu
  `SCRAPE_START` untuk post baru jalan **tanpa reload** (tidak `BUSY` permanen), bukan
  ZIP post yang salah.
- [ ] Download `interrupted`: `SAVE_FAILED` → `saveState: "failed"`, result tidak
  dibuang, retry menghasilkan ZIP; tidak ada `BUSY` menggantung dan tidak ada `saved`
  palsu.
- [ ] Halaman Substack non-post: pesan eksplisit "bukan post Substack", bukan error mentah.
- [ ] `src/messaging.js` menerima tipe baru (`GET_RESULT`, `SAVE_RESULT`,
  `SAVE_SUBMIT`, `MARK_SAVED`, `DOWNLOAD_STARTED`, `SAVE_FAILED`, `DISMISS`) tanpa
  memutus routing X/YouTube; `tests/manifest.test.js` (vocabulary coverage) diperluas
  agar mencakup listener di `SUBSTACK_INJECTION` (termasuk handler `DISMISS`/
  `SAVE_SUBMIT`) tanpa melonggarkan cek untuk listener klasik.
- [ ] Tidak ada permission baru; `host_permissions` tetap absen; tidak ada
  `content_scripts.matches` untuk Substack.
- [ ] Jalur X/YouTube tidak regresi.

**Verification:**
- [ ] `tests/e2e.test.js`: fixture `substack-post.html` + `substack-archive.html` +
  `substack-stale.html` di **origin HTTPS sintetis** (`page.route` +
  `https://pub.example/p/slug`) supaya guard `/p/` dan fetch same-origin valid — bukan
  `file://`. Probe, `scrapeArticle`, dan fallback API (stub `fetch`) jalan di Chromium
  nyata.
- [ ] `tests/substack-model.test.js`: validasi snapshot (id/title/body/URL).
- [ ] `tests/background-substack.test.js` + `tests/substack-content.test.js` (atau
  e2e): stub payload tab → `chrome.downloads.download` dipanggil dengan filename aman
  (jobId penuh) + `DOWNLOAD_STARTED` membawa filename (dibekukan di content); isi ZIP
  sesuai preset; kasus `BUSY`, `TAB_CHANGED` (invalidasi + binding retired + START
  baru tanpa reload, STATUS berulang tidak ditolak), `JOB_LOST`, `STALE_ATTEMPT`
  (termasuk saat ZIP sedang dibuat), `BAD_BINDING`, `SAVE_IN_PROGRESS`, klaim
  `SAVE_RESULT` idempoten, reconcile `SCRAPE_STATUS` lewat **runtime listener**
  (`marked-saved`/`monitoring`/`failed`/`still-saving` + `invalidated`), `downloads.search({ id })`
  dan `downloads.search({ query: [jobId] })` + filter kepemilikan (`byExtensionId` +
  jobId; collision counter ` (1)` diterima) + tiga syarat reclaim (kandidat
  `interrupted` lama diabaikan), `SAVE_ATTEMPT_TIMEOUT_MS` deadline **hanya fase
  pre-submission** (test: kedaluwarsa setelah `commit-authorized` sebelum invocation →
  gagal; setelah invocation sebelum id → tunggu + rekonsiliasi; recovery tidak
  menghancurkan pipeline hidup), `downloads.cancel` + **rekonsiliasi state terminal**
  (`complete` → `MARK_SAVED`, bukan gagal), **fixture gabungan worker mati +
  navigasi + recovery** (`SAVE_SUBMIT` ack = record sudah ada sebelum invocation;
  `pendingAttempts` bertahan lewat START baru + kandidat `complete` dicek
  `pendingAttempt.sourceUrl`; diagnostic `downloaded-after-invalidation` tetap terlihat
  di `SCRAPE_STATUS.postDownloadDiagnostics` setelah reconcile → START B → reopen,
  bukan di ZIP final), navigasi saat ZIP
  (content revalidasi URL sebelum byte; commit boundary `tab.url`), `attemptId`
  basi diabaikan, fencing generasi capture (job A telat resolve setelah invalidasi →
  dibuang), `SAVE_FAILED { terminal: true }` → state `error`,
  cancel-before-article → `cancelled-before-article`, `onChanged`
  `complete`/`interrupted` → `MARK_SAVED`/`SAVE_FAILED`, echo binding diverifikasi
  (bound saja; `PING`/`SCRAPE_STATUS` dikecualikan). Test menjalankan worker lewat
  listener nyata seperti `tests/background-video.test.js`.
- [ ] Abort media: `fetchBytes` menerima `signal` eksternal (digabung dengan timeout
  controller) → test abort saat headers dan saat body dibaca; signal capture
  dioperkan ke setiap fetch media; fetch API artikel/komentar juga abortable.
- [ ] Test vocabulary (`tests/messaging.test.js` + `tests/manifest.test.js`): tipe baru
  dikenal `createMessage`/`isMessage`; coverage diperluas ke listener di
  `SUBSTACK_INJECTION`; routing X/YouTube tidak berubah.
- [ ] `tests/substack-injection.test.js`: semua file di `SUBSTACK_INJECTION` ada,
  classic-safe (tanpa `import`/`export`), manifest tidak menambah host permission,
  simulasi eksekusi daftar dua kali tidak melempar redeclare, dan partial injection
  (mis. `SubstackAdapter` hilang tapi `__arsipSubstackContent` ada) menginjeksi file
  yang tepat.
- [ ] `npm run quality` + `npm test` hijau.
- [ ] Manual gate setelah task ini (sebelum Task 20): load unpacked, buka post Substack,
  klik Download dua kali, buka popup ulang, pindah tab saat fetch, reload tab saat
  fetch, terminasi service worker lalu buka popup, reload extension di tab lama, klik
  lagi — tidak ada redeclare, tidak ada listener ganda, tidak ada ZIP nyasar; cancel
  masih menghasilkan ZIP partial. Catat di
  `tasks/todo.md`.

**Dependencies:** None (Phase 7 sudah di `main`).

**Files likely touched:**
- `src/sites/substack-detect.js` (baru)
- `src/sites/substack-adapter.js` (baru)
- `src/sites/substack-scripts.js` (baru)
- `src/substack-content.js` (baru)
- `src/substack-model.js` (baru)
- `src/substack-export.js` (baru)
- `src/substack-presets.js` (baru)
- `src/media.js` (IIFE guard + `finalUrl`)
- `src/messaging.js` (tipe pesan baru)
- `src/background.js`, `src/popup.js`, `src/popup.html`
- `tests/e2e.test.js`, `tests/background-substack.test.js`,
  `tests/substack-content.test.js`, `tests/substack-model.test.js`,
  `tests/substack-injection.test.js`, `tests/substack-presets.test.js`
- `tests/fixtures/substack-post.html`, `tests/fixtures/substack-archive.html`,
  `tests/fixtures/substack-stale.html`

**Estimated scope:** Large (mekanisme injection baru + job identity + 3 classic script +
kontrak).

### Checkpoint: Injection + article JSON (Phase 8)

- [ ] Load unpacked: post Substack terdeteksi; ZIP per preset (`llm`: `post.md` +
  sidecar; `data`: `post.json` + sidecar) jadi
- [ ] Klik Download dua kali / buka popup ulang / reload extension: tidak ada redeclare
  atau listener ganda
- [ ] Reload tab / pindah tab saat fetch: `JOB_LOST`/`TAB_CHANGED`, tidak ada ZIP
  nyasar ke dokumen lain
- [ ] Terminasi service worker lalu buka popup: reconnect ke job di tab, bukan job baru;
  recovery `SAVE_RESULT` pakai `documentToken` dari STATUS
- [ ] Dua job beruntun: `BUSY` + reconnect; cancel tidak membebaskan lock sebelum
  download ZIP partial **complete**
- [ ] Halaman non-post ditolak eksplisit; preloads stale dijawab lewat API
- [ ] Review human sebelum exporter/media (Task 20)

## Task 20: Exporter artikel + media CDN + HTML offline

**Description:** Ubah body HTML Substack jadi dua representasi yang konsisten —
`bodyHtml` tersanitasi dan `bodyMarkdown` terstruktur — lalu download gambar dari
`substackcdn.com` ke `media/`, render `post.html` offline, dan lengkapi `post.json`.
Task ini menyelesaikan "article slice" sebelum komentar masuk.

Detail:

- `src/sites/substack-article.js` (classic, IIFE) → `globalThis.SubstackArticle`:
  - **Urutan wajib:** parse HTML inert → inventarisir `iframe`/`embed`/`object` +
    gambar → sanitasi → konversi Markdown. Embed harus diinventarisir **sebelum**
    elemennya dibuang.
  - **Lingkungan parse = properti yang diuji, bukan asumsi:** `DOMParser` dianggap
    inert hanya setelah dibuktikan. Test route-counter dengan fixture jahat
    (`<img src>` luar-allowlist, `<iframe>`, `srcset`, URL relatif, `<picture>`)
    wajib menunjukkan **nol request** selama parse+sanitize. Kalau Chrome ternyata
    memuat resource, fallback wajib: pre-strip atribut resource-bearing
    (`src`/`srcset`/`poster`/`background`/`style`/`href` eksternal) dengan pass
    string-level **sebelum** `DOMParser`, lalu ulangi test. Jangan pernah mengklaim
    "inert" tanpa bukti test ini.
  - `sanitizeBody(bodyHtml)` pakai `DOMParser`:
    - Allowlist tag: `h1-h6`, `p`, `ul`, `ol`, `li`, `blockquote`, `pre`, `code`,
      `table`, `thead`, `tbody`, `tr`, `th`, `td`, `figure`, `figcaption`, `a`, `img`,
      `picture`, `source`, `span`, `hr`, `br`, `strong`, `b`, `em`, `i`, `u`, `s`,
      `sup`, `sub`.
    - Allowlist atribut per tag: `a[href|title]` (hanya `http(s)`, `mailto`, `#`),
      `img[src|alt|width|height]`, `td/th[colspan|rowspan]`, `ol[start]`, dan `id`
      pada **semua elemen yang dipertahankan** (termasuk `h1-h6`, `p`, `li`, `sup`,
      `span`, `a`; format `^[A-Za-z][A-Za-z0-9_-]{0,63}$`). Atribut `id` diprefix
      `arsip-`; tabrakan `id` deterministik (pertama menang, sisanya dibuang +
      dicatat); `href="#x"` di-rewrite ke `#arsip-x` bila targetnya ada di container,
      dibuang bila tidak. Wrapper yang dibuang memindahkan `id` ke elemen pengganti
      (footnote target tidak hilang). Semua atribut lain dibuang — termasuk `style`,
      `srcset`, `sizes`, `poster`, `background`, `class`, dan `data-*` selain
      `data-arsip-*`.
    - `picture`/`source` diganti satu `img` terpilih; `iframe`/`embed`/`object` diganti
      placeholder link `[Embed: URL]` + masuk `embeds[]`; `script`, `style`, `form`,
      `input`, `button`, `svg` dibuang.
    - Tidak ada URL remote yang tertinggal di atribut yang memicu request otomatis
      (`src`, `srcset`, `poster`, `background`, `style`).
    - **Verifikasi berbasis input:** parse body mentah → kumpulkan pasangan
      reference→target internal → assert setiap pasangan ada di `post.md` **dan**
      `post.html` (atau dicatat dropped + alasan); nol referensi + nol target tidak
      bisa lulus; banyak referensi ke satu target sah. Tidak ada `id` unprefixed yang
      bocor.
  - `toMarkdown(container, mediaMap)` DOM walk: heading, paragraf, nested list,
    blockquote, code block, tabel GFM, link, gambar (local path bila ter-download,
    else URL asli + `[not downloaded]`), `figcaption`, footnote link, `hr`. Elemen
    dengan `id` yang dipertahankan dieksplicit sebagai anchor `<a id="arsip-x"></a>`
    (MD = artefak untuk LLM, anchor HTML diperbolehkan) supaya fragment `#arsip-x`
    punya target.
  - `toText(container)` fallback jika converter gagal; set
    `errors: [{ reason: "markdown-fallback" }]`.
  - `collectMedia(container)`: ambil `picture source[srcset]` terbesar / `img[src]`;
    dedupe URL; cap **40 gambar** dan **12 MB byte mentah** (base64 ~16 MB); assign
    `media/NNNN.<ext>`; simpan `alt`, `figcaption`, `bytes`. Gambar yang gagal/kelebihan
    → `unresolved` (`fetch-failed`, `media-cap`, `payload-too-large`, `unsupported-mime`).
  - `rewriteBody(container, mediaMap)`: pasang `data-arsip-media-id` + simpan URL asli
    di `data-original-src`; `post.html` mengganti placeholder dengan path lokal.
- `src/sites/substack-scripts.js`: sisipkan `src/sites/substack-article.js` **sebelum**
  `substack-adapter.js` di `SUBSTACK_INJECTION`; update test daftar file.
- `src/substack-content.js`: fetch media lewat `XMedia.fetchBytes` (timeout 30s,
  `maxBytes` 10 MB per gambar, **`signal` dari AbortController job** — abort membatalkan
  saat headers maupun body), concurrency 4, cek cancel di antara item; **sebelum
  fetch**, cek `allowedHost` (allowlist di keputusan phase); URL awal di luar
  allowlist → `unresolved: "external-origin"` tanpa fetch. Saat fetch, pakai opsi
  `validateResponse` yang dipanggil **setelah headers, sebelum body dibaca**:
  `response.url` final wajib allowlist; `response.redirected` dengan final di luar
  allowlist → throw (byte tidak dikonsumsi). Residual risk hop redirect tercatat di
  README/`errors.json` (lihat keputusan phase). Kirim
  `media[{ id, url, localPath, mime, bytes, base64, alt, caption, unresolved }]`.
  Tambah `image/svg+xml`/`image/avif` ke `MIME_EXTENSIONS` di `src/media.js` bila
  perlu.
- **Budget:** ikuti **Stage A** dan **Stage B** di keputusan phase ("Budget &
  degradasi — SATU definisi"). Jangan definisikan urutan baru di task ini. `fetchBytes`
  dipanggil dengan `maxBytes` per gambar yang menjaga media mentah ≤ 12 MB; envelope
  diukur UTF-8 byte; ZIP diukur byte file terdecode; semua degradasi diakhiri
  re-render sebelum `BUILD_ZIP`.
- `src/substack-export.js`:
  - **Escaping wajib di semua renderer** (konteks per type mengikuti keputusan phase
    "Escaping semua field non-HTML"): HTML memakai `escapeHtml` (pola
    `src/export-html.js`); Markdown memakai `escapeMarkdownText` per konteks (teks
    polos / multiline / label / destination via `encodeMarkdownDestination`) —
    anchor/link buatan renderer tetap mentah. URL yang dihasilkan divalidasi (hanya
    `http(s)`/`mailto`); selain itu tampilkan teks biasa, jangan link.
  - `renderSubstackHtml(snapshot)`: shell offline (inline CSS, tanpa script/font/remote),
    header metadata, body tersanitasi dengan gambar lokal, caption, embed sebagai link,
    warning "konten mungkin terpotong" (hanya bila `bodyTruncated === true`) + info
    "diarsipkan sesuai sesi login" (hanya bila `access === "session"` dan
    `bodyTruncated !== true`), placeholder komentar.
  - `renderSubstackMarkdown(snapshot)`: metadata + bodyMarkdown terstruktur + warning/
    info akses (aturan sama dengan HTML) + anchor footnote yang dipertahankan; teks
    tak-terpercaya lewat `escapeMarkdownText`.
  - `renderSubstackJson(snapshot)`: `post.json` final — `bodyHtml` = **tersanitasi**
    (canonical, satu-satunya field yang boleh dikonsumsi renderer HTML),
    `bodyHtmlSource` = original mentah (hanya untuk fidelity/re-processing, tidak
    pernah dirender), `bodyMarkdown`, `bodyText`, `media`, `embeds`, comments summary
    null.
  - `buildSubstackErrors(snapshot)`: `errors.json` dari `snapshot.errors` + bagian
    `access`, `media`, `embeds`, `article`; return `null` bila tidak ada masalah.
    `errors[]` snapshot berasal dari adapter + content dan wajib terbawa sampai ZIP
    (jangan hanya di-log di console).
- `src/background.js`: integrasi media manifest (`buildMediaManifest`), `errors.json`,
  preset dari matrix `src/substack-presets.js` (llm → `post.md` + `post.html`; data →
  `post.json` + `comments.csv`; custom → pilihan user; sidecar wajib ikut). ZIP tetap
  satu file.

**Acceptance criteria:**
- [ ] Struktur body terjaga di `post.md`: heading, paragraf, nested list, blockquote,
  code block, tabel GFM, figure + caption, link footnote.
- [ ] 28 gambar artikel Tomas: semua ter-download atau tercatat jujur di
  `media-manifest.json` dengan alasan (`fetch-failed`, `media-cap`, `payload-too-large`,
  `unsupported-mime`).
- [ ] `post.html` dibuka dengan **network aktif**: tidak ada request otomatis ke host
  mana pun (DevTools Network kosong), tidak ada script; gambar lokal tampil.
- [ ] `post.md` memakai path lokal untuk gambar yang berhasil; yang gagal memakai URL
  asli + penanda `[not downloaded]`.
- [ ] `post.json` memuat `bodyHtml` **tersanitasi** (canonical) + `bodyHtmlSource`
  (original, tidak pernah dirender), `bodyMarkdown`, `bodyText`, `media`, `embeds`.
- [ ] Akses mengikuti precedence `detectAccess` (bukan klaim tunggal): free + body
  penuh → `open`/`false` (walau `wordcount` hilang); free + body kosong → `null`;
  berbayar + marker `.paywall` → `session`/`true`; berbayar tanpa marker + ratio <
  0,9 → `session`/`true`; berbayar tanpa marker + ratio ≥ 0,9 → `session`/`null`;
  berbayar + `wordcount` hilang tanpa marker → `null`.
  `post.md`/`post.html` menampilkan warning "konten mungkin terpotong" **hanya** untuk
  `bodyTruncated: true`; `session` + `null` → info "diarsipkan sesuai sesi login"
  (tanpa warning); `open` → tanpa apa-apa; `bodyRatio` tercatat. Tidak ada field
  `full`/`preview`/`unknown`.
- [ ] Footnote (berbasis input): setiap pasangan reference→target internal di body
  mentah ada di `post.md` **dan** `post.html` (atau dicatat dropped + alasan); anchor
  Markdown `<a id="arsip-*">` ikut ter-emit; nol referensi + nol target tidak bisa
  lulus; tidak ada `id` mentah dari body yang bocor.
- [ ] Embed YouTube/Vimeo/Twitter/Datawrapper jadi link + `errors.json`
  `external-embed`; tidak ada iframe yang dieksekusi; embed tidak hilang karena
  sanitasi; `embeds` selamat dari transport (envelope) sampai `post.json`/ZIP.
- [ ] Gambar dengan **URL awal di luar allowlist** tidak pernah di-fetch (route
  counter nol request); fixture **`allowed → outside`** (final di luar allowlist) →
  response final **ditolak sebelum body aplikasi dibaca** + `unresolved` (catatan:
  request ke host final itu sendiri sudah terjadi — bagian dari residual risk di
  bawah); fixture **`allowed → outside → allowed`** → diterima validator (final
  allowlist) tapi **dicatat** `redirect-hop` di README + `errors.json`.
- [ ] Parse/sanitize dengan fixture jahat (img/iframe/srcset/relatif) → nol request
  network; kalau gagal, fallback pre-strip string-level aktif dan test tetap nol.
- [ ] Escaping: fixture jahat HTML (`<img onerror>`, `</a><script>`, `javascript:`)
  tidak pernah menjadi markup hidup; fixture jahat Markdown per konteks — `**x**`,
  `[x](javascript:...)`, `# heading`, `- list`, `1) item`, `7) item`, `text\n===`
  (setext), `~~~`, indentasi ≥ 4 spasi/tab, sel tabel `a|b`, kode dengan backtick di
  tepi isi + `" a "` + whitespace-only `" "`/`"  "` (teks kode hasil render identik
  dengan input), fence ``` internal, URL `...)[forged](...)` — tidak menyuntik
  struktur/rusak di `post.md`/`comments.md` (assert pada **output render**, bukan
  cuma substring), sementara anchor/link buatan renderer tetap berfungsi.
- [ ] Cap media: >40 gambar atau >12 MB → sisanya `unresolved`, ZIP tetap valid dan
  artikel tetap lengkap.
- [ ] Payload near-limit: media + artikel + komentar yang mendekati 24 MB/32 MB
  terdegradasi sesuai urutan (**ukur ulang envelope lengkap setelah tiap langkah**),
  tidak ada pesan yang gagal karena ukuran; artikel > 24 MB sendiri →
  `ARTICLE_TOO_LARGE`; artikel muat tapi envelope residu > 24 MB →
  `ENVELOPE_TOO_LARGE` (fixture batas); keduanya terminal, bukan hang.
- [ ] Egress (kontrak yang bisa ditegakkan; di Task 20 mencakup **media + fetch API
  artikel** — jalur komentar diuji di Task 21, ketiganya di gate Task 22): **URL
  awal** hanya ke allowlist (media) / same-origin (API); response dengan **final
  URL** di luar allowlist/origin ditolak sebelum body aplikasi dibaca; **redirect
  otomatis bisa menghubungi host di luar allowlist (termasuk host final)** = residual
  risk terdokumentasi (README + `errors.json`), bukan klaim nol — cek DevTools untuk
  membuktikan URL awal + perilaku final, jangan mengklaim tidak ada kontak luar.
  Test redirect terpisah untuk jalur media dan artikel di task ini.
- [ ] `errors.json` memuat `markdown-fallback` bila converter gagal dan `external-origin`
  bila ada gambar di luar allowlist.
- [ ] `post.md` lolos 3 probe ChatGPT: ringkasan, struktur, caption gambar.

**Verification:**
- [ ] `tests/e2e.test.js`: fixture `substack-body.html` → assert potongan MD/HTML
  (heading, list, table, figure, footnote, embed) + assert tidak ada `srcset`/`style`/
  `iframe` tersisa + **input reference→target** footnote terpenuhi di MD dan HTML.
- [ ] `tests/e2e.test.js`: route counter memastikan **parse/sanitize tidak memicu
  request network** dengan fixture jahat (img/iframe/srcset/relatif), dan
  `collectMedia` tidak mengambil host di luar allowlist (URL awal di luar allowlist →
  nol request). Dua fixture redirect terpisah: **`allowed → outside`** → final di luar
  allowlist dibatalkan sebelum body dibaca (assert byte body tidak dikonsumsi);
  **`allowed → outside → allowed`** → diterima + dicatat `redirect-hop` (residual
  risk), jangan berharap ditolak. Test redirect final-URL juga untuk jalur fetch API
  **artikel** (same-origin; redirect ke origin lain → abort) — jalur komentar diuji di
  Task 21.
- [ ] `tests/substack-export.test.js`: snapshot fixture → MD/HTML/JSON konsisten
  (`bodyHtml` tersanitasi + `bodyHtmlSource` original terpisah); escaping fixture
  jahat HTML **dan** Markdown (termasuk URL destination `...)[forged](...`, konstruk
  blok `#`/`-`/`---` di awal baris, backslash); `embeds` selamat dari envelope ke ZIP;
  preset matrix `llm`/`data`/`custom` benar.
- [ ] Manual: buka `post.html` dengan network aktif, cek 28 gambar + caption + Network
  kosong.
- [ ] Manual: upload `post.md` Tomas ke ChatGPT, 3 probe.
- [ ] `npm run quality` + `npm test` hijau.

**Dependencies:** Task 19.

**Files likely touched:**
- `src/sites/substack-article.js` (baru)
- `src/sites/substack-scripts.js`, `src/substack-export.js`, `src/substack-content.js`,
  `src/background.js`
- `src/media.js` (mime map + IIFE guard)
- `tests/e2e.test.js`, `tests/substack-export.test.js`,
  `tests/substack-injection.test.js`
- `tests/fixtures/substack-body.html`, `tests/fixtures/substack-article-snapshot.json`

**Estimated scope:** Large (sanitasi + converter + media + exporter).

### Checkpoint: Article slice (Phase 8)

- [ ] 3 publication menghasilkan ZIP artikel dengan preset `llm` (`post.md` + `post.html`)
  dan preset `data` (`post.json`); sidecar wajib ikut di kedua preset
- [ ] `post.html` dengan network aktif tidak melakukan request remote
- [ ] Akses mengikuti precedence `detectAccess`: free body penuh → `open`/`false`;
  free body kosong → `null`; berbayar + marker `.paywall` ATAU ratio < 0,9 →
  `session`/`true` (+ warning terpotong); berbayar tanpa marker + ratio ≥ 0,9 →
  `session`/`null` (info sesi login, tanpa warning); `bodyRatio` tercatat
- [ ] `post.md` Tomas lolos 3 probe ChatGPT
- [ ] Jalur X/YouTube tidak regresi
- [ ] Review human sebelum komentar masuk

## Task 21: Komentar lengkap + tree + CSV

**Description:** Ambil seluruh komentar yang bisa diakses dari same-origin API,
normalisasi jadi tree yang jujur (filter deleted/suppressed, reparent anak dari parent
yang difilter, cap 2.000), lalu render ke `post.md`, `post.html`, `comments.json`, dan
`comments.csv` (data preset).

Detail:

- `src/sites/substack-adapter.js` — `fetchComments(post, { maxComments, signal })`:
  - `GET /api/v1/post/{post.id}/comments?all_comments=true` dengan
    `credentials: "same-origin"`, `Accept: application/json`, timeout 30s +
    `signal` dari AbortController job; **`validateResponse` final-URL same-origin
    sebelum body dibaca** (redirect ke origin lain → abort → `unavailable`).
  - **Byte cap saat membaca body**, bukan hanya `content-length`: baca
    `response.body.getReader()` dan abort setelah **16 MB**; fallback bila stream tidak
    tersedia: `response.blob()` → cek `blob.size` (satuan **byte**, bukan `.length`
    UTF-16) → `blob.text()`. `content-length` hanya guard awal. 16 MB dipilih supaya
    raw komentar muat di envelope 24 MB bersama artikel.
  - Validasi shape: `comments` array, node object, `children` array/absent; batas
    traversal 50.000 node dan depth 64 sebelum normalisasi (cegah tree patologis).
  - Non-200 / JSON rusak / timeout → `{ state: "unavailable", reason }`.
  - Return raw `{ comments, automod_hidden_comments }`; normalisasi di background.
    `commentsRaw` hanya dikirim kalau envelope ≤ 24 MB (UTF-8 byte); kalau lebih,
    content tidak mengirim raw — kirim `commentsState: { state: "too_large" }`.
- `src/substack-comments.js` (ESM):
  - `normalizeComments(raw, { declared, bodyTruncated, maxComments = 2000 })`:
    - `maxComments`: integer 1..10.000; invalid → default 2.000.
    - ID: `id` wajib string/number non-empty setelah `String()`. Dedupe: **traverse
      semua kemunculan**, merge children (di-dedupe rekursif), **anti-siklus**: bila ID
      ∈ `ancestors` DFS, edge dibuang + anak published dipromosikan ke non-leluhur +
      dihitung `duplicates` (lihat definisi statistik) — hasil dijamin DAG. Hitung
      `duplicates`. `parentId` yang menunjuk ID tidak ada → perlakukan sebagai root,
      catat.
    - Filter node dengan `deleted === true`, `suppressed === true`, atau
      `status !== "published"`.
    - **Reparent**: anak published dari node yang difilter dipromosikan ke parent
      published terdekat (atau root), set `reparentedFrom` + pertahankan
      `originalParentId`. Jangan pernah membuang balasan published hanya karena
      parent-nya dihapus.
    - DFS cap 2.000 node published; hitung `captured`, `dropped`, `truncated`.
    - Stats sesuai definisi di atas (`published` = ID unik; `declared` bisa `null`;
      `mismatch` `null` bila `declared` null; `duplicates` terhitung). State
      `unavailable`/`too_large`/`cancelled` → semua total yang tidak pernah diamati =
      **`null`** (bukan `0`).
    - **State table (eksplisit, semua kasus tercakup):**
      - `captured` bila `published > 0`.
      - `empty` + `reason: "no-comments"` bila raw kosong dan (`declared === 0` atau
        `declared === null`).
      - `restricted` + `reason: "paywall"` bila raw kosong, `declared !== null` &&
        `declared > 0`, dan **`post.bodyTruncated === true`** (bukti konten artikel
        memang terpotong untuk sesi ini). Set `restricted: true`.
      - `empty` + `reason: "declared-mismatch"` bila raw kosong, `declared > 0`, dan
        `bodyTruncated !== true` (ambiguous — subscriber yang komentarnya memang tidak
        terlihat, atau komentar tersembunyi); catat di `errors.json`, **jangan** klaim
        `restricted`.
      - `empty` + `reason: "all-filtered"` bila raw nonempty tapi `published === 0`
        (semua node terfilter); `filtered.total > 0`.
      - `unavailable` untuk non-200/network/JSON error; `too_large` untuk byte cap;
        `cancelled` untuk abort user.
      - Jangan pernah menyimpulkan `restricted` dari `audience` saja.
  - `flattenComments(tree)`, `commentsToRows(tree)`, `commentsToCsv(tree)` dengan
    escaping RFC 4180 (koma, kutip, newline).
  - `renderCommentsMarkdown(comments)`: nested list, author badge `(author)`, tanggal,
    `♥ likes`, `↻ restacks`, `(edited)`, catatan reparent, warning cap/restricted.
  - `renderCommentsHtml(comments)`: nested `<ol>`/`<li>`, badge author, tanpa script.
- `src/substack-content.js`: progres via `job.progress` (phase `comments`); cancel lewat
  `cancelRequested` + AbortController; ikuti **Stage A** (envelope 24 MB UTF-8;
  degradasi media dulu, lalu `commentsRaw`); artikel tetap dikirim.
- `src/background.js`: integrasi `comments` ke snapshot; `comments.json`; `comments.csv`
  di data preset; section komentar di `post.md`/`post.html`; `errors.json` comments;
  partial success saat cancel; ikuti **Stage B** (ZIP 32 MB + re-render sebelum
  degradasi).
- `src/popup.js` + `src/popup.html`: `includeComments` default `true`; `maxComments`
  default 2.000 (advanced); progress "fetching comments… N"; result menyebut jumlah
  komentar dan state.
- `comments.json` memakai shape `ArticleSnapshot.comments` + `items`; `post.json` hanya
  summary (tanpa `items`).

**Acceptance criteria:**
- [ ] Tomas Pueyo “mountains” (fixture beku + live manual): raw 1.050 node →
  `published 1045`, `captured 1045`, `topLevel 727`, `maxDepth 8`, author replies `92`,
  `filtered.total 5` (`deleted 1`, `blocked 3`, `moderator_removed 1`), `promoted 6`,
  `automodHidden 16`, `declared 1061`, `mismatch 16`, `truncated false`. Live drift
  dicatat, bukan gagal unit test.
- [ ] Slow Boring free post: `captured 238`; The Free Press free post: `captured 87`.
- [ ] Post berbayar anonymous: `captured 0`, `declared > 0`, `state: "restricted"`,
  `reason: "paywall"`, artikel tetap jadi ZIP; bukan "0 komentar" diam-diam.
- [ ] Post berbayar subscriber (manual, bila akun tersedia): komentar `captured`
  (sesi login bawa seluruh yang terlihat); artikel `access: "session"` +
  `bodyTruncated: null` bila tanpa marker & rasio ≥ 0,9, atau `true` bila ada marker;
  kalau tidak tersedia, catat sebagai unverified, jangan klaim.
- [ ] Free post dengan `declared > 0` tapi semua komentar terfilter: `state: "empty"`,
  `reason: "all-filtered"` — bukan `restricted`.
- [ ] Post berbayar dengan `declared > 0`, raw kosong, `bodyTruncated !== true`:
  `state: "empty"`, `reason: "declared-mismatch"` — bukan `restricted`.
- [ ] `declared` hilang tapi API mengembalikan komentar: `captured > 0`,
  `declared: null`, `mismatch: null`, `errors.json` mencatat `declared-mismatch`; tidak
  crash dan tidak ada angka `0` karangan.
- [ ] API 500/timeout/body >16 MB: artikel tetap jadi ZIP, `comments.state:
  "unavailable"`/`"too_large"`, `errors.json` mencatat alasan; popup tidak hang.
- [ ] Comments API redirect ke origin lain: abort sebelum body dibaca →
  `comments.state: "unavailable"` + `errors.json` (`final-url-not-allowed`);
  artikel tetap jadi ZIP.
- [ ] Synthetic 2.500 node: `captured 2000`, `truncated true`, `dropped 500`, tidak ada
  node yatim (semua `parentId` menunjuk node yang ada atau `null`).
- [ ] Filtered parent dengan anak published: anak promosi, `reparentedFrom` terisi,
  `originalParentId` tetap, tidak ada komentar published yang hilang.
- [ ] ID duplikat / `parentId` yatim / `maxComments` invalid (negatif, 0, 2.5):
  deterministik, tidak crash, `duplicates` terhitung, `maxComments` jatuh ke 2.000;
  children unik dari kemunculan ID kedua tetap muncul (traverse semua kemunculan,
  merge + dedupe rekursif); `published` = jumlah ID unik (bukan jumlah kemunculan).
- [ ] Anti-siklus: fixture `A → B → A → C` (ID berulang di bawah leluhurnya) → edge
  siklus dibuang, `C` tetap muncul (dipromosikan ke non-leluhur/root), hasil
  normalisasi berupa DAG (bisa di-serialize JSON + dirender tanpa hang); fixture
  parent-konflik (kemunculan sama dengan parent berbeda) deterministik.
- [ ] State `unavailable`/`cancelled` dan `too_large` **bukan** `zip-budget`: total
  yang tidak pernah diamati (`published`, `captured`, `topLevel`, `maxDepth`,
  `filtered`, `promoted`, `dropped`, `truncated`, `mismatch`, `duplicates`) = `null`,
  bukan `0`. `too_large` + `zip-budget` (Stage B): `captured: 0`, `truncated: true`,
  `dropped: published`, observasi pra-drop di `errors.json`.
- [ ] `comments.csv` rows == `captured` **bila CSV ada** (CSV absen saat `items`
  kosong); field berisi koma/kutip/newline tetap valid; `likes`/`restacks` kosong
  bila tidak ada, bukan `0`.
- [ ] `post.md` menampilkan tree bersarang, author reply ditandai, dan ChatGPT bisa
  menjawab "siapa membalas siapa" + "berapa komentar".
- [ ] `includeComments: false`: tidak ada `comments.json`/`comments.csv`/section komentar;
  artikel tetap utuh.
- [ ] Cancel saat fetch komentar: ZIP artikel tetap jadi, `comments.state: "cancelled"`;
  job tidak berakhir sebelum ZIP ter-download.
- [ ] Envelope > 24 MB (UTF-8 byte) karena raw komentar: content tidak mengirim
  `commentsRaw`; `commentsState: "too_large"`; artikel tetap jadi ZIP.

**Verification:**
- [ ] `tests/substack-comments.test.js`: fixture **frozen lengkap**
  `tests/fixtures/substack-comments-tomas.json` (topology-preserving, anonymized:
  body diganti placeholder stabil, ID diremap konsisten, provenance dicatat di
  komentar fixture) + expected `tests/fixtures/substack-comments-tomas-expected.json`
  → assert 1045/727/8/92/5/6; unit edge cases pakai fixture trimmed + synthetic
  (filter/reparent/cap/restricted/empty/all-filtered/declared-mismatch/
  missing-declared/duplicates-with-unique-children/anti-siklus `A→B→A→C`/
  parent-konflik/maxComments-invalid/CSV escaping).
  Fixture trimmed **tidak** dipakai untuk angka penuh Tomas.
- [ ] `tests/background-substack.test.js`: stub payload komentar → ZIP berisi
  `comments.json` + `comments.csv` per preset matrix; path restricted; path cancel;
  path `too_large`; path envelope > 24 MB; **Stage B fixture memaksa drop komentar**
  → `captured: 0` + `state: "too_large"` + `reason: "zip-budget"` + `truncated: true`
  + `dropped: published` di `post.json` dan `comments.json`, `comments.csv` absen,
  summary == stats retained (bukan observasi pra-drop).
- [ ] `tests/e2e.test.js`: stub `fetch` di Chromium (route `https://…/api/v1/post/…`)
  untuk shape comments API + body stream tanpa `content-length` + **redirect
  comments ke origin lain → abort sebelum body dibaca** (`unavailable`).
- [ ] Gate egress akhir (Task 22): ketiga jalur (media, artikel, komentar) punya
  test redirect final-URL masing-masing.
- [ ] Manual: Tomas, Slow Boring, The Free Press, 1 post berbayar (anonymous), dan
  subscriber bila tersedia; upload `post.md` ke ChatGPT 3 probe.
- [ ] `npm run quality` + `npm test` hijau.

**Dependencies:** Task 19, Task 20.

**Files likely touched:**
- `src/sites/substack-adapter.js`, `src/substack-comments.js` (baru)
- `src/substack-export.js`, `src/substack-content.js`, `src/background.js`
- `src/popup.js`, `src/popup.html`
- `tests/substack-comments.test.js`, `tests/background-substack.test.js`,
  `tests/e2e.test.js`
- `tests/fixtures/substack-comments-tomas.json` (frozen lengkap, anonymized) +
  `tests/fixtures/substack-comments-tomas-expected.json`,
  `tests/fixtures/substack-comments.json` (trimmed), `tests/fixtures/substack-comments-large.json`

**Estimated scope:** Large (normalisasi tree + edge case + render + CSV).

### Checkpoint: Comments (Phase 8)

- [ ] Tomas `1045/1061`, Slow Boring `238`, The Free Press `87` (live drift dicatat)
- [ ] Filtered parent → anak published promosi, tidak ada yang hilang
- [ ] Post berbayar anonymous `restricted` (bukti `bodyTruncated: true`); subscriber
  `captured` (`session`/`null` atau `true` bila ada marker); free all-filtered `empty`,
  bukan `restricted`; declared mismatch (`bodyTruncated !== true`) → `empty`, bukan
  `restricted`
- [ ] API failure/body >16 MB/envelope >24 MB ditandai jujur
  (`unavailable`/`too_large`)
- [ ] `comments.csv` rows == `captured`; escaping valid; `likes`/`restacks` null bukan 0
- [ ] `post.md` Tomas lolos 3 probe ChatGPT (jumlah, tree, author replies)
- [ ] Review human sebelum UX finalization

## Task 22: Popup UX + docs + regression + manual E2E

**Description:** Rapikan UX Substack, kunci kontrak lewat test, dan lakukan uji manual
lintas publication. Task ini juga memastikan tidak ada regresi X/YouTube dan tidak ada
permission baru.

Detail:

- `src/popup.js`:
  - `detectActiveSite()` dijalankan saat popup open: X/YouTube lewat registry; URL
    http(s) lain → inject `SUBSTACK_DETECT_SCRIPT` + probe. Simpan hasil; klik Download
    re-probe bila `tab.url` berubah.
  - Saat popup open, baca `SCRAPE_STATUS` (proxy ke tab); kalau `state` aktif untuk
    tab yang sama, reconnect (polling + Cancel) dan disable Download sampai selesai;
    pakai `documentToken` dari STATUS untuk `SAVE_RESULT`/`CANCEL`; `saveState` +
    `downloadId` mengatur tampilan "menyimpan / gagal / ulangi".
  - Mode Substack: tampilkan `includeComments` + `maxComments`; sembunyikan
    autoscroll/skip promoted/video mode; format `post.html`, `post.md`, `post.json`,
    `comments.json`, `comments.csv`; label tombol "Download post".
  - `Check connection`: `ensureSubstackInjected()` sebelum PING; `expectedCaps` Substack
    `["media", "zip"]` + `caps.substack === 1`; readiness map dijalankan selalu (tidak
    ada shortcut capability); stale tab → hint reload.
  - Progress dari `SCRAPE_STATUS` (`job.progress`): `article`, `comments (N)`,
    `media (N/M)`, `zipping`; tidak ada `SCRAPE_PROGRESS` runtime untuk Substack.
  - Result: `downloaded <file> (N comments, M media, access: session, truncated:
    yes/no/unknown, comments: restricted)`; partial/cancel jelas;
    `BUSY`/`TAB_CHANGED`/`JOB_LOST`/`ALREADY_SAVED` punya pesan actionable.
  - Pesan unsupported menyebut X, YouTube, dan post Substack.
- `src/popup.html`/`src/popup.css`: fieldset format Substack terpisah; advanced
  `maxComments`; layout tidak berubah untuk X/YouTube.
- `src/background.js`: `readScrapeOptions` final (`site`, `includeComments`,
  `maxComments`, `tabId`, `sourceUrl`, `postId`); `downloadSubstack` menangani
  partial/cancel, preset matrix, `MARK_SAVED`; filename aman; tanpa job state di
  worker (content script yang memegang state).
- Docs:
  - `README.md`: section Substack (cara pakai, isi ZIP per preset, batasan
    akses/komentar, permission tetap minimal, residual risk redirect media).
  - `docs/export-columns.md`: kolom `comments.csv` + aturan "field tidak ada = kosong,
    angka tidak dikarang".
  - `docs/ideas/substack.md`: **sudah direconcile saat planning** (urutan identitas
    preloads → API → gagal tanpa DOM, stats `captured 1045`/`published 1045` dengan
    1.050 = raw, bentuk `filtered`, acceptance S3, sort ikut API, CSV di preset data);
    Task 22 tinggal **verifikasi** tidak ada bagian yang masih kontradiktif + update
    status.
  - `tasks/plan.md`: Revisions Log.
- Tests:
  - `tests/popup-ui.test.js`: mode Substack (stub `chrome.scripting.executeScript`),
    opsi muncul, download mengirim `site: "substack"` + `tabId`, reconnect ke job aktif
    via `SCRAPE_STATUS`, status hasil, `BUSY`/`TAB_CHANGED`/`JOB_LOST`,
    `SAVE_RESULT` idempoten. **Catatan:** test ini stub `chrome.*`; bukti activeTab /
    isolated world / service-worker lifecycle tetap manual (lihat checklist bawah).
  - `tests/substack-injection.test.js`: daftar injection, classic-safe, tidak ada
    `host_permissions`, tidak ada match Substack di manifest, eksekusi daftar dua kali,
    simulasi partial injection (global hilang) → file yang tepat di-inject.
  - `tests/background-substack.test.js`: payload lengkap → file ZIP per preset matrix,
    filename, restricted, cancel, `BUSY`, `TAB_CHANGED`/`JOB_LOST`, `MARK_SAVED`
    idempoten.
  - `tests/substack-comments.test.js`, `tests/substack-export.test.js`,
    `tests/substack-model.test.js`, `tests/substack-presets.test.js`.
  - Regresi X/YouTube: suite lama tetap hijau.
- Manual E2E lifecycle (wajib, tidak bisa diuji dengan stub):
  - Load unpacked → klik Download dua kali → buka popup ulang → reload extension di tab
    lama → pindah tab saat fetch → reload tab saat fetch → cancel mid-comments →
    terminasi service worker lalu buka popup → dua job beruntun.
  - Ekspektasi: tidak ada redeclare/listener ganda; `JOB_LOST`/`TAB_CHANGED` saat
    navigasi; reconnect setelah worker mati; cancel tetap menghasilkan ZIP partial;
    tidak ada ZIP ganda.
- Manual E2E data:
  - Tomas free besar (1.050 raw), Slow Boring free (238), The Free Press free (87),
    satu post berbayar anonymous (`bodyTruncated: true` + `restricted`), subscriber
    bila tersedia (`session` + komentar `captured`).
  - Buka `post.html` dengan network aktif; cek gambar + komentar + Network kosong.
  - Upload `post.md` Tomas + satu post kecil ke ChatGPT; 3 probe per post.
  - DevTools Network: buktikan **URL awal** hanya ke allowlist (publication +
    substackcdn + substack media hosts); catat bahwa redirect otomatis bisa menyentuh
    host di luar allowlist (residual risk) — jangan mengklaim nol kontak luar.
  - Optional (kalau stabil): `tests/extension-lifecycle.test.js` dengan Playwright
    persistent context + `--load-extension` untuk activeTab/isolated-world; kalau
    flaky, manual gate di atas yang menjadi bukti.

**Acceptance criteria:**
- [ ] Satu ZIP per post. Konsistensi dibandingkan **per preset yang memuat file
  terkait**: preset `data` (`post.json` summary == `comments.json` stats == jumlah row
  `comments.csv` **bila CSV ada**; komentar di-drop Stage B → `comments.csv` absen +
  `captured: 0` + `state: "too_large"` konsisten); preset `llm` tidak punya
  `post.json`/CSV jadi tidak dibandingkan dengan file yang tidak ada di ZIP-nya.
  `comments.json` (selalu ikut) == summary di `post.json` bila `post.json` ada.
- [ ] Mode Substack menampilkan opsi yang benar; opsi X/YouTube tidak muncul di Substack
  dan sebaliknya.
- [ ] `Check connection` di Substack sehat (`connected: true`, `caps.substack === 1`)
  setelah injection.
- [ ] Halaman non-post Substack dan situs tak dikenal memberi pesan eksplisit.
- [ ] Post berbayar/API failure/cancel ditandai jujur di popup + `errors.json`;
  subscriber (berbayar, `access: "session"`): tanpa marker + rasio ≥ 0,9 →
  `bodyTruncated: null` (info "diarsipkan sesuai sesi login", tanpa warning);
  dengan marker `.paywall` ATAU rasio < 0,9 → `bodyTruncated: true` + warning
  terpotong; free → `open` + `false`. Tidak ada field `full`/`preview`/`unknown`.
- [ ] `post.html` dengan network aktif tidak melakukan request remote.
- [ ] `post.md` Tomas + satu post kecil lolos 3 probe ChatGPT.
- [ ] X/YouTube tidak regresi; `npm run quality` + `npm test` hijau.
- [ ] Manifest tetap `activeTab`, `scripting`, `downloads`; tanpa `host_permissions`.
- [ ] `README.md` + `docs/export-columns.md` diperbarui; `docs/ideas/substack.md`
  diverifikasi tidak kontradiktif dengan plan (urutan identitas, stats 1045, bentuk
  filtered, sort `order: "api"`, CSV di preset data, akses `open`/`session` +
  `bodyTruncated`, alur
  save/ack/polling `SAVE_RESULT` + `GET_RESULT` diagnostik, URL awal egress +
  residual risk).
- [ ] Gate egress: test redirect final-URL hijau untuk **ketiga jalur** (media,
  artikel, komentar); residual risk tercatat di README/`errors.json`.
- [ ] Popup menjelaskan outcome terminal dari `SCRAPE_STATUS` (`errorCode`/
  `errorReason`) — termasuk setelah reopen: `cancelled-before-article`,
  `POST_IDENTITY_MISMATCH`, `ARTICLE_TOO_LARGE`, `ARCHIVE_TOO_LARGE`, `tab-changed`.
- [ ] Manual lifecycle: double-click, popup reopen, tab switch, extension reload,
  service-worker termination (termasuk antara download start dan `MARK_SAVED`), reload
  tab saat fetch, cancel, dua job beruntun — tidak ada redeclare/listener ganda/ZIP
  ganda/ZIP nyasar; reconnect setelah worker mati; download `interrupted` → retry.
- [ ] Preset matrix: `llm` (`post.md` + `post.html`), `data` (`post.json` +
  `comments.csv`), `custom` pilihan; sidecar wajib ikut; test `substack-presets` hijau.

**Verification:**
- [ ] `npm run quality` + `npm test` penuh hijau.
- [ ] `tests/popup-ui.test.js` + `tests/substack-injection.test.js` +
  `tests/substack-presets.test.js` + vocabulary test `messaging` hijau.
- [ ] Manual checklist 4 post + lifecycle dicatat di `tasks/todo.md`.
- [ ] Inspect diff final: tidak ada suppression quality, tidak ada permission baru,
  tidak ada selector Substack di luar `src/sites/substack-*.js`.
- [ ] Review human + keputusan merge `experiment/substack` → `main`.

**Dependencies:** Task 20, Task 21.

**Files likely touched:**
- `src/popup.js`, `src/popup.html`, `src/popup.css`, `src/background.js`
- `tests/popup-ui.test.js`, `tests/substack-injection.test.js`,
  `tests/background-substack.test.js`
- `README.md`, `docs/export-columns.md`, `docs/ideas/substack.md`, `tasks/todo.md`

**Estimated scope:** Medium (UI + docs + manual E2E).

### Checkpoint: Complete (Phase 8)

- [ ] Semua acceptance Task 19-22 terpenuhi
- [ ] 4 post manual (3 gratis + 1 berbayar) terarsip; `post.md` lolos probe ChatGPT
- [ ] `post.html` dengan network aktif bersih (tanpa request remote)
- [ ] X/YouTube regression hijau
- [ ] Tidak ada permission baru / `host_permissions`
- [ ] Manual lifecycle (double-click/reopen/tab switch/reload/cancel/BUSY) lolos
- [ ] Review human; keputusan merge branch

## Risks and Mitigations (Phase 8)

| Risk | Impact | Mitigation |
|------|--------|------------|
| `preloads-json` / API internal Substack berubah | High | Schema guard + fallback API + `errors.json`; DOM bukan sumber body; gagal eksplisit (`POST_IDENTITY_MISMATCH`) bila identitas tak pasti |
| Comments API dihapus/dibatasi/rate-limited | High | `comments.state: "unavailable"` + artikel tetap ZIP; DOM-only tidak dijanjikan |
| Custom domain + Cloudflare memblokir fetch | Med | Fetch dari content script same-origin (sesi tab); error jujur; tanpa fallback DOM yang bisa salah post |
| Dynamic injection redeclare global (`media.js`) | High | IIFE guard + `ensureSubstackInjected` cek `globalThis` per file; test daftar dua kali + partial injection |
| Extension reload / service worker mati saat job | High | State job di content script (bukan worker); popup reconnect via `SCRAPE_STATUS` ke tab; recovery save via `SAVE_RESULT` klaim + `downloads.search` (bukan `GET_RESULT`) |
| Tab aktif berubah / reload saat job jalan | High | `jobId` + `documentToken` di semua bound pesan; echo binding diverifikasi background; content cek `location.href` vs `job.sourceUrl`; `JOB_LOST`/`TAB_CHANGED` eksplisit |
| Popup reopen memulai job kedua | Med | Single-flight per tab di content script (`BUSY`) + reconnect via STATUS; `MARK_SAVED` anti download ganda |
| Cancel melepas lock sebelum ZIP partial jadi | High | Cancel hanya flag; job aktif sampai `finishing`/`done`; lock dilepas hanya setelah download sukses |
| Stale SPA preloads mengarsipkan post salah | High | Canonical path == current path; fallback API + verifikasi slug; DOM tidak dipakai sebagai body source |
| Sanitasi HTML menyisakan remote request (`style`/`srcset`) | High | Allowlist atribut per tag; test parse/sanitize tidak memicu request (route counter) |
| Footnote/ID hilang setelah sanitasi | Med | Pertahankan `id` aman + prefix `arsip-`; rewrite fragment; test semua link resolve |
| Embed hilang karena sanitasi | Med | Inventaris embed sebelum sanitasi + placeholder link + `errors.json` |
| Gambar dari host asing / redirect liar | Med | Allowlist host media + cek `response.url`; `unresolved: "external-origin"` |
| Komentar raksasa / `content-length` bohong | Med | Stream byte cap 16 MB + bounded traversal + cap 2.000 + envelope guard 24 MB UTF-8 byte |
| Base64 media melebihi message limit | High | Budget 12 MB mentah / 24 MB payload / 32 MB ZIP; degradasi media lalu komentar; `ARTICLE_TOO_LARGE`/`ARCHIVE_TOO_LARGE` eksplisit |
| Parent difilter tapi anak published | Med | Reparent + `originalParentId` + fixture test; jangan buang balasan sah |
| Penanda akses bikin bingung / mengklaim kelengkapan palsu | Med | `access: open\|session` + `bodyTruncated` (bukti saja); warning hanya `true`; info "sesuai sesi login" untuk `session`/`null`; tidak ada `full`/`preview`/`unknown` |
| Statistik komentar ambigu / angka hidup drift | Med | Definisi populasi (raw vs normalized vs capped) + fixture beku; live drift dicatat, unit test pakai fixture |
| Preset thread (`filterFilesByPreset`) salah baca file `post.*` | Med | Matrix khusus di `src/substack-presets.js` + test matrix; jangan reuse filter thread |
| `post.md` terlalu besar untuk ChatGPT | Low/Med | Ukur ukuran Tomas; sarankan data preset/article-only; warning di popup |
| PII komentar | Low | Arsip personal; catatan README; jangan publish |
| `chrome.downloads` data URL terlalu besar | Med | Ukur ZIP Tomas; pola yang sama dengan X; error `ZIP_FAILED` eksplisit |
| Worker reset antara download start dan `MARK_SAVED` / download `interrupted` | High | `saveState` + `downloadId` + `downloads.onChanged` + `downloads.search` rekonsiliasi; retry tanpa membuang result; klaim atomik `SAVE_RESULT` |
| Pesan baru (`GET_RESULT`/`SAVE_RESULT`/`MARK_SAVED`/`DOWNLOAD_STARTED`) ditolak validator protocol | High | Tambah tipe di `src/messaging.js` + test vocabulary; route Substack sebelum handler global |
| Parse `DOMParser` ternyata memuat resource | High | Test route-counter fixture jahat = gate; fallback pre-strip string-level sebelum parse |
| Redirect media menyentuh host di luar allowlist | Med | Validasi URL awal + `response.url` final + `response.redirected`; body abort; residual hop dicatat di README/`errors.json` (tanpa permission `webRequest`) |
| Duplikat ID menyembunyikan balasan published unik | Med | Traverse semua kemuncelan + merge/dedupe rekursif; fixture parent-duplikat dengan children unik |

## Decisions Needing Sign-off (Phase 8)

1. **Same-origin comments API** (bukan DOM-only) untuk komentar lengkap — rekomendasi: ya.
   DOM-only cuma dapat 2 komentar yang dirender.
2. **`comments.csv` hanya di data preset**, bukan llm preset — rekomendasi: ya.
3. **Cap komentar 2.000 node published** — rekomendasi: ya; bisa dinaikkan nanti.
4. **Avatar komentator tidak di-download** (HTML pakai inisial) — rekomendasi: ya.
5. **Cancel = partial article ZIP** dengan `comments.state: "cancelled"` — rekomendasi: ya.
6. **Single-flight per tab + job identity** (`jobId` + `documentToken`, `BUSY`,
   `JOB_LOST`/`TAB_CHANGED`): state job **di content script**, bukan di memory service
   worker — rekomendasi: ya; ini menutup kelemahan worker sleep/reset dan
   `forwardToActiveTab` untuk job panjang.
7. **Budget media 12 MB mentah / 24 MB payload (UTF-8 byte) / 32 MB ZIP** +
   `ARTICLE_TOO_LARGE`/`ARCHIVE_TOO_LARGE` — rekomendasi: ya.
8. **DOM tidak dipakai sebagai sumber artikel** (hanya marker deteksi) — rekomendasi:
   ya; identitas wajib preloads-verified atau API-verified, selain itu gagal eksplisit.
9. **Preset matrix khusus Substack** (`src/substack-presets.js`, bukan reuse
   `filterFilesByPreset`) — rekomendasi: ya.
10. **Akses seadanya (keputusan user 2026-11-03):** arsip mengikuti sesi login tab —
    tidak ada yang dipotong; penanda `post.access: "open" | "session"` +
    `post.bodyTruncated: boolean | null` (bukti potong saja), tanpa trichotomies
    `full`/`preview`/`unknown` dan tanpa klaim kelengkapan; warning hanya saat
    `bodyTruncated: true` — rekomendasi: ya (sudah disetujui user).
11. **Comments state butuh bukti `post.bodyTruncated === true` untuk `restricted`** —
    rekomendasi: ya; kasus ambiguous jadi `empty`/`declared-mismatch`.
12. **Save lifecycle content-owned** (`idle/saving/saved/failed` + `downloadId` +
    `downloads.onChanged`/`search`, lock dilepas hanya saat download **complete**) —
    rekomendasi: ya; `chrome.downloads.download` hanya menandai download *mulai*.
13. **Vocabulary pesan diperluas di `src/messaging.js`** — daftar otoritatif **hanya**
    di keputusan "Protokol pesan" Phase 8 (7 tipe baru: `GET_RESULT`, `SAVE_RESULT`,
    `SAVE_SUBMIT`, `MARK_SAVED`, `DOWNLOAD_STARTED`, `SAVE_FAILED`, `DISMISS`) +
    route Substack sebelum handler global — rekomendasi: ya. Jangan menduplikasi
    daftar di tempat lain; rujuk ke sana.
14. **Fixture Tomas beku & anonymized** (`substack-comments-tomas.json` +
    `-expected.json`, provenance dicatat) untuk angka 1045/727/8; live drift dicatat,
    bukan gagal test — rekomendasi: ya.
8. **Branch `experiment/substack` dari `main`** — rekomendasi: ya.

## Open Questions (Phase 8)

- Sort komentar: ikut API (`best_first`) atau client-side kronologis? Default: ikut API,
  catat `order: "api"`; jangan mengarang urutan.
- `automod_hidden_comments`: cukup dihitung, atau perlu disertakan dengan flag? Default:
  hitung saja, jangan simpan body.
- Post podcast/video Substack: phase B atau langsung? Default: phase B; MVP article
  newsletter saja.
- `comments.xlsx`: perlu? Default: tidak; CSV cukup untuk analisis.
- Subscriber test account: tersedia untuk manual? Kalau tidak, tandai unverified di
  `tasks/todo.md`; jangan klaim komentar paid full.
- Penanda akses (sudah diputuskan): `access: open|session` + `bodyTruncated`
  (bukti potong saja); warning hanya `bodyTruncated: true`; `session`/`null` → info
  "diarsipkan sesuai sesi login" tanpa klaim kelengkapan.
- DOM fallback dihapus sebagai sumber artikel: kalau Substack mengubah `preloads-json`
  dan API juga berubah, artikel tidak bisa diarsipkan. Default: terima — lebih baik
  gagal eksplisit daripada arsipkan post yang salah.
- `ARTICLE_TOO_LARGE` (> 24 MB): menawarkan ZIP media-only atau gagal total? Default:
  gagal total dengan pesan eksplisit; jangan diam-diam memotong artikel.

## Parallelization Opportunities (Phase 8)

- T19 harus selesai dulu (kontrak + injection + job identity + route). Manual gate
  setelah T19 wajib sebelum T20.
- T20 dan T21 sama-sama menyentuh `post.md`/`post.html`, jadi integrasi sekuensial.
  `src/substack-comments.js` + fixture bisa disiapkan paralel dengan T20, tapi merge
  setelah T20.
- T22 setelah T20 + T21. Dokumentasi bisa draft selama T21, final di T22.
- Manual E2E Tomas (thread besar) butuh waktu; jadwalkan setelah T21, bukan di akhir T22.

## Revisions Log

| Tanggal | Perubahan | Alasan |
|---------|-----------|--------|
| 2026-11-25 | Bugfix fallback network: pindahkan merge API sebelum guard `EMPTY_THREAD`; regresi worker membuktikan DOM kosong + payload artikel valid harus diekspor, sedangkan DOM+API kosong tetap ditolak. 170/170 test dan quality snapshot kode hijau; log mentah user tidak diubah. | Worker sebelumnya menolak hasil DOM kosong sebelum membaca payload network; perbaikan timing listener saja tidak menutup jalur ini. |
| 2026-11-25 | Bugfix capture awal: stack penerima X/YouTube dijalankan pada `document_start`, sama seperti hook MAIN; tambah guard manifest dan regresi browser untuk respons sebelum body tersedia. 168/168 test hijau; quality hijau pada snapshot kode tanpa log mentah user (file asli tidak diubah). Checkpoint manual X tetap terbuka. | Log user berisi request pendukung tanpa payload tweet; listener default `document_idle` berpotensi kehilangan respons awal. Ini memperbaiki race yang dapat direproduksi, bukan bukti semua kasus log kosong punya penyebab sama. |
| 2026-11-03 | Tambah Phase 8 + Task 19-22 (Substack article + comments) | Permintaan arsip post Substack di custom domain; bukti `preloads-json` + comments API ada di `docs/ideas/substack.md` |
| 2026-11-03 | Revisi Phase 8 setelah adversarial review: injection idempotent, job identity/single-flight, stale SPA identity, sanitizer allowlist, embed order, byte/payload budget, comment state/stats, paywall subscriber, checkpoint awal + todo ordering | Temuan P1/P2 review Codex; memperbaiki asumsi yang bisa bikin ZIP salah, redeclare, atau data loss |
| 2026-11-03 | Revisi kedua setelah review kedua: state job dipindah ke content script (tahan worker reset), `jobId`+`documentToken` di semua pesan, cancel tidak melepas lock sebelum ZIP partial, transport contract komentar terpisah (raw 16 MB / envelope 24 MB UTF-8 byte), budget byte + `ARTICLE_TOO_LARGE`, urutan degradasi re-render sebelum ZIP, paywall konservatif + state table komentar berbasis bukti `paywall`, footnote ID namespace, allowlist media host + cek `response.url`, `declared`/`likes` null bukan 0, preset matrix khusus Substack, diagnostics terbawa ke `errors.json`, DOM tidak jadi sumber body, readiness map injection, fixture HTTPS, reconciliasi `docs/ideas/substack.md`, validasi ID/`maxComments`, fixture statis untuk angka Tomas | Temuan P1/P2 review kedua; menutup kontradiksi lifecycle, transport, output contract, dan paywall |
| 2026-11-03 | Revisi ketiga setelah review ketiga: save lifecycle (`idle/saving/saved/failed` + `downloadId` + `onChanged`/`search`, lock lepas saat download complete), recovery `documentToken` dari `SCRAPE_STATUS` + `GET_RESULT` = capture payload + options immutable, vocabulary pesan baru di `src/messaging.js`, tanpa `SCRAPE_PROGRESS` runtime (progres via STATUS), route Substack sebelum handler global, dedupe traverse semua kemunculan + `published` = ID unik, total tak-diamati = `null`, Stage A/B budget tunggal + `Blob.size`, paywall acceptance per kombinasi precedence, footnote `span` + anchor Markdown + test referensi==target, parse-network jadi gate + fallback pre-strip, escaping semua field non-HTML + fixture jahat, preset acceptance per-preset, fixture Tomas beku anonymized + expected, reconciliasi ide doc (alur/CSV/sort/render) | Temuan P1/P2 review ketiga; menutup recovery/save lifecycle, binding dokumen, egress, dedupe, footnote, dan konsistensi dokumen |
| 2026-11-03 | Revisi keempat setelah review keempat: `SAVE_RESULT` = klaim atomik yang diteruskan ke tab (GET_RESULT read-only), transisi `SAVE_FAILED` untuk setiap batas gangguan, filename + `jobId` untuk rekonsiliasi via `downloads.search({ query: [jobId] })` (bukan filename), `SCRAPE_START` ack sinkron + `SCRAPE_STATUS` tokenless discovery, tiga kelas skema binding (bootstrap/discovery/bound) + echo binding (bukan klaim `sender.documentId` pada jalur reply), `BAD_BINDING` tanpa tabId, `validateResponse` di `fetchBytes` sebelum body dibaca, egress acceptance diperqualifikasi + dua fixture redirect terpisah, coverage vocabulary diperluas ke `SUBSTACK_INJECTION`, escaping Markdown per konteks + `encodeMarkdownDestination`, `id` di semua elemen retained + verifikasi berbasis input reference→target, `embeds` ikut transport, `bodyHtml` tersanitasi + `bodyHtmlSource` original, paywall acceptance final diperqualifikasi, ide doc (path inject, S3 policy, open questions resolved) | Temuan P1/P2 review keempat; menutup klaim save yang terskip, recovery tanpa downloadId, binding pesan, pre-body redirect check, dan konsistensi dokumen |
| 2026-11-03 | Revisi kelima setelah review kelima: `attemptId` per klaim (transisi basi diabaikan), gate `SAVE_ABANDONED_MS` 60 dtk (save hidup tidak dicabut), `downloads.search({ query: [jobId] })` bertipe `string[]` + filter filename persis + urutan kandidat deterministik, validasi URL dua lapis (content cek `location.href` vs `job.sourceUrl` untuk SPA navigation + popup kirim `sourceUrl`), state terminal (`error`/`idle`/`saved`) vs non-terminal + `DISMISS` untuk release lock, observer `onChanged` sebelum `download()` + rekonsiliasi `search({ id })` (completion bisa mendahului ack), fixture redirect dipecah (`allowed→outside` tolak vs `allowed→outside→allowed` terima + catat), anti-siklus dedupe (ancestors, fixture `A→B→A→C`), escaping Markdown per konteks (backslash dulu, konstruk blok, destination `<...>`) | Temuan P1/P2 review kelima; menutup race recovery, tipe API search, URL validation stateless, release lock terminal, dan verifikasi fixture |
| 2026-11-03 | Revisi keenam setelah review keenam: fencing attempt menyeluruh (`BUILD_ZIP` + `attemptId` → `STALE_ATTEMPT` sebelum download; AbortController pipeline dihancurkan sebelum `SAVE_FAILED` reclaim; gate waktu pakai elapsed-time), `DISMISS` ditolak `SAVE_IN_PROGRESS` saat `saving`, invalidasi navigasi (mismatch → state `error` + `tab-changed` + lock lepas → START baru tanpa reload), `SAVE_FAILED { terminal: true }` untuk `ARCHIVE_TOO_LARGE`, ownership download (`byExtensionId` + jobId; collision counter ` (1)`; `expectedFilename` dibekukan), validasi URL terpisah tegas (popup-originated bawa `sourceUrl`; internal tanpa — kontrol di content), skema `PING` eksplisit + pengecualian echo, escaping Markdown tambah sel tabel/code span/code fence, Stage B drop komentar → recompute stats retained + `comments.csv` absen, kontrak egress yang bisa ditegakkan (URL awal + final-ditolak; residual kontak luar), `DISMISS` masuk semua daftar vocabulary, ide doc alur save/ack/polling direconcile | Temuan P1/P2 review keenam; menutup revoke save hidup, jalur BUSY permanen pasca-navigasi, transisi terminal, ownership file, cakupan validasi URL, konteks escaping, dan konsistensi statistik Stage B |
| 2026-11-03 | Revisi ketujuh setelah review ketujuh: fencing di **setiap batas async** (cek abort setelah await + sebelum `download()` + `downloads.cancel` setelah id; content cek attempt sebelum kembalikan byte ZIP; reclaim tiga syarat termasuk dua `search` ber-jeda), fencing generasi capture (`jobGeneration` + AbortController; tulisan job telat dibuang), binding lama **retired** (STATUS berulang tidak ditolak; admission START bebas job lama), rekonsiliasi save jadi bagian handler `SCRAPE_STATUS` (field `reconcile`, test via runtime listener), fetch API artikel timeout 30 dtk + abort + cancel-before-article terminal, Markdown: code-span padding, fence backtick/tilde (bukan `#`), `1)`/setext/indentasi ≥4 spasi, final-URL policy juga untuk fetch API artikel/komentar + test per jalur, echo binding dibatasi ke kelas bound (acceptance + eksplusivitas discovery diperbaiki), Decision 13 rujuk daftar otoritatif | Temuan P1/P2 review ketujuh; menutup celah async fencing, capture zombie, penolakan START berulang, entry point recovery, timeout artikel, dan kontradiksi skema/kosakata |
| 2026-11-03 | Revisi kedelapan setelah review kedelapan: commit boundary (`tab.url` + abort + attempt sebelum `download()`), content revalidasi URL+generasi sebelum kembalikan byte ZIP, invalidasi → `invalidated: true` → background batalkan save controller, `downloads.cancel` → **rekonsiliasi state terminal** (`complete` → `MARK_SAVED`, bukan gagal), reclaim "kosong" = tanpa `complete`/`in_progress` (kandidat `interrupted` lama diabaikan), pipeline hidup punya deadline `SAVE_ATTEMPT_TIMEOUT_MS` 120 dtk self-abort (recovery tidak pernah menghancurkan pipeline), `fetchBytes` + `signal` eksternal (abort headers/body) dioper ke semua fetch, STATUS + `errorCode`/`errorReason`/`errors`/`invalidated` (outcome terminal dijelaskan popup setelah reopen), Markdown + tilde fence/ordered marker generik/tab indent/code-span space padding, test redirect komentar dipindah ke T21 + gate ketiga jalur di T22 | Temuan P1/P2 review kedelapan; menutup celah navigasi-vs-save, salah baca hasil cancel, reclaim terkunci kandidat lama, kontradiksi kebijakan reclaim, abort media, komunikasi outcome, dan cakupan test |
| 2026-11-03 | Revisi kesembilan setelah review kesembilan: commit authorization (`savePhase: "commit-authorized"`) + jendela cross-process didokumentasikan (bukan janji atomik) dengan revalidasi pasca-`downloadId` → `cancel` + rekonsiliasi (`downloaded-after-invalidation` bila keburu complete), deadline split di submission (pre-submit → self-abort `SAVE_FAILED`; post-submit → tunggu id + rekonsiliasi sebelum retry), Stage A ukur ulang envelope lengkap + cabang `ENVELOPE_TOO_LARGE` (artikel muat tapi residu tidak) + fixture batas, code-span padding spasi hanya untuk isi non-whitespace-only (fixture `" "`/`"  "`/`" a "` teks identik) | Temuan P1/P2 review kesembilan; menutup race commit lintas proses, deadline yang salah setelah submit, celah ceiling envelope, dan regresi whitespace code span |
| 2026-11-03 | Revisi kesepuluh setelah review kesepuluh: fase `savePhase` eksplisit (`commit-authorized` vs `submission-pending` vs `submitted`; timer pre-submission berhenti di invocation, tanpa await antara fase), diagnostic pasca-download dipindah ke tujuan yang feasible (`content record → SCRAPE_STATUS.postDownloadDiagnostics → popup`, bukan `errors.json` ZIP yang byte-nya final), `pendingAttempt` terpisah dari capture job (START baru tidak menghapus) + rekonsiliasi **invalidation-aware** untuk kandidat hasil recovery (`pendingAttempt.sourceUrl`), fixture gabungan worker-mati + navigasi + recovery + deadline dua sisi (sebelum/sesudah invocation) | Temuan P1/P2 review kesepuluh; menutup destinasi diagnostic yang mustahil, bypass kebijakan invalidasi oleh recovery, dan ambiguitas batas deadline |
| 2026-11-03 | Revisi kesebelas setelah review kesebelas: pesan `SAVE_SUBMIT` baru (record `pendingAttempts` dibuat + di-ack **sebelum** invocation — menutup jendela worker mati tepat setelah `download()`), `pendingAttempts` diekspos di `SCRAPE_STATUS` dengan identitas lengkap + reconcile loop **independen dari `saveState` job** (attempt lama tetap jalan setelah START B) + routing pesan terminal per `jobId`+`attemptId` ke record yang cocok, record `diagnostics[]` document-scoped (FIFO 20, bertahan lewat reconcile/START/invalidasi/reopen), fase `submitted` = **invocation** (id diterima belakangan; timer mati di invocation, termasuk promise tertunda), Decision 13 rujuk daftar otoritatif 7 tipe | Temuan P1/P2 review kesebelas; menutup jendela pembuatan record, attempt tak-terjangkau setelah START, retensi diagnostic, dan batas fase yang kontradiktif |
| 2026-11-03 | Revisi kedua belas setelah review kedua belas: flag `invalidated` **monotonic** per pending attempt (URL kembali ke nilai semula tidak memulihkan validitas; flag dicek sebelum perbandingan URL), write-through dua proyeksi (job + record; outcome terminal selalu hapus record; reconcile union dedupe `{jobId,attemptId}`), admission `SAVE_SUBMIT` ketat (job/attempt aktif + `saving` + guard URL, else tanpa record; duplikat tanpa reset; resolved tidak dibuat ulang), `saveStartedAt` immutable per record (reclaim terpisah tidak pakai timestamp job baru) | Temuan P1/P2 review kedua belas; menutup hilangnya riwayat invalidasi, record yang tertinggal/di-reconcile ganda, re-creasi attempt lewat pesan basi, dan elapsed reclaim yang salah |
| 2026-11-03 | Keputusan produk (user): arsip **seadanya mengikuti sesi login** — kalau login berbayar ambil semua yang terlihat, tanpa login ambil yang terlihat. `post.paywall: full\|preview\|unknown` diganti `post.access: "open"\|"session"` + `post.bodyTruncated: boolean\|null` (bukti potong saja, tanpa klaim kelengkapan); warning hanya `bodyTruncated: true`; info "diarsipkan sesuai sesi login" untuk `session`/`null`; `detectPaywall` → `detectAccess`; bukti `restricted` komentar = `bodyTruncated === true`; `errors.json` scope `paywall` → `access`; diperbarui di kontrak, renderer, acceptance, checkpoint, risks, decisions, todo, dan `docs/ideas/substack.md` | Keputusan user: hilangkan penanda `full`/`preview`/`unknown` yang membingungkan; konten selalu diambil apa adanya sesuai sesi tab |
