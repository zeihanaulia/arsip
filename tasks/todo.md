# Todo: X Thread Downloader

Sumber: `docs/intent/x-thread-downloader.md` | Plan: `tasks/plan.md`

## Phase 0: Foundation + first working slice

- [x] Task 1: Scaffold MV3 + kontrak data ThreadSnapshot
- [x] Task 2: Scraper minimal + download JSON (viewport-only)

## Checkpoint: Foundation

- [x] Extension load unpacked bersih
- [x] Slice scrape→JSON jalan di 2 thread nyata
- [x] Review human sebelum lanjut

## Phase 1: Capture lengkap + media lokal

- [x] Task 3: Auto-expand + autoscroll opsional + ordering + reply-tree
- [x] Task 3b: Tuning completeness + observabilitas + styling dasar popup
- [x] Task 4: Media inventory + download lokal + bundle ZIP
- [x] Task 4b: Opsi video terpisah + ekstraksi caption

## Checkpoint: Capture

- [x] ZIP parsial (JSON + media) end-to-end jalan
- [x] Upload hasil ke ChatGPT kebaca (cek stopper)
- [x] Review human sebelum lanjut

## Phase 2: Exporters

- [x] Task 5: Exporter HTML rapi + teks LLM-ready (offline-first)
- [x] Task 6: Exporter JSON final + CSV + Excel (kolom ala XCommentsExporter)

## Checkpoint: Exporters

- [x] 5 artefak konsisten (json/csv/xlsx/html/md), count sama
- [x] ChatGPT lolos 3 probe; spreadsheet tidak corrupt
- [x] Review human sebelum polish UI

## Phase 3: Mekanisme utama

- [x] Task 7: Network response capture via MAIN-world hook
- [x] Blocker eksternal: network log asli dari user (disediakan, parser dilatih darinya)

## Phase 4: UX + QA packaging

- [x] Task 8: Popup UI final (preset + opsi + progress + error)
- [x] Task 9: Hardening + packaging + uji ChatGPT E2E

## Checkpoint: Complete

- [x] Semua acceptance Task 1-9 terpenuhi
- [x] ZIP final siap upload ke ChatGPT tanpa missing mayor
- [x] Siap review; belum publish ke Web Store (out of scope v1)

## Phase 5: V2 situs generik (O'Reilly, arsip-halaman)

- [ ] Task 10: Kontrak SiteAdapter + registrasi
- [ ] Task 11: Adapter O'Reilly
- [ ] Blocker eksternal: 1 file HTML halaman O'Reilly tersimpan
- [ ] Task 12: Manifest + popup routing + ZIP O'Reilly

## Checkpoint: V2-OReilly

- [ ] Chapter O'Reilly terarsip end-to-end + diskusi ChatGPT
- [ ] Jalur X tidak regresi
- [ ] Review human sebelum adapter situs ketiga

## Phase 6: V2 adapter ketiga — transcript YouTube (1 video → MD buat LLM)

- [x] Task 13a: Branch experiment/youtube dari main
- [x] Task 13b: Engine multi-site (cherry-pick registry + hook/netlog youtube; routing download nyusul Task 16)
- [x] Task 13c: Sampel timedtext + shape notes (bahan latih parser)
- [x] Task 14: Parser YouTube (youtube-graphql.js) — timedtext jadi VideoPayload
- [x] Task 15: Exporter video.md + video.json (LLM-ready)
- [x] Task 16: Wiring tab — registry + manifest + content route + background path
- [x] Task 17: Popup + tests (manual video asli + probe ChatGPT: user)
- [ ] Checkpoint: Complete (Phase 6) — manual + review human

## Checkpoint: Complete (Phase 6)

- [x] MD video asli lolos uji manual (download transcript → zip jadi)
- [ ] Probe ChatGPT rujukan menit (opsional, saat butuh ringkas)
- [x] Jalur X tidak regresi (135/135 hijau)
- [ ] Review human; branch tetap pisah sampai diputuskan merge

## Phase 7: X Article (long-form) sebagai root thread

- [x] Task 18: Tangkap X Article (network `article_results` + reader DOM) jadi root tweet
- [x] Task 18b: Adaptasi app x-web baru (SSR inline + DOM tanpa data-testid) — 2026-11-27
  - [x] DOM baru: `<article>` + status link, text utility class, avatar `alt="@handle"`, metrics `aria-label`
  - [x] SSR inline capture via MutationObserver `document_start` (script dihapus saat hydration)
  - [x] Parser `tweet_result_by_rest_id`/`details`/`counts`/`reply_to_results`/`media_entities2` + article snake_case + `createdAt` fallback
  - [x] Article reader DOM `[data-article-part]` (title/byline/body/cover)
  - [x] Live check status + article (Chrome asli); 180 test + quality hijau
