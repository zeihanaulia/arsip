# Substack Article + Comments → Arsip

Status: planned (2026-11-03), masuk Phase 8 di `tasks/plan.md` (Task 19-22).

## Problem Statement

How Might We mengarsipkan satu post Substack — **artikel + seluruh komentar yang bisa
diakses** — dari tab aktif, termasuk publication yang memakai custom domain, jadi satu
ZIP offline (MD/HTML/JSON + media) yang siap di-upload ke ChatGPT, tanpa backend, tanpa
API key, dan tanpa host permission luas?

Contoh target: `https://unchartedterritories.tomaspueyo.com/p/mountains` (custom domain,
1.061 komentar menurut `comment_count`).

## Recommended Direction

**Deteksi berbasis konten + inject on-demand + same-origin comments API.**

- Deteksi bukan dari hostname. Baca `script#preloads-json[type="application/json"]`
  (hydration data Substack); marker DOM `article.newsletter-post` /
  `.available-content .body.markup` hanya dipakai untuk **mendeteksi** halaman post
  saat `preloads` absen — **bukan** sumber artikel.
- Karena domain publication tak terbatas, jangan pakai `content_scripts.matches`.
  Inject adapter saat user klik extension lewat `activeTab` +
  `chrome.scripting.executeScript`. Permission tetap `activeTab`, `scripting`,
  `downloads`.
- Artikel diambil dari `preloads.post.body_html` bila `canonical_url` cocok dengan URL
  aktif; kalau tidak (stale SPA / preloads absen) → `GET /api/v1/posts/{slug}`
  (same-origin) dengan verifikasi `slug`/`canonical_url`. Kalau keduanya gagal →
  `POST_IDENTITY_MISMATCH` (gagal eksplisit, jangan arsipkan post yang salah).
- Komentar diambil dari `GET /api/v1/post/{post_id}/comments?all_comments=true`
  (same-origin, cookie tab). Ini endpoint yang dipakai web Substack sendiri; bukan API
  key, bukan backend. Satu request mengembalikan seluruh tree komentar.
- Output: `post.md` (artikel + komentar), `post.html`, `post.json`, `comments.json`,
  `comments.csv` (preset data), `media/`, `media-manifest.json`, `errors.json` —
  semuanya dalam satu ZIP (matrix preset di `tasks/plan.md` Phase 8).
- Akses: arsipkan **seadanya sesuai sesi login** — kalau user login + berbayar, ambil
  semua yang terlihat; tanpa login, ambil preview-nya. Penanda `post.access:
  "open" | "session"` + `post.bodyTruncated: boolean | null` (bukti potong saja; tanpa
  klaim `full`). Warning "konten mungkin terpotong" hanya bila `bodyTruncated: true`.
  `comments.state: "restricted"` hanya bila `bodyTruncated === true`; jangan bypass.

## Kenapa Arah Ini

1. **Custom domain tidak bisa di-enumerate.** `unchartedterritories.tomaspueyo.com`,
   `www.thefp.com`, `www.noahpinion.blog` semuanya Substack, tapi `detectAdapter(url)`
   yang sekarang cuma cocokkan hostname tidak akan mengenalinya.
2. **`preloads-json` konsisten.** Di semua halaman Substack yang dicek (post, home,
   archive) script ini ada. Object `post` berisi body + metadata; cukup guard agar hanya
   post `/p/<slug>` yang dianggap target.
3. **Komentar lengkap tersedia dalam satu request.** Halaman post cuma merender 2
   komentar + link "more comments"; API-nya mengembalikan seluruh nested tree.
4. **Media aman lewat CDN.** `<img src>` memakai `substackcdn.com/image/fetch/...` dengan
   `access-control-allow-origin: *`. URL S3 mentah tidak punya ACAO, jadi download lewat
   CDN.
5. **Lebih sederhana dari X.** Satu halaman = satu artikel; tidak ada scroll thread,
   reply-tree DOM, atau variasi media sebanyak X.

## Bukti / Findings (2026-11-03)

### Halaman artikel

- Marker utama:
  - `script#preloads-json[type="application/json"]`
  - `article.newsletter-post`
  - `.post-header`, `h1.post-title`, `.subtitle`
  - `.available-content > .body.markup`
  - `.paywall`, `.paywall-title`, `.paywall-cta` (post berbayar)
  - `.comments-section`, `.comment-list-items`, `.more-comments`
