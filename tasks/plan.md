# Implementation Plan: X Thread Downloader (Chrome Extension MV3)

## Overview

Bangun extension Chrome MV3 DOM-only (tanpa API key / backend) yang dari tab X aktif mengambil tweet utama + semua comments/replies yang ke-load, download media secara lokal, lalu export sekali klik ke HTML rapi (preset LLM), JSON, CSV, Excel — dengan opsi autoscroll on/off. V1 fokus X saja. Repo saat ini kosong, jadi mulai dari scaffold.

Sumber intent: `docs/intent/x-thread-downloader.md`. Referensi kolom Excel: file `XCommentsExporter_asidorenko__12_2026-09-07_15-47.xlsx` (43 kolom: Tweet Id, Full Text, Tweet Url, Media URLs, counts, user info, dst.).

## Architecture Decisions

- **MV3 + content script di tab aktif + service worker tipis + popup**: content script yang pegang DOM/scroll/download blob (hindari CORS/CSP issue di popup), service worker cuma orkestrasi + `chrome.downloads`, popup cuma UI picker. Rationale: constraint "murni dari halaman yang dibuka".
- **Kontrak data dulu (`Tweet` schema) sebelum exporter**: semua exporter (HTML/JSON/CSV/Excel) consume satu `ThreadSnapshot` yang sama, jadi perubahan selector DOM tidak merembet ke 4 exporter.
- **Media di-bundle sebagai ZIP (HTML + `media/` + data file)**: single-file hasil download = gampang upload ke ChatGPT dan dibuka offline. Rationale: intent "media di-download lokal".
- **Lib minimal, zero-build dulu**: vanilla JS + `JSZip` + `SheetJS (xlsx)` via vendor lokal (tanpa bundler di Task 1-6, build step baru kalau perlu di Task 8). Rationale: repo kosong, fail fast di logic scraping dulu bukan di toolchain.
- **Selector DOM diisolasi di satu modul adaptor (`x-adapter.js`) dengan fallback multi-selector**: DOM X berubah-ubah; satu file yang boleh brittle, sisanya stabil.

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
- [ ] Manual check di 2 thread nyata (1 thread kecil <20 replies, 1 thread media): file JSON valid (`python3 -m json.tool`), jumlah tweet > 0, buka 3 tweet url acak valid
- [x] Console content script tanpa error fatal

**Dependencies:** Task 1

**Files likely touched:**
- `src/x-adapter.js` (selector tweet, parse user/text/url/timestamp)
- `src/content.js` (scrape + dedup)
- `src/background.js` (terima snapshot → `chrome.downloads.download`)

**Estimated scope:** Medium (3 files)

### Checkpoint: Foundation

- [x] Extension load unpacked bersih
- [ ] Slice scrape→JSON download jalan di 2 thread nyata
- [ ] Review dengan human sebelum lanjut (selector X rapuh — kunci pola selector sekarang atau revisi)

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
- [ ] Manual check di thread nyata yang sama: count naik vs 16 + `stoppedWhy` terbaca

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
- [ ] Di thread berisi foto, hasil ZIP berisi `media/` dengan file gambar yang bisa dibuka (bukan 0-byte / bukan HTML error page)
- [ ] Manifest di ZIP (`media-manifest.json`) memetakan URL asli → path lokal + tipe
- [ ] Video/GIF: minimal poster/thumbnail ter-download; bila varian mp4 langsung bisa di-fetch, ikut sertakan, bila tidak (mis. m3u8/HLS) catat di manifest sebagai `unresolved` + URL asli tetap disimpan (tidak silent-drop)
- [ ] Nama file aman (sanitize, tanpa collision)

**Verification:**
- [ ] Manual check di 1 thread foto + 1 thread video/GIF: unzip, buka tiap file media, cek manifest lengkap
- [ ] Manual check offline: putus internet, file di ZIP tetap terbuka (untuk yang sudah ter-bundle)

**Dependencies:** Task 3

**Files likely touched:**
- `src/media.js` (baru: inventory + fetch blob + sanitize + manifest)
- `src/zip.js` (baru: bundling via JSZip vendor)
- `vendor/jszip.min.js` (baru)

**Estimated scope:** Medium (3-4 files)