- [ ] Checkpoint: X Article — manual E2E di thread artikel asli + review human
- [ ] Manual pasca-Task 18b: reload extension, 1 download ZIP dari tab X

### Bugfix capture awal (2026-11-25)

- [x] Listener network X/YouTube siap pada `document_start`; regresi respons awal + 168/168 test hijau; quality hijau pada snapshot kode (log mentah di root tetap tidak diformat)
- [ ] Manual: reload extension dan tab, export log sebelum scrape; pastikan payload tweet tertangkap (log pasca-scrape masih bisa kosong karena buffer dikonsumsi)
- [x] Fallback network saat DOM kosong: merge payload sebelum guard `EMPTY_THREAD`; uji worker START → STATUS → export artikel, serta DOM+API kosong tetap ditolak; 170/170 test + quality snapshot kode hijau

## Phase 8: Substack article + comments (custom domain)

- [ ] Task 19: Deteksi + inject on-demand + artikel → ZIP pertama
  - [ ] `SubstackDetect.probe` (`preloads-json`; DOM marker = deteksi saja) +
    `detectAccess` → `access: open|session` + `bodyTruncated` (bukti potong saja,
    tanpa `full`/`preview`/`unknown`)
  - [ ] `SUBSTACK_INJECTION` idempotent via `activeTab` + `scripting.executeScript`
    (`media.js` IIFE guard; readiness map dijalankan selalu, tanpa shortcut caps;
    partial injection diperbaiki)
  - [ ] State job di content script: `jobId` + `documentToken` + `BUSY` per tab +
    state terminal (`error`/`idle`/`saved`) vs non-terminal + cancel-flag tanpa
    melepas lock + `DISMISS` (hanya `saveState` `idle`/`failed`; `saving` →
    `SAVE_IN_PROGRESS`) + **invalidasi navigasi** (mismatch `location.href` vs
    `job.sourceUrl` → state `error` + `tab-changed`, lock lepas, START baru jalan
    tanpa reload)
  - [ ] Save lifecycle: `idle/saving/saved/failed` + `attemptId` (fencing di
    `BUILD_ZIP` → `STALE_ATTEMPT` sebelum mulai **dan sebelum kembalikan byte ZIP**;
    background cek abort setelah setiap await + sebelum `download()` + `downloads.cancel`
    bila abort setelah id ada; transisi basi diabaikan) + reclaim **tiga syarat**
    (elapsed > 60 dtk + tanpa pipeline in-flight + dua `search` kosong ≥ 1 dtk) +
    `downloadId` + `expectedFilename` (dibekukan via `DOWNLOAD_STARTED`) +
    `downloads.onChanged` (observer sebelum download) + `search({ id })` +
    `search({ query: [jobId] })` + filter kepemilikan (`byExtensionId` + jobId);
    `SAVE_FAILED` (+ `terminal: true` → state `error`) di setiap batas gangguan;
    `SAVE_RESULT` = klaim atomik (diteruskan ke tab), `GET_RESULT` read-only;
    filename `...-<date>-<jobId>.zip` (jobId penuh, ≤ 200 karakter)
  - [ ] Fencing generasi capture (`jobGeneration` + AbortController; tulisan job A
    telat dibuang) + invalidasi navigasi (binding lama **retired**, STATUS berulang
    tidak ditolak, admission START bebas dari job lama)
  - [ ] Rekonsiliasi save = bagian handler `SCRAPE_STATUS` (field `reconcile`,
    loop `pendingAttempts` **independen dari `saveState` job**, cek invalidasi
    `pendingAttempt.sourceUrl`), diuji lewat runtime listener + skenario attempt lama
    setelah START job baru
  - [ ] `SAVE_SUBMIT` sebelum invocation (ack = prasyarat commit; **admission ketat**:
    job aktif + attempt aktif + `saving` + guard URL lolos, else `STALE_ATTEMPT` tanpa
    record; duplikat tanpa reset, resolved tidak dibuat ulang) → record
    `pendingAttempts` identitas lengkap + `saveStartedAt` immutable; pesan terminal
    routing per `jobId`+`attemptId` + **write-through** (update ke proyeksi job DAN
    record; outcome terminal selalu hapus record; union dedupe `{jobId,attemptId}`);
    flag `invalidated` **monotonic** (URL kembali tidak memulihkan validitas);
    reclaim terpisah pakai `pendingAttempt.saveStartedAt`; record `diagnostics[]`
    document-scoped (FIFO 20, bertahan lewat reconcile/START/reopen)
  - [ ] Fetch API artikel: timeout 30 dtk + abort; cancel sebelum artikel →
    `cancelled-before-article` (terminal, tanpa ZIP kosong)
  - [ ] `src/messaging.js`: tipe `GET_RESULT`/`SAVE_RESULT`/`SAVE_SUBMIT`/
    `MARK_SAVED`/`DOWNLOAD_STARTED`/`SAVE_FAILED`/`DISMISS`; coverage vocabulary
    diperluas ke `SUBSTACK_INJECTION` (`tests/manifest.test.js`, termasuk handler
    `DISMISS`/`SAVE_SUBMIT`); route Substack sebelum handler global; tiga kelas
    skema (bootstrap `PING`/`SCRAPE_START` — PING dikecualikan echo; discovery
    `SCRAPE_STATUS`; bound — echo binding) + validasi URL terpisah (popup-originated
    bawa `sourceUrl`; internal tanpa `sourceUrl`, kontrol di content);
    `SCRAPE_START` ack sinkron; tanpa `SCRAPE_PROGRESS` runtime; tanpa `tabId` →
    `BAD_BINDING`
  - [ ] `ArticleSnapshot` (identity preloads/API) + `post.json`/`post.md` dasar +
    route background (relay tipis, tanpa job state di worker)
  - [ ] Uji 3 publication + halaman non-post + stale SPA + post berbayar + envelope
    >24 MB (`ARTICLE_TOO_LARGE`/`ENVELOPE_TOO_LARGE`)
  - [ ] Manual lifecycle: double-click, popup reopen, tab switch, reload tab,
    extension reload, service-worker termination (termasuk antara download dan
    `MARK_SAVED`), cancel, download interrupted