- Field `preloads.post` yang relevan: `id`, `slug`, `title`, `subtitle`, `body_html`,
  `post_date`, `audience`, `canonical_url`, `comment_count`, `reaction_count`,
  `write_comment_permissions`, `podcast_url`, `audio_items`.
- `preloads.pub.custom_domain` berisi domain publication. Jangan pakai
  `domainInfo.isSubstack`: di custom domain yang dicek nilainya justru `false`.
- `preloads-json` juga ada di homepage/archive (tanpa object `post`), jadi deteksi wajib
  cek `post` + `canonical_url` path `/p/`.

### Paywall

| Post | `audience` | `body_html` | `wordcount` |
|---|---|---:|---:|
| Tomas Pueyo — “Why Warm Countries Are Poorer” | `everyone` | 168.207 char | 3.190 |
| Slow Boring — “What did the right win with Malfoid?” | `only_paid` | 525 char | 1.634 |
| Tomas Pueyo — “The End of Paris” | `only_paid` | 5.083 char | 1.326 |

Kesimpulan: `audience !== "everyone"` + body pendek = preview. Jangan klaim full article.
Kalau user subscribed, body yang dikirim server akan penuh; kita arsipkan apa adanya.

### Komentar

Endpoint:

```
GET /api/v1/post/{post_id}/comments?all_comments=true
```

Hasil uji:

| Post | Tipe | `comment_count` | Hasil API |
|---|---|---:|---:|
| Tomas Pueyo — “Why Warm Countries Are Poorer” | free | 1.061 | 1.050 node, 727 top-level, depth 8, 2,2 MB |
| Slow Boring — free post | free | 238 | 238 komentar |
| The Free Press — free post | free | 87 | 87 komentar |
| Slow Boring — paid post | `only_paid` | 226 | 0 (restricted anonymous) |
| The Free Press — paid post | `only_paid` | 9 | 0 (restricted anonymous) |

Catatan:

- Selisih `comment_count` vs hasil API wajar: ada `deleted`, `suppressed`, `blocked`,
  `moderator_removed`. Di thread Tomas: 1.050 node, 1.045 `published`.
- `automod_hidden_comments` datang terpisah (16 di thread Tomas); default jangan
  dimasukkan.
- `metadata.is_author` menandai balasan penulis post (92 balasan Tomas di thread itu).
- `children[]` menyimpan reply tree; `ancestor_path` menyimpan parent id.
- Body komentar ada di `body` (teks polos) dan `body_json` (DraftJS). Pakai `body`.
- Tidak ada attachment/media di sample komentar.
- **Tidak ada pagination.** Parameter `limit`, `offset`, dan `sort` diabaikan pada uji
  ini; response selalu seluruh komentar. Cap harus dilakukan di client.

### Media

- `substackcdn.com` → `access-control-allow-origin: *`; fetch dari content script aman.
- `substack-post-media.s3.amazonaws.com` → bucket media Substack; ikut di allowlist,
  tetapi fetch hanya berhasil bila CORS mengizinkan — kalau ditolak → `unresolved:
  fetch-failed`, jangan dialihkan ke host lain.
- `picture/srcset` menyediakan beberapa ukuran; pilih yang terbesar / `currentSrc`.
- Caption gambar ada di `figcaption.image-caption`.
- Embed YouTube/Vimeo/Twitter/Datawrapper tidak bisa diarsipkan sebagai bytes; simpan URL
  + poster bila ada, tandai `external`/`unresolved`.

## Kontrak Data (Usulan)

Jangan paksa masuk ke `ThreadSnapshot`. Buat `ArticleSnapshot`:

```js
{
  site: "substack",
  sourceUrl: "https://.../p/mountains",
  post: {
    id: 174486304,
    slug: "mountains",
    title: "Why Warm Countries Are Poorer",
    subtitle: "The most underrated factor",
    canonicalUrl: "https://.../p/mountains",
    publishedAt: "2025-09-25T09:23:33.901Z",
    author: { name, handle, photoUrl },
    publication: { name, subdomain, customDomain },
    audience: "everyone" | "only_paid" | "founding",
    access: "open" | "session",
    bodyTruncated: boolean | null,
    bodyRatio: number | null,
    bodyHtml: "...",
    bodyMarkdown: "...",
    tags: [],
    reactionCount: 28531,
    commentCountDeclared: 1061,
    audio: { url, type } | null,
    podcastUrl: null
  },
  comments: {
    included: true,
    declared: 1061,
    published: 1045,
    captured: 1045,
    topLevel: 727,
    maxDepth: 8,
    filtered: { total: 5, byStatus: { deleted: 1, blocked: 3, moderator_removed: 1 } },
    promoted: 6,
    automodHidden: 16,
    mismatch: 16,
    duplicates: 0,
    truncated: false,
    dropped: 0,
    state: "captured",
    reason: null,
    items: [CommentNode]
  } | null,
  media: [...],
  errors: []
}
```