## Task 4b: Opsi video terpisah + ekstraksi caption (LLM tidak makan video)

**Description:** Video itu besar dan LLM tidak bisa proses video — jadi bytes video jangan dipaksa masuk ZIP/upload. Kasih opsi di popup: video masuk ZIP vs download terpisah per-file vs cuma poster. Dan ambil caption/subtitle sebagai pengganti konten video buat konteks LLM (best-effort DOM-only: elemen `<track>` kalau ada; kalau tidak ada, catat `no-captions-in-dom` — URL subtitle X hidup di data API/JS internal, di luar jangkauan isolated world).

**Acceptance criteria:**
- [ ] Opsi popup `videoMode`: `bundle` / `separate` (default — video itu berat dan LLM tidak memprosesnya) / `posters-only` (bytes video di-skip, poster + manifest tetap ada)
- [ ] Caption: `<track src>` di-inventory + di-fetch jadi teks (mis. `media/<id>-cc.en.vtt` + teks bersih di `thread.md` Task 5); tanpa `<track>`, manifest catat alasan, bukan karangan
- [ ] Status popup laporkan mode + ringkasan media (foto N, video bundled/separate/skipped, caption ada/tidak)

**Verification:**
- [ ] E2E fixture: video + `<track>` → caption ke-fetch jadi teks; tanpa track → alasan tercatat
- [ ] Manual check di thread video nyata (mis. tweet Theo yang ada CC): mode separate hasilkan file mp4 + ZIP tanpa video + caption kalau DOM menyediakannya

**Dependencies:** Task 4

**Files likely touched:**
- `src/x-adapter.js` (inventory `<track>`)
- `src/media.js` (fetch vtt + strip jadi teks)
- `src/content.js` / `src/background.js` (mode video, download terpisah)
- `src/popup.html`, `src/popup.js` (opsi mode)

**Estimated scope:** Medium (4-5 files)

### Checkpoint: Capture

- [ ] Thread panjang + media ter-capture jadi ZIP parsial (JSON + media) end-to-end
- [ ] Upload ZIP/JSON hasil ke ChatGPT manual: konteks thread kebaca (cek shows stopper sebelum bangun 3 exporter)
- [ ] Review dengan human sebelum lanjut

### Phase 2: Exporters (semua consume ThreadSnapshot yang sama)

## Task 5: Exporter HTML rapi + teks LLM-ready (offline-first)

**Description:** Render `thread.html` yang rapi dibaca manusia DAN hemat token buat LLM: header thread, tweet urut (reply indent/tree), user + timestamp + metrics ringkas, teks penuh, media sebagai `<img>/<video>` ke path lokal `media/`, plus `thread.md`/`thread.txt` plain-text sebagai alternatif upload ringan.

**Acceptance criteria:**
- [ ] Buka `thread.html` dari ZIP secara offline: teks lengkap terbaca, urutan reply jelas, gambar tampil dari `media/` lokal (tanpa internet)
- [ ] Ada `thread.md` (atau `thread.txt`) satu file/$INLINE yang kalau di-upload ke ChatGPT, model bisa jawab "siapa bilang apa" tanpa missing mayor (tes 3 pertanyaan probe)
- [ ] Escape HTML benar (tidak jebol layout kalau tweet berisi `<`, `&`, emoji, link); link asli tetap bisa diklik

**Verification:**
- [ ] Manual check offline open `thread.html` di Chrome (cache disabled)
- [ ] Manual check upload `thread.md` ke ChatGPT: 3 probe (ringkasan, siapa-reply-siapa, ada media apa) terjawab benar
- [ ] Manual check 1 thread berisi karakter aneh/emoji/mention/hashtag tidak merusak render

**Dependencies:** Task 4

**Files likely touched:**
- `src/export-html.js` (baru)
- `src/export-md.js` (baru, atau gabung ke export-html)
- `src/content.js` / `src/background.js` (tambah pilihan format)

**Estimated scope:** Medium (2-3 files)

## Task 6: Exporter JSON final + CSV + Excel (kolom ala XCommentsExporter)

