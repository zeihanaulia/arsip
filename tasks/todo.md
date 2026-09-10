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
- [ ] Task 16: Wiring tab — registry + manifest + content route + background path
- [ ] Task 17: Popup + tests + uji manual video asli

## Checkpoint: Complete (Phase 6)

- [ ] MD video asli lolos probe ChatGPT (rujukan menit benar)
- [ ] Jalur X + O'Reilly tidak regresi
- [ ] Review human; branch tetap pisah sampai diputuskan merge

## Backlog (post-V1)

(none)