> Angka di atas berasal dari payload live Tomas (2026-11-03): **1.050 node mentah**,
> 1.045 published, 6 anak dipromosikan dari 5 parent yang terfilter. Unit test memakai
> fixture beku; live drift dicatat sebagai `mismatch`, bukan kegagalan test.

`CommentNode`:

```js
{
  id: 159775794,
  parentId: null,
  depth: 0,
  author: { name, handle, photoUrl, isAuthor: false },
  date: "2025-09-25T14:02:41.724Z",
  body: "...",
  likes: 1977,
  restacks: 4,
  replyCount: 16,
  url: "https://.../p/mountains/comment/159775794",
  children: [CommentNode]
}
```

## Output ZIP

```
post.md                 # artikel + komentar, siap upload ChatGPT
post.html               # artikel + komentar, gambar lokal, offline
post.json               # metadata + body artikel
comments.json           # tree komentar lengkap
comments.csv            # preset data: satu baris per komentar (RFC 4180)
media/                  # gambar artikel
media-manifest.json     # URL asli → path lokal
errors.json             # komentar restricted, media gagal, embed unresolved
```

Contoh render komentar di `post.md`:

```md
## Comments (1.045 captured / 1.061 declared; 1.050 raw nodes)

- **Kuntay Dogan** · 2025-09-25 · ♥ 1.977
  > The way we frame a question already shapes the outcome...
  - **Tomas Pueyo (author)** · 2025-10-06 · ♥ 602
    > I was hoping to read this answer...
```

## Arsitektur

### Alur

1. User klik extension di tab post Substack → `activeTab` grant.
2. Popup menjalankan probe via `chrome.scripting.executeScript`:
   - baca `preloads-json`; kalau object `post` ada dan `canonical_url` cocok dengan
     `location.pathname` → target valid.
   - kalau `preloads` absen, marker DOM `article.newsletter-post` +
     `.available-content .body.markup` dipakai **hanya untuk deteksi**; isi artikel
     tetap wajib dari preloads-verified atau API.
3. Kalau target valid, inject daftar `SUBSTACK_INJECTION` (`src/sites/substack-detect.js`,
   `src/sites/substack-adapter.js`, `src/sites/substack-article.js` di Task 20+,
   `vendor/jszip.min.js`, `src/media.js`, `src/substack-content.js`) — semua idempotent;
   urutan otoritatif ada di `src/sites/substack-scripts.js`.
4. Popup kirim `SCRAPE_START { site: "substack", tabId, sourceUrl, postId, options: {
   includeComments, maxComments, preset, custom } }`; state job (jobId +
   documentToken) hidup di content script.
5. Content script:
   - ambil artikel dari `preloads` (canonical cocok) → fallback `GET /api/v1/posts/{slug}`
     (verifikasi slug); gagal keduanya → `POST_IDENTITY_MISMATCH`;
   - fetch komentar same-origin (raw ≤ 16 MB);
   - inventarisir gambar (URL awal wajib allowlist);
   - **jawab ack sinkron** `{ jobId, documentToken, state: "started" }`; hasil capture
     diamati popup lewat polling `SCRAPE_STATUS` (bukan respond kedua).
6. Save (klaim dulu, baru render): popup kirim `SAVE_RESULT` (binding +
   `sourceUrl`) → content **klaim atomik** (`idle/failed → saving` + `attemptId`) →
   background render `post.md`/`post.html`/`post.json`/`comments.json`/
   `comments.csv` sesuai preset matrix → `BUILD_ZIP` (validasi attempt) →
   `chrome.downloads.download` → `DOWNLOAD_STARTED` (filename dibekukan) → tunggu
   download **complete** → `MARK_SAVED`; gagal → `SAVE_FAILED` (retry) atau
   terminal (lock lepas). `GET_RESULT` hanya **diagnostik** (read-only, tidak pernah
   memulai save); recovery memakai `SCRAPE_STATUS` + `downloads.search` dengan
   filter kepemilikan.

### Perubahan terhadap kode sekarang

- `detectAdapter(url)` sekarang host-based. Substack butuh `detectByDocument`/probe
  async; jangan tambah `substack` ke daftar host karena custom domain tak terbatas.
