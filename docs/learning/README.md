# Learning Notes

| No. | Topic | Central question | Summary |
|---:|---|---|---|
| 001 | [Kenapa Extension Chrome Bukan Webapp Biasa](./001-chrome-extension-bukan-webapp-biasa.md) | Kalau bahannya sama (HTML/CSS/JS), kenapa approach-nya beda dari webapp? | Menelusuri tiga bug lokasi dari project x-downloader sampai ke model banyak-konteks-terisolasi + bus pesan, isolated world, dan kenapa MV3 mempersempit kapan/di mana/dari mana code boleh jalan. |
| 002 | [Kenapa Test Hijau Tapi Browser Merah](./002-kenapa-test-hijau-browser-merah.md) | Kenapa 31/31 test hijau tapi browser beneran gagal dua kali? | Retrospektif Task 2: hang channel pesan dan createObjectURL di service worker, sampai ke persamaan kebenaran extension (logic × konteks × channel) dan strategi test per sumbunya. |
| 003 | [Kenapa Scroll Sampai Habis Tidak Pernah Selesai](./003-kenapa-scroll-sampai-habis-tidak-pernah-selesai.md) | Kenapa E2E hijau tapi thread nyata cuma ke-capture 16 dari 292? | Retrospektif Task 3: thread sebagai sistem malas (sentinel + chunk async), telepon jadi papan pengumuman (polling vs worker lifecycle), dan kontrak kejujuran relasi (inferred). |
| 004 | [Kenapa Download Video Bukan Satu Masalah](./004-kenapa-download-video-bukan-satu-masalah.md) | Kenapa satu pipeline ngasilin tiga nasib (masuk/gagal/nihil)? | Retrospektif Task 4/4b: routing kapabilitas tiga konteks, fisika blob/HLS/poster/caption, dan unresolved sebagai output kelas satu berbasis bukti thread nyata. |
| 005 | [Kenapa yang Kesimpen Cuma Sisa Terakhir](./005-kenapa-yang-kesimpen-cuma-sisa-terakhir.md) | Kenapa 23 batch cuma ngasilin 28 tweet? | Retrospektif arc completeness: DOM sebagai jendela geser (bukan tumpukan), union DOM+API, tiga bug laporan, dan capture sebagai flight recorder. |
