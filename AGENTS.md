# AGENTS.md — x-downloader

## Apa ini

Extension Chrome MV3, DOM-only: scrape thread X dari tab aktif → download media lokal → export ZIP (HTML/MD/JSON/CSV/XLSX). Tanpa API key, tanpa backend, tanpa request ke server manapun selain CDN X.

Sumber kebenaran: `docs/intent/x-thread-downloader.md` (intent locked), `tasks/plan.md` (8 task + checkpoints), `tasks/todo.md` (checklist).

## Batasan keras (jangan dilanggar)

- Fetch media HANYA dari content script (konteks tab, ikut sesi login). Jangan dari popup/background — kena CORS/CSP.
- Background service worker tipis: orkestrasi + `chrome.downloads` saja.
- Selector DOM X HANYA di `src/x-adapter.js` dengan fallback multi-selector. File lain dilarang query DOM X langsung.
- Parser respons API X HANYA di `src/x-graphql.js`. Field yang tidak ada di payload diisi kosong — dilarang mengarang dari pola URL.
- Hook MAIN world (`src/hook-main.js`) HANYA membaca respons network + forward via event ke isolated world. Dilarang mengubah request, `eval`, atau akses `chrome.*` dari MAIN world.
- Semua exporter consume satu `ThreadSnapshot` (`src/model.js`). Ubah selector ≠ ubah exporter.
- Field yang tidak ada di DOM diisi kosong + catat di `docs/export-columns.md`. Dilarang mengarang angka (counts, user fields).
- Permission minimal: `activeTab`, `scripting`, `downloads`. Dilarang `host_permissions` luas, `eval`, remote-code, analytics.

## Perintah

- Contract utama: `npm run quality` (= `biome check .` + `tsc --noEmit`). Fix format/lint aman: `npm run quality:fix`. CI: `npm run quality:ci` + `npm test`. Full lokal: `npm run verify`.
- Loop kerja: saat edit, `npx biome check <file-terdampak>` + test relevan (cepat, targeted). Sebelum selesai: `npm run quality` penuh. Jangan pakai `biome check --changed` sebagai satu-satunya validasi (staged/unstaged lokal tidak termasuk).
- Verifikasi produk: Load unpacked di `chrome://extensions`; JSON valid (`python3 -m json.tool thread.json > /dev/null`); diff header xlsx vs contoh harus kosong (Task 6); `thread.html` offline load media dari `media/` lokal; `thread.md` lolos 3 probe ChatGPT.

## Alur kerja

- Ikuti `tasks/todo.md` berurutan (1→8); setiap task vertical slice, sistem tetap working.
- Jangan lewati checkpoint: Foundation (Task 2), Capture (Task 4, upload coba ke ChatGPT dulu), Exporters (Task 6), Complete (Task 8).
- Vendor lokal saja: `vendor/jszip.min.js`, `vendor/xlsx.full.min.js`. Toolchain npm yang disetujui: biome + tsc + types saja. Jangan tambah bundler/dependency runtime tanpa persetujuan (diputus di Task 8).
- Network check saat scrape: egress hanya ke `x.com` / `pbs.twimg.com` / `video.twimg.com`. Selain itu = bug.

## Quality gate (JS/TS)

- Setiap ubah JS/TS: jaga behavior eksisting, jalanin test relevan, lalu `npm run quality`. Dilarang nambah error Biome/format/TS/Cognitive Complexity baru.
- Kalau `lint/complexity/noExcessiveCognitiveComplexity` gagal (threshold 15): pahami kenapa fungsinya susah diikuti, pakai skill `improve-code-understandability` sebelum refactor struktural, jaga behavior, lalu ulangi quality + test. Jangan nurunin skor dengan mecah control flow ke helper asal (`step1→step2→step3`).
- Dilarang bypass quality demi hijau: jangan disable rules, jangan naikkan threshold, jangan tambah `biome-ignore`/suppression/exclude untuk pelanggaran baru, jangan pakai `--skip`, jangan ubah script quality supaya check tidak jalan. Pengecualian sah cuma kalau task-nya eksplisit mengubah policy tooling.
- Sebelum lapor task selesai: inspect diff final, test relevan hijau, `npm run quality` hijau, dan tidak ada mekanisme quality yang dilemahkan.
