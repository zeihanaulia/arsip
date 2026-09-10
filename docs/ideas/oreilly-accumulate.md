# O'Reilly Accumulate (Arsip V2)

## Problem Statement
How Might We mengarsipkan chapter O'Reilly yang dibaca (HTML + gambar konten offline + MD siap upload ChatGPT) dengan user yang memilih manual chapter mana yang masuk satu ZIP?

## Recommended Direction
**Akumulasi manual** (variasi 2): tiap chapter dibuka → klik Download → extension menempelkan hasilnya ke satu arsip berjalan (per-chapter HTML + gambar konten lokal + MD per chapter + satu `book.md` gabungan untuk LLM). Tanpa auto-crawl, tanpa TOC scraping wajib.

Kenapa ini menang: cocok dengan perilaku baca nyata (tidak berurutan, tidak sekaligus), tidak ada navigasi rapuh antar-buku, dan painkiller-nya jelas (5 chapter minggu ini → 1 ZIP + 1 file upload). TOC picker (variasi 3) jadi upgrade opsional kalau selector daftar isi ternyata 1–2 pola saja. Save-current-page (1) terlalu dekat dengan Ctrl+S browser. Auto-crawl (4) rapuh (navigasi beda per buku, paywall/rate-limit di tengah = ZIP setengah jadi).

## Key Assumptions to Validate
- [ ] Chapter O'Reilly punya struktur DOM stabil (judul + body + gambar konten) — validasi via 1 file HTML tersimpan sebagai fixture
- [ ] Gambar konten bisa dibedakan dari dekorasi/avatar via atribut/pola URL — validasi di fixture yang sama
- [ ] Akumulasi lintas halaman bisa disimpan di `chrome.storage`/memory worker tanpa hilang (worker tidur!) — validasi via test + percobaan 3 chapter
- [ ] MD per chapter + gabungan cukup buat diskusi ChatGPT (bukan full-book) — validasi 3 probe seperti Task 5

## MVP Scope
- Adapter O'Reilly: judul, body berurutan, gambar konten saja (skip avatar/ikon)
- Tombol Download menempel ke arsip berjalan; panel kecil tunjukkan isi arsip (n chapter) + tombol reset + tombol unduh ZIP final
- ZIP: `ch01.html`, `ch01.md`, `book.md`, `media/`, `media-manifest.json`
- In: preset LLM-style (HTML+MD). Out: CSV/XLSX, video mode, network hook, TOC picker, auto-crawl

## Not Doing (and Why)
- Auto-crawl Next — rapuh lintas buku; manual sesuai cara baca nyata
- TOC picker (sekarang) — opsional kalau selector murah; bukan MVP
- CSV/XLSX/thread-model — scope V2 = arsip halaman (keputusan terkunci)
- Gambar non-konten — noise buat LLM, bengkak ZIP
- Backend/antrean server — langgar prinsip tanpa-server

## Open Questions
- Apakah struktur DOM chapter konsisten antar buku O'Reilly, atau per-buku beda template? (1 fixture menjawab sebagian; butuh 2–3 buku)
- Di mana state arsip berjalan disimpan agar selamat dari worker tidur — `chrome.storage.local` (5MB, quota?) atau rakit ulang dari tab?
- `book.md` gabungan: TOC + full concat, atau ringkasan per chapter + link file?
