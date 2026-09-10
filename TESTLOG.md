# TESTLOG — uji thread nyata Task 9

## 1. Thread kecil (viewport, tanpa autoscroll)

- URL: `https://x.com/GergelyOrosz/status/2096565330701144077`
- Hasil: 13 tweet, JSON valid (`python3 -m json.tool` lolos)
- Catatan: baseline Task 2, tanpa error console

## 2. Thread panjang (autoscroll ON)

- URL: `https://x.com/theo/status/2096854674938941448`
- Hasil: **396 tweet**, 0 duplikat, root ikut, 32 media (4 mp4 beneran)
- Capture: `batches 23→idle legitim`, `scrollTarget` 5 container,
  `apiAdded 152`, counts API nempel (root 530 replies / 3584 likes)
- Sisa gap 396-vs-530: subset Relevant + "Show probable spam" + hapusan
  (plafon X, histori datar di ujung = berhenti bener)

## 3. Thread media/video

- URL: sama dengan (2) + tweet video Theo (28 menit, CC)
- Hasil: poster `amplify_video_thumb` ke-download, blob player
  `fetch-failed` tercatat jujur di manifest (plafon DOM-only → backlog B1),
  mp4 kecil (66–295KB) ketarik, caption nihil (`no-captions-in-dom`
  sesuai fakta DOM)
- Mode separate: mp4 per-file di folder `-media/`, ZIP isi sisanya

## 4. Halaman bukan-thread

- URL: `https://learning.oreilly.com/...` (dan `https://x.com/home`)
- Hasil: popup menolak eksplisit ("Arsip V1 hanya mendukung thread X"),
  tanpa pesan channel menyesatkan; 0 tweet → error EMPTY_THREAD eksplisit

## Egress audit (code review, 2026-09-10)

- `fetch()` hanya dipanggil dengan URL media dari DOM/API X
  (`pbs.twimg.com`, `video.twimg.com`) — tidak ada host hardcode lain
- `chrome.downloads` hanya untuk URL di atas + data/blob URL lokal
- Hook MAIN world hanya membaca respons (tidak mengubah request,
  tanpa `eval`, tanpa `chrome.*`)
- Permission: `activeTab`, `scripting`, `downloads` saja —
  tanpa `host_permissions`, tanpa remote-code, tanpa analytics
