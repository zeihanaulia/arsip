# Todo: X Thread Downloader

Sumber: `docs/intent/x-thread-downloader.md` | Plan: `tasks/plan.md`

## Phase 0: Foundation + first working slice

- [x] Task 1: Scaffold MV3 + kontrak data ThreadSnapshot
- [x] Task 2: Scraper minimal + download JSON (viewport-only)

## Checkpoint: Foundation

- [ ] Extension load unpacked bersih
- [ ] Slice scrape→JSON jalan di 2 thread nyata
- [ ] Review human sebelum lanjut

## Phase 1: Capture lengkap + media lokal

- [x] Task 3: Auto-expand + autoscroll opsional + ordering + reply-tree
- [x] Task 3b: Tuning completeness + observabilitas + styling dasar popup
- [x] Task 4: Media inventory + download lokal + bundle ZIP
- [x] Task 4b: Opsi video terpisah + ekstraksi caption

## Checkpoint: Capture

- [ ] ZIP parsial (JSON + media) end-to-end jalan
- [ ] Upload hasil ke ChatGPT kebaca (cek stopper)
- [ ] Review human sebelum lanjut

## Phase 2: Exporters

- [x] Task 5: Exporter HTML rapi + teks LLM-ready (offline-first)
- [x] Task 6: Exporter JSON final + CSV + Excel (kolom ala XCommentsExporter)

## Checkpoint: Exporters

- [ ] 5 artefak konsisten (json/csv/xlsx/html/md), count sama
- [ ] ChatGPT lolos 3 probe; spreadsheet tidak corrupt
- [ ] Review human sebelum polish UI

## Phase 3: Mekanisme utama

- [ ] Task 7: Network response capture via MAIN-world hook
- [ ] Blocker eksternal: 1 file respons GraphQL asli via DevTools

## Phase 4: UX + QA packaging

- [x] Task 8: Popup UI final (preset + opsi + progress + error)
- [ ] Task 9: Hardening + packaging + uji ChatGPT E2E

## Checkpoint: Complete

- [ ] Semua acceptance Task 1-9 terpenuhi
- [ ] ZIP final siap upload ke ChatGPT tanpa missing mayor
- [ ] Siap review; belum publish ke Web Store (out of scope v1)