## Checkpoint: Injection + article JSON (Phase 8)

- [ ] Load unpacked: post Substack terdeteksi; ZIP per preset (`llm`: `post.md` +
  sidecar; `data`: `post.json` + sidecar) jadi
- [ ] Klik Download dua kali / buka popup ulang / reload extension: tidak ada redeclare
  atau listener ganda
- [ ] Reload tab / pindah tab saat fetch: `JOB_LOST`/`TAB_CHANGED`, tidak ada ZIP nyasar
- [ ] Terminasi service worker lalu buka popup: reconnect ke job di tab (token dari
  STATUS), bukan job baru; `SAVE_RESULT` idempoten (klaim + `downloads.search` +
  filter `byExtensionId`/jobId); save hidup → `reconcile: still-saving` (recovery
  tidak menghancurkan pipeline hidup; deadline `SAVE_ATTEMPT_TIMEOUT_MS` 120 dtk
  **hanya fase pre-submission** — setelah invocation timer berhenti, tunggu id +
  rekonsiliasi dulu); `pendingAttempt` bertahan terpisah dari capture job; reclaim =
  tiga syarat (elapsed > 60 dtk + tanpa pipeline + dua search tanpa
  `complete`/`in_progress`, kandidat `interrupted` lama diabaikan); `BUILD_ZIP` basi
  → `STALE_ATTEMPT` (tak ada ZIP ganda)
- [ ] Commit authorization + boundary: content set `savePhase: "commit-authorized"`
  saat kembalikan byte; `submission-pending` masuk tepat sebelum invocation (tanpa
  await); revalidasi abort + `tab.url` + attempt sebelum `downloads.download`;
  **revalidasi pasca-`downloadId` + rekonsiliasi invalidation-aware** (jendela
  cross-process didokumentasikan): kandidat `complete` dicek vs
  `pendingAttempt.sourceUrl` → cocok → `MARK_SAVED`, beda → `MARK_SAVED` +
  `postDownloadDiagnostics` (`downloaded-after-invalidation` di STATUS/popup, **bukan**
  di ZIP final); `in_progress` tidak valid → `cancel`; navigasi saat ZIP → content
  revalidasi URL sebelum byte; STATUS `invalidated: true` → pipeline save dibatalkan
- [ ] Download `interrupted` → retry; lock tidak dilepas sebelum download complete;
  callback basi (`attemptId` lama) diabaikan; `SAVE_FAILED { terminal: true }` →
  state `error`