**Description:** Finalisasi exporter data: JSON terstruktur penuh, CSV flat, dan `.xlsx` yang kolomnya meniru contoh XCommentsExporter (43 kolom: Tweet Id, Full Text, Tweet Url, Media URLs, Media Types/Count, Created At, Conversation Id, Reply refs, counts, language, URLs, hashtags, mentions, user fields, Scraped At). Field yang tidak ada di DOM diisi kosong + didokumentasikan, bukan dihalu.

**Acceptance criteria:**
- [ ] Header `.xlsx` 1:1 dengan contoh (urutan + nama kolom sama), 1 baris per tweet, `Media URLs` menunjuk path lokal bila ter-download + URL asli bila tidak
- [ ] CSV bisa dibuka di Excel/Sheets tanpa kolom geser (quoting benar untuk teks berisi koma/newline/quote)
- [ ] JSON valid dan memuat semua field schema Task 1 + `scrapedAt` + `mediaManifest`
- [ ] Dokumen `docs/export-columns.md` memetakan tiap kolom → sumber DOM atau `empty (no DOM source)` secara jujur

**Verification:**
- [ ] Bandingkan header xlsx hasil vs header file contoh via script (diff header = kosong)
- [ ] Buka CSV + xlsx di spreadsheet: tidak ada baris rusak pada thread berisi koma/quote/newline/emoji
- [ ] `python3 -m json.tool` lolos untuk JSON hasil

**Dependencies:** Task 4 (butuh media manifest); paralelisable dengan Task 5 setelah Task 4 selesai

**Files likely touched:**
- `src/export-json.js` (baru/finalisasi)
- `src/export-csv.js` (baru)
- `src/export-xlsx.js` (baru, via SheetJS vendor)
- `vendor/xlsx.full.min.js` (baru)
- `docs/export-columns.md` (baru)

**Estimated scope:** Medium (4-5 files)

### Checkpoint: Exporters

- [ ] Dari 1 thread yang sama dihasilkan 5 artefak konsisten (json/csv/xlsx/html/md) dengan tweet count yang sama
- [ ] Upload `thread.md`/HTML ke ChatGPT lolos 3 probe; xlsx/csv/json dibuka tanpa corrupt
- [ ] Review dengan human sebelum polish UI

### Phase 3: Mekanisme utama (naik prioritas — DOM-only jauh dari ekspektasi)

## Task 7: Network response capture via MAIN-world hook

**Description:** Berhenti mengandalkan DOM malas sebagai sumber utama dan berhenti menebak nama endpoint. Hook di MAIN world membungkus `fetch`/`XHR` dan menangkap SEMUA respons JSON X (tanpa filter nama endpoint), teruskan ke isolated world via event. Popup dapat tombol "Download network log" untuk mengunduh hasil tangkapan — dari log itulah endpoint data + parser dilatih. Tanpa permission baru, tanpa API key, tanpa backend — tetap hak sesi tab.

**Acceptance criteria:**
- [ ] Mekanisme hook terbukti di fixture: `fetch` + `XHR` yang di-stub tertangkap + payload sampai ke content script (E2E)
- [ ] Tombol popup "Download network log" menghasilkan 1 file JSON berisi entri `{url, status, mime, truncated, body}` dengan cap ukuran/jumlah
- [ ] Parser (`x-graphql.js`) dilatih dari **network log asli hasil tangkapan user** (BUKAN tebakan skema): tweet, counts, user, varian mp4, subtitle terekstrak
- [ ] Hasil gabungan: counts bukan 0 lagi bila API menyediakannya; video mp4 langsung ter-download; subtitle masuk caption; DOM fallback tidak regresi (semua test lama hijau)
- [ ] Tidak ada request ke server manapun selain X/CDN-nya; tidak ada `eval`/remote-code; hook hanya baca respons, tidak mengubah request

**Verification:**
- [ ] E2E mekanisme (stub fetch/XHR) hijau headed
- [ ] Parser hijau lawan fixture dari network log asli
- [ ] Manual check thread Theo: counts terisi, mp4 ke-download (mode separate), subtitle ada bila API menyediakannya

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
- [ ] Alur 1-klik: buka thread → klik extension → Download → ZIP terdownload tanpa buka devtools
- [ ] Progress terlihat selama scrape + download media; cancel berfungsi
- [ ] Error state eksplisit per kasus: bukan halaman thread, 0 tweet terdeteksi, media gagal sebagian (tetap hasilkan ZIP + `errors.json`, tidak gagal total)