- Popup: "Check connection" dan "Download" tidak bisa cuma cek host; harus probe dulu.
- Model/export baru (`ArticleSnapshot`), bukan `ThreadSnapshot`.
- Reuse `XMedia.fetchBytes` dan `buildZip` (generik) untuk gambar + ZIP.
- Error handling partial success: artikel tetap sukses walau komentar gagal.
- `includeComments` default `true`; `maxComments` default 2.000.
- Komentar **tidak di-sort di client**; urutan ikut API (`best_first`), dicatat sebagai
  `order: "api"` (endpoint mengabaikan `sort` pada uji ini).

## MVP Scope

**In:**

- 1 post Substack tipe newsletter/article, di `*.substack.com` atau custom domain.
- Artikel: judul, subtitle, author, tanggal, canonical URL, body, gambar, caption,
  footnote.
- Komentar: seluruh tree yang bisa diakses; filter deleted/suppressed; highlight author;
  cap + progress.
- Output (satu ZIP, per preset matrix di `tasks/plan.md`): `post.md`, `post.html`,
  `post.json`, `comments.json`, `comments.csv` (preset data), `media/`,
  `media-manifest.json`, `errors.json`.
- Akses seadanya (`access: open|session` + `bodyTruncated` — bukti potong saja; tanpa
  klaim kelengkapan) + `comments.state` jujur (`restricted` hanya bila
  `bodyTruncated === true`).
- Popup: deteksi Substack, opsi include comments, progress, error jujur.

**Out:**

- Batch archive semua post / RSS crawl.
- Komentar dengan media/attachment.
- Podcast/video post sebagai body utama (phase B).
- Generic readability untuk situs non-Substack.
- Bypass paywall.
- `host_permissions` luas / `<all_urls>`.
- Sinkronisasi komentar real-time.

## Not Doing (and Why)

- **Host-based `content_scripts.matches`** — custom domain tak terbatas; maintenance
  mimpi buruk.
- **`<all_urls>` / optional broad host permission** — melanggar aturan permission
  minimal; `activeTab` cukup untuk inject saat user klik.
- **DOM-only comments** — cuma 2 komentar yang dirender; tidak memenuhi kebutuhan.
- **Scrape halaman `/comments` lewat UI** — client-rendered dan rapuh; API same-origin
  lebih jujur dan lengkap.
- **Fetch langsung S3 pihak ketiga (bukan bucket media Substack)** — tidak ada ACAO;
  allowlist hanya memuat `substack-post-media.s3.amazonaws.com` (bucket Substack
  sendiri) dan tetap tunduk pada CORS tab.
- **Bypass paywall** — tidak mungkin dan tidak etis; arsipkan sesuai akses.

## Key Assumptions to Validate

- [x] `preloads-json` ada di post + home/archive publication yang dicek.
- [x] Comments API mengembalikan tree lengkap untuk post gratis (Tomas, Slow Boring,
      The Free Press).
- [ ] Comments API mengembalikan tree lengkap untuk post berbayar saat login sebagai
      subscriber — butuh uji manual dengan akun subscribed.
- [ ] `activeTab` + `chrome.scripting.executeScript` berhasil di custom domain tanpa
      host permission — uji di Chromium nyata.
- [ ] Fallback `canonical_url` mismatch (SPA navigation) bekerja.
- [ ] Cap 2.000 komentar cukup dan performa tetap wajar di thread besar.
- [ ] `post.md` dengan ~1.000 komentar masih nyaman di-upload ke ChatGPT.
- [ ] Sanitasi `body_html` tidak membuang footnote/gambar/table yang penting.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `preloads-json` / API internal berubah | High | Schema guard + fallback `/api/v1/posts/{slug}` + `errors.json`; DOM bukan sumber body; gagal eksplisit bila identitas tak pasti |
| Post berbayar: body cuma preview | Med | `bodyTruncated: true` (marker `.paywall`/ratio) → warning terpotong di popup + `errors.json`; `access: session`; tanpa klaim `full` |
| Komentar berbayar dibatasi | Med | `comments.state: "restricted"` hanya bila `bodyTruncated === true`; artikel tetap terarsip |
| Thread komentar raksasa (10k+) | Med | Cap `maxComments` (usulan 2.000) + warning; progress; jangan hang |
| API komentar tidak ada pagination | Med | Satu request + cap client; ukur waktu/memori |
| SPA navigation bikin `preloads` stale | Med | Validasi `canonical_url`; fallback `/api/v1/posts/{slug}` + verifikasi slug; DOM bukan sumber body |
| Komentar berisi PII | Low | Arsip personal; jangan publish; dokumentasikan di README |
| Embed pihak ketiga tidak bisa diarsipkan | Low | Simpan URL + poster; tandai `external`/`unresolved` |
| `activeTab` grant hilang saat navigasi | Low | Inject ulang saat klik; pesan "reload/click again" |
| Custom domain pakai Cloudflare ketat | Low | Same-origin API dari sesi tab; error jujur, tanpa fallback DOM yang bisa salah post |

