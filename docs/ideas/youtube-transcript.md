# YouTube Transcript → Arsip

## Problem Statement
How Might We memberi user Arsip transcript video YouTube yang lagi dibuka —
siap upload ke ChatGPT beserta link-nya — tanpa backend dan tanpa fetch ke API YouTube?

## Recommended Direction
Adapter YouTube ketiga mengikuti pola O'Reilly: scrape dari tab aktif, arsip satu halaman,
export minimal buat LLM. Jalur utama: **B — parse `timedtext` json3 + `captionTracks` dari
buffer tangkapan network** (terbukti ketangkap di log asli: 1196 events + timestamp, pola
persis X Task 7). Tanpa fetch tambahan, tanpa klik UI. Bungkus jadi `video.md` + `video.json`
dalam `<videoid>.zip`. Tanpa `media.js` (nggak ada gambar), tanpa scroller, tanpa xlsx.
Timestamp per segmen dipertahankan karena prompt ChatGPT merujuk menit pembahasan.

> Keputusan 2026-09-11: pindah A→B setelah bedah network log asli. Jalur A (panel DOM)
> turun jadi fallback tak-dibangun.

## Key Assumptions to Validate
- [ ] Panel transcript bisa dibuka programmatic (klik ...more → Show transcript) dan
      segmennya kebaca dari isolated world — cek manual di 2-3 video dulu.
- [ ] Video tanpa caption apa pun memberi sinyal DOM yang beda jelas (bukan panel kosong
      yang ambigu) — kalau ambigu, butuh guard honest-empty.
- [ ] Match `youtube.com` di manifest + `activeTab` cukup (tanpa host permission baru).

## MVP Scope
- In: 1 video aktif → MD (timestamp + teks + judul + link + durasi) + JSON, ZIP, tombol
  "Download transcript", ping caps per-site (`["hook","zip"]`), error jujur EMPTY_TRANSCRIPT.
- Out: playlist, pilih bahasa, download video, HTML/CSV/XLSX, preset custom.

## Not Doing (and Why)
- Vendoring youtube-caption-extractor — arsitektur server-side, rawan bot-check dari browser.
- Fetch timedtext/InnerTube API — risiko CORS/bot-check; DOM panel nol risiko jaringan.
- Multi-video/akumulasi playlist — use case satu video; pola akumulasi O'Reilly belum terbukti.
- Timestamp presisi detik/word-level — panel kasih per segmen, cukup buat rujukan menit.

## Open Questions
- Struktur DOM exact panel transcript di layout YouTube saat ini (validasi lapangan)?
- Track yang panel tampilkan kalau video punya multi-bahasa — deterministik atau ikut bahasa UI?
