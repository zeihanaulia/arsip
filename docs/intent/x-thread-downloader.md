# Intent: X Thread Downloader (Chrome Extension)

Status: confirmed (2026-09-07)

## Ringkasan

- Outcome: Extension Chrome one-click download thread X yang lagi dibuka — tweet + semua comments/replies + media ke-download lokal — dengan pilihan format HTML / Excel / CSV / JSON dan opsi autoscroll on/off
- User: Zeihan sendiri, pas lagi baca thread X dan mau lanjut diskusi di ChatGPT
- Why now: Pengganti ChatGPT Atlas yang udah dimatikan OpenAI, biar nggak copas satu-satu
- Success: Dari satu thread dapet 1 file/bundle, upload ke ChatGPT, ChatGPT langsung punya konteks lengkap dan bisa diajak diskusi tanpa missing
- Constraint: Murni baca DOM dari tab aktif, tanpa API key / backend / login tambahan
- Out of scope: Bukan scraper massal multi-thread, bukan support semua website dulu (X dulu, generic nyusul), bukan integrasi X API berbayar

## Detail yang sudah disepakati

- Sumber: tab aktif yang lagi dibuka user (DOM scraping via content script), bukan API.
- Cakupan "lengkap": tweet utama + semua comments/replies di dalam thread itu (termasuk nested yang ke-load).
- Media: di-download lokal dan di-bundle bareng output (bukan cuma URL), biar bisa dibuka offline dan di-upload bareng ke ChatGPT.
- Format output (opsi di popup extension):
  - HTML rapi (thread terbaca: user, tanggal, teks, reply-tree, media lokal) — preset "buat LLM / baca"
  - Excel (.xlsx) — kolom mirip contoh `XCommentsExporter` (Tweet Id, Full Text, Tweet Url, Media URLs, counts, user info, dst.)
  - CSV — sama kayak Excel tapi flat
  - JSON — mentah terstruktur buat data / analisis
- Opsi autoscroll / auto-expand "Show more replies": on/off, bukan always-on.
- Visi jangka panjang: extension generic downloader (page -> plain HTML + media), tapi v1 fokus X dulu.

## Referensi

- Contoh target kolom Excel: `/Users/zeihanaulia/Downloads/XCommentsExporter_asidorenko__12_2026-09-07_15-47.xlsx`