## Calon Task (sudah diadopsi sebagai Phase 8 di `tasks/plan.md`)

> Bagian ini dipertahankan sebagai catatan asal-usul. Versi normatif (identitas,
> preset, budget, state komentar) ada di `tasks/plan.md` Phase 8. Cabang usulan:
> `experiment/substack` dari `main`, mengikuti aturan fix-di-main-dulu.

### Task S1: Deteksi + inject on-demand + kontrak `ArticleSnapshot`

- Probe `preloads-json`; marker DOM hanya deteksi; fallback `/api/v1/posts/{slug}`.
- Inject `substack-content.js` via `activeTab` + `scripting.executeScript`.
- `ArticleSnapshot` + flag akses (`access`/`bodyTruncated`, tanpa klaim kelengkapan).
- Acceptance: di 3 publication (substack.com + 2 custom domain), probe true; halaman
  non-post false; tidak ada permission baru.

### Task S2: Exporter artikel + media + ZIP

- `post.md`, `post.html`, `post.json`; sanitasi body; gambar CDN → `media/`; ZIP.
- Acceptance: buka HTML offline, gambar tampil; MD lolos 3 probe ChatGPT; **URL
  awal** fetch media hanya publication + `substackcdn.com` (+ host allowlist phase);
  redirect otomatis ke host luar = residual risk terdokumentasi (lihat
  `tasks/plan.md` Phase 8), bukan klaim nol.

### Task S3: Komentar

- Fetch `/api/v1/post/{id}/comments?all_comments=true`; normalisasi tree; filter
  deleted/suppressed/moderated; author highlight; cap + progress.
- Render ke `post.md`/`post.html`/`comments.json`; `comments.csv` di preset data.
- Acceptance: thread Tomas **1.050 node mentah → 1.045 published** ter-capture (6 anak
  dipromosikan, 5 parent terfilter); reply tree benar; post berbayar anonymous
  menghasilkan `comments.state: "restricted"` (bukan 0 diam-diam).

### Task S4: Popup + tests + uji manual

- Routing Substack, opsi include comments, progress, error state.
- Fixture `preloads-json` + comments API (trimmed, anonymized).
- Manual: free post banyak komentar, free post sedikit, paywalled post; upload MD ke
  ChatGPT.
- Acceptance: 1 ZIP per post; artikel + komentar konsisten; X/YouTube tidak regresi.

## Open Questions (sudah diresolusi di `tasks/plan.md` Phase 8)

- ~~same-origin comments API vs DOM-only~~ → **API** (DOM hanya 2 komentar).
- ~~`comments.csv` di MVP?~~ → **ya, di preset data** (`comments.json` selalu ikut).
- ~~Cap komentar~~ → **2.000 node published** (validasi 1..10.000, default 2.000).
- ~~Sort komentar~~ → **ikut API (`best_first`)**, `order: "api"`, tanpa sort client.
- ~~`automod_hidden_comments`~~ → **dihitung saja** di stats + `errors.json`, body
  tidak disimpan.
- ~~Avatar komentator~~ → **tidak di-download**; HTML pakai inisial.
- ~~Post podcast/video~~ → **phase B**; MVP artikel newsletter saja.

## Referensi

- Target contoh: `https://unchartedterritories.tomaspueyo.com/p/mountains`
- Custom domain lain yang dicek: `https://www.thefp.com`, `https://www.noahpinion.blog`,
  `https://www.slowboring.com`, `https://astralcodexten.com`
- Endpoint komentar:
  `GET https://<publication>/api/v1/post/<post_id>/comments?all_comments=true`
- Endpoint post by slug: `GET https://<publication>/api/v1/posts/<slug>`
- Pola arsip halaman: `docs/ideas/oreilly-accumulate.md`
- Pola adapter + network: `docs/ideas/youtube-transcript.md`
- Aturan permission minimal: `AGENTS.md`