- [ ] Terminal failure (`POST_IDENTITY_MISMATCH`/`ARTICLE_TOO_LARGE`/
  `ARCHIVE_TOO_LARGE`) → Download lagi tanpa reload jalan; `DISMISS` melepas lock
  (tapi ditolak `SAVE_IN_PROGRESS` saat `saving`); SPA navigation (dokumen sama) →
  invalidasi + `TAB_CHANGED` + binding retired + START baru tanpa reload; STATUS
  membawa `errorCode`/`errorReason` (outcome terminal dijelaskan popup, termasuk
  setelah reopen)
- [ ] Dua job beruntun: `BUSY` + reconnect; cancel tetap menghasilkan ZIP partial
- [ ] Halaman non-post ditolak eksplisit; preloads stale dijawab lewat API
- [ ] `src/messaging.js` menerima tipe baru tanpa memutus routing X/YouTube
- [ ] Review human sebelum exporter/media (Task 20)

- [ ] Task 20: Exporter artikel + media CDN + HTML offline
  - [ ] Sanitasi body + converter Markdown terstruktur + footnote ID di **semua**
    elemen retained + anchor Markdown (`<a id="arsip-*">`); verifikasi berbasis input
    reference→target (bukan cuma sisa link resolve)
  - [ ] Embed diinventarisir sebelum sanitasi; allowlist atribut per tag; `embeds`
    ikut transport sampai ZIP
  - [ ] Parse/sanitize gate: fixture jahat → nol request; fallback pre-strip bila gagal
  - [ ] Media allowlist host → `media/` + manifest + cap 40/12 MB; **URL awal** di
    luar allowlist nol request; `validateResponse` di `fetchBytes` **sebelum body
    dibaca** + `signal` capture (abort headers/body); fixture `allowed→outside`
    (final ditolak, byte tidak dikonsumsi) vs `allowed→outside→allowed` (terima +
    catat `redirect-hop`); final-URL same-origin untuk fetch API **artikel** (test
    redirect media + artikel; jalur komentar di Task 21); acceptance egress =
    kontrak awal/final + residual risk (bukan klaim nol)
  - [ ] Budget Stage A/B tunggal (UTF-8 byte / byte file, **ukur ulang envelope
    lengkap setelah tiap langkah**); `ARTICLE_TOO_LARGE`/`ENVELOPE_TOO_LARGE`/
    `ARCHIVE_TOO_LARGE` (`SAVE_FAILED { terminal: true }`) eksplisit + fixture
    envelope residu; drop komentar Stage B → **recompute stats ke retained** +
    `comments.csv` absen
  - [ ] Escaping per konteks: `escapeHtml` (HTML) + `escapeMarkdownText` (teks
    polos/multiline: fence `~~~`, ordered marker generik `N.`/`N)`, setext `===`,
    indentasi ≥4 spasi/tab) + sel tabel (`\|`, `<br>`) + code span (padding backtick
    edge; padding spasi hanya bila isi ada karakter non-spes — whitespace-only tidak
    dipadding) + code fence (backtick/tilde, bukan `#`) + `encodeMarkdownDestination`
    + fixture jahat (assert struktur/teks render, bukan substring)
  - [ ] `post.json`: `bodyHtml` tersanitasi + `bodyHtmlSource` original (tidak dirender)
  - [ ] `post.html` offline + `post.json` final + `errors.json` (dari `snapshot.errors`)
  - [ ] Preset matrix `src/substack-presets.js` + test matrix
  - [ ] Uji 28 gambar Tomas + parse/sanitize tanpa request + buka HTML network aktif

## Checkpoint: Article slice (Phase 8)

- [ ] 3 publication menghasilkan ZIP artikel per preset (`llm`: MD+HTML; `data`: JSON)
- [ ] `post.html` dengan network aktif tidak melakukan request remote; fixture jahat
  parse/sanitize → nol request
- [ ] Akses per precedence `detectAccess`: free penuh → `open`/`false`; free kosong →
  `null`; berbayar + marker `.paywall` ATAU ratio < 0,9 → `session`/`true` (+ warning);
  berbayar tanpa marker + ratio ≥ 0,9 → `session`/`null` (info sesi login, tanpa
  warning); `bodyRatio` tercatat; tidak ada `full`/`preview`/`unknown`
- [ ] Footnote: pasangan reference→target dari body mentah terpenuhi di MD + HTML;
  escaping fixture jahat HTML dan Markdown aman
- [ ] `post.md` Tomas lolos 3 probe ChatGPT
- [ ] Jalur X/YouTube tidak regresi
- [ ] Review human sebelum komentar masuk

