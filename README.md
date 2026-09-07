# Arsip

Extension Chrome (MV3) untuk menyimpan halaman web yang lagi dibuka jadi arsip offline — teks + media ter-download lokal — sekali klik, siap dibaca ulang atau di-upload ke LLM buat diskusi. Lahir sebagai pengganti flow ChatGPT Atlas yang sudah dimatikan. V1 fokus thread X; situs lain nyusul (lihat Roadmap).

## Status

Aktif dikembangkan. Scope V1: `tasks/plan.md`, checklist: `tasks/todo.md`.

## Cara pakai

1. Buka thread X di Chrome.
2. Klik ikon extension → popup:
   - **Check connection** — pastikan content script nyambung ke tab.
   - **Auto-expand replies** (checkbox) — scroll + klik "show more" sampai habis, atau mati untuk viewport-only.
   - **Video files** — `Bundle into ZIP` / `Download separately` (default) / `Posters only`.
   - **Download JSON** → hasil ke-download sebagai 1 file ZIP.
   - **Cancel** — hentikan mid-scroll; file parsial tetap ke-download.
3. Upload isi ZIP ke ChatGPT (atau buka `thread.html` offline), langsung diskusi tanpa copas satu-satu.

## Isi ZIP

| File | Guna |
|------|------|
| `thread.html` | Dibaca manusia, offline penuh (gambar lokal, tanpa script/remote) |
| `thread.md` | Konteks LLM — upload ini ke ChatGPT |
| `thread.json` | Data terstruktur penuh (kontrak `ThreadSnapshot`) |
| `thread.csv` / `thread.xlsx` | Flat, 43 kolom meniru `XCommentsExporter` |
| `media-manifest.json` | URL asli → path lokal + tipe, atau alasan `unresolved` |
| `media/` | Foto, poster video, mp4 (mode bundle), subtitle `.vtt` |

Video yang tidak bisa diambil bytes-nya (stream/blob player) dicatat jujur di manifest (`fetch-failed`, `hls-playlist`, …) — tidak pernah silent-drop. Kalau halaman dibuka dari permalink reply dan tweet root tidak ke-load, status popup memberi peringatan.

## Prinsip

- Murni baca DOM tab aktif — tanpa API key, backend, atau login tambahan.
- Media di-bundle lokal, bukan cuma URL.
- Permission minimal: `activeTab`, `scripting`, `downloads`.
- Field yang tidak ada di DOM diisi kosong dan didokumentasikan (`docs/export-columns.md`) — angka tidak dikarang.

## Batasan dikenal

- DOM X sering berubah — selector diisolasi di `src/x-adapter.js` dengan fallback.
- Video HLS/blob player X tidak bisa di-fetch jadi file — poster + URL + alasan dicatat (rencana jangka panjang: backlog B1 intersepsi network).
- Caption video hanya kalau DOM menyediakannya (`<track>`); umumnya tidak ada di X.
- Thread raksasa dibatasi (40 batch / 300 tweet / ~21MB per file media).

## Develop

Prasyarat: Node 24+.

```bash
npm install
npm run verify   # quality (Biome + tsc) + tests
```

| Perintah | Guna |
|----------|------|
| `npm run quality` | `biome check .` + `tsc --noEmit` (gate utama) |
| `npm run quality:fix` | Autofix format/lint yang aman |
| `npm test` | Node test runner + Playwright (Chromium) |
| `npm run verify` | quality + tests |

Loop kerja: `npx biome check <file>` + test relevan saat edit, `npm run quality` penuh sebelum selesai. Aturan lengkap: `AGENTS.md`.

Struktur:

```
manifest.json            # MV3, permission minimal
src/x-adapter.js         # SATU-SATUNYA file yang boleh query DOM X
src/scroller.js          # auto-expand + lazy-mount pass
src/media.js             # fetch + zip helpers (konteks tab)
src/model.js             # kontrak ThreadSnapshot (dipakai semua exporter)
src/snapshot.js          # assembly, relasi, manifest, nama file
src/export-html.js       # thread.html + thread.md
src/export-tabular.js    # thread.csv + data thread.xlsx (43 kolom)
src/content.js           # orkestrasi di tab (classic script)
src/background.js        # orkestrasi + chrome.downloads
src/popup.html/js/css    # UI picker
vendor/                  # jszip + SheetJS, lokal (tanpa CDN)
tests/                   # unit + Playwright E2E + fixtures
docs/intent/             # intent yang sudah dikunci
docs/learning/           # catatan pembelajaran (001–004)
docs/export-columns.md   # mapping 43 kolom → sumber/empty
tasks/                   # plan + todo
```

## Roadmap

- V1: X selesai (Task 1–8) → preset popup `Buat LLM` / `Data` / Custom → publish Web Store (out of scope V1).
- Post-V1: adapter situs generik (`src/sites/*`), backlog **B1** intersepsi network buat bytes video + subtitle.