**Verification:**
- [ ] Manual check 3 skenario: thread kecil, thread panjang+media, halaman bukan-thread (mis. home) → pesan error benar
- [ ] Manual check preset LLM vs Data menghasilkan isi ZIP yang berbeda sesuai preset
- [ ] Tidak ada error console yang tidak tertangani

**Dependencies:** Task 5, Task 6

**Files likely touched:**
- `src/popup.html`, `src/popup.js`, `src/popup.css` (atau 1 file)
- `src/content.js` (terima opsi format + autoscroll + cancel)
- `src/background.js` (progress relay + final download)

**Estimated scope:** Medium (3-4 files)

## Task 9: Hardening + packaging + uji ChatGPT E2E

**Description:** Keras-kan yang rapuh: fallback selector adaptor, batas memori/thread raksasa, sanitasi nama file, permission minimal (`activeTab`, `scripting`, `downloads` — tanpa `host_permissions` luas bila bisa), ikon, `README` instalasi unpacked, dan uji E2E final termasuk upload ke ChatGPT.

**Acceptance criteria:**
- [ ] `permissions` minimal dan terjustifikasi di README; tidak ada `eval`/remote-code; tidak ada request ke server manapun (verifikasi via DevTools Network selama scrape: hanya ke x.com/pbs.twimg.com)
- [ ] Lolos uji di 3 thread nyata berbeda (kecil, panjang, media/video) + 1 halaman bukan-thread
- [ ] Ada `README.md` instalasi (load unpacked) + cara pakai + batasan dikenal (video HLS, tweet terproteksi, DOM X bisa berubah)
- [ ] Hasil akhir: 1 ZIP per download yang siap upload ke ChatGPT dan lolos 3 probe diskusi

**Verification:**
- [ ] Checklist manual 3 thread + catat hasil (count tweet, media ok/unresolved)
- [ ] Network check: tidak ada egress selain CDN X selama operasi
- [ ] Muat ulang extension dari folder bersih dan ulangi alur 1-klik tanpa error

**Dependencies:** Task 7

**Files likely touched:**
- `manifest.json` (final permissions, icons)
- `icons/*` (baru)
- `README.md` (baru)
- `src/x-adapter.js` (fallback selector + batas)
- `TESTLOG.md` (baru, catat hasil 3 thread)

**Estimated scope:** Medium (4-5 files)

### Checkpoint: Complete

- [ ] Semua acceptance criteria Task 1-9 terpenuhi
- [ ] ZIP final dari thread nyata bisa di-upload ke ChatGPT dan diajak diskusi tanpa missing mayor
- [ ] Siap review manusia; belum publish ke Chrome Web Store (out of scope v1)

## Backlog (post-V1, belum di-commit ke task)

(tidak ada — B1 network interception sudah dipromosikan jadi Task 7)

### B2: Dukungan situs generik (visi Arsip)

**Konteks:** Popup sekarang menolak situs non-X secara eksplisit
(`activeThreadTab`). Visi repo adalah downloader generik: buka halaman
apa saja → arsip offline + konteks LLM. V1 mengunci X dulu agar mekanik
inti (capture, merge, exporter, ZIP) terbukti sebelum digeneralisasi.

**Arah desain (draf, belum diputus):**
- Kontrak `SiteAdapter`: `detect(url, document)`, `scrapeList()`,
  `scrollMore()`, `mediaInventory()` — `x-adapter.js` jadi implementasi
  pertama; adapter generik (readability-style: artikel + gambar) kedua
- Manifest `matches` meluas per adapter yang terdaftar; permission
  tetap minimal per-match, tanpa `<all_urls>` blanket
- Hook network tetap X-spesifik (opt-in per adapter); generic path
  murni DOM + fetch media secontext
- Popup: pesan unsupported berubah jadi pemilih adapter / fallback
  generic tornado

**Kriteria selesai (draf):** 1 situs non-X (mis. artikel blog) terarsip
end-to-end (HTML/MD + gambar lokal + ZIP) dengan test E2E fixture-nya
sendiri; tidak ada regresi jalur X (seluruh suite hijau).

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