- [ ] Task 21: Komentar lengkap + tree + CSV
  - [ ] Fetch comments API + stream byte cap 16 MB (fallback `blob.size`, bukan
    `.length`) + bounded traversal + ID/`maxComments` validation + **final-URL
    same-origin sebelum body** (redirect ke origin lain → abort → `unavailable`;
    test redirect jalur komentar di sini, gate ketiga jalur di Task 22)
  - [ ] Envelope transport memuat `embeds` (ikut selalu, diuji sampai ZIP)
  - [ ] Normalize/filter/reparent/cap 2.000; dedupe **traverse semua kemunculan** +
    merge rekursif + **anti-siklus** (ID ∈ ancestors → edge dibuang, anak dipromosikan
    ke non-leluhur, hasil DAG; fixture `A→B→A→C`); `published` = ID unik; stats raw
    vs normalized vs capped; `declared`/`likes` null bukan 0; total tak-diamati =
    `null`
  - [ ] State table komentar: `captured`/`empty`/`restricted` (butuh bukti
    `post.bodyTruncated === true`)/`unavailable`/`too_large`/`cancelled`; envelope
    >24 MB → `too_large` tanpa kirim raw (total = `null`); `too_large` + `zip-budget`
    (Stage B) → stats retained (`captured: 0`, `dropped: published`, observasi di
    `errors.json`)
  - [ ] Render MD/HTML/JSON/CSV + author badge + `originalParentId` + escaping
  - [ ] Fixture Tomas beku anonymized + expected (1045/727/8/92/5/6); Slow Boring 238,
    The Free Press 87, paid restricted (`bodyTruncated: true`), subscriber `session`
    (bukti sesuai precedence), free all-filtered `empty`

## Checkpoint: Comments (Phase 8)

- [ ] Tomas `1045/1061` (live drift dicatat), Slow Boring `238`, The Free Press `87`
- [ ] Filtered parent → anak published promosi, tidak ada yang hilang
- [ ] Post berbayar anonymous `restricted` (bukti `bodyTruncated: true`); subscriber
  `captured` (`session`/`null` atau `true` bila ada marker); free all-filtered `empty`;
  declared-mismatch (`bodyTruncated !== true`) `empty` — bukan `restricted`
- [ ] API failure/body >16 MB/envelope >24 MB ditandai jujur (`unavailable`/`too_large`);
  total tak-diamati = `null`
- [ ] Duplikat ID: children unik kemunculan kedua tetap muncul; `published` = ID unik
- [ ] `comments.csv` rows == `captured`; escaping valid; null vs 0 benar
- [ ] `post.md` Tomas lolos 3 probe ChatGPT (jumlah, tree, author replies)
- [ ] Review human sebelum UX finalization

- [ ] Task 22: Popup UX + docs + regression + manual E2E
  - [ ] Mode Substack + `includeComments` + `maxComments` + preset matrix
  - [ ] Reconnect ke job aktif via `SCRAPE_STATUS` (token dari STATUS) + `BUSY`/
    `JOB_LOST`/`TAB_CHANGED` + `SAVE_RESULT` idempoten + save lifecycle
    (`saving`/`failed`/`retry`/reconcile) + progress/result/cancel/error +
    **outcome terminal dari STATUS** (`errorCode`/`errorReason`, termasuk setelah
    reopen)
  - [ ] `Check connection` + `ensureSubstackInjected` (readiness map selalu jalan) +
    caps `substack: 1`
  - [ ] Gate egress: test redirect final-URL **ketiga jalur** (media, artikel,
    komentar) hijau
  - [ ] Verifikasi `docs/ideas/substack.md` tidak kontradiktif + README +
    `docs/export-columns.md`
  - [ ] Manual 4 post + manual lifecycle (termasuk terminasi service worker antara
    download dan `MARK_SAVED`, download interrupted, navigasi saat save)
  - [ ] Tests + regresi X/YouTube

## Checkpoint: Complete (Phase 8)

- [ ] Semua acceptance Task 19-22 terpenuhi
- [ ] 4 post manual (3 gratis + 1 berbayar) terarsip + probe ChatGPT
- [ ] `post.html` dengan network aktif bersih (tanpa request remote)
- [ ] Preset matrix benar; sidecar wajib ikut
- [ ] X/YouTube regression hijau
- [ ] Tidak ada permission baru / `host_permissions`
- [ ] Manual lifecycle (double-click/reopen/tab switch/reload tab/worker
  termination/cancel/BUSY) lolos
- [ ] Review human + keputusan merge `experiment/substack`

## Backlog (post-V1)

(none)
