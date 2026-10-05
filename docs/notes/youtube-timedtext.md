# YouTube timedtext shape notes (jalur B)

Sumber: `network-log-2026-09-10 (1).json` (32 entri, sesi watch Endgame #277).
Fixture latih: `tests/fixtures/timedtext-sample.json` (verbatim excerpts, 4.4KB).
File log 770KB milik user TIDAK masuk repo.

Log kedua (belum masuk repo, 79 entri, 562KB): `network-log-2026-10-05.json` —
sesi watch `MN9dGgmLyso` (live stream ~2 jam, ASR). Dipakai buat memastikan
dua bug di bawah: body caption ke-drop cap 500KB, dan heartbeat ngalahin
player response asli.

## `/api/timedtext?v=...&caps=asr&...&signature=...`

- Response JSON (`wireMagic: "pb3"`), bukan XML. URL ada `expire` + `signature` →
  basi dalam hitungan jam. Konsumsi body tangkapan langsung, jangan simpan URL.
- `events[]`: `{tStartMs, id, wpWinPosId?, wsWinStyleId?, segs?}`.
  - Event tanpa `segs` = kosong (ada 1 dari 1196) → skip.
  - `segs[]`: `{utf8, acAsrConf?}`. Multi-seg (13 dari 1196) → gabung `utf8` berurutan.
  - Teks apa adanya (termasuk `\n` di dalam utf8) → gabung lalu trim, jangan normalisasi isi.
- Timestamp: `tStartMs` → `mm:ss` verbatim (`floor(ms/60000):floor(ms%60000/1000)`),
  `seconds = floor(ms/1000)` derivasi jujur.

## Body besar: `pot=` menandai paginasi

Request timedtext untuk video panjang membawa continuation token protobuf di
parameter `pot`. Video live 2 jam (`MN9dGgmLyso`, live 2026-10-05) mengirim
**satu** body raksasa — willingly lewat cap 500KB generic `hook-main.js`.
Endpoint caption punya budget sendiri (`MAX_CAPTION_BODY_LENGTH`); endpoint
lain tetap dijaga 500KB biar buffer nggak tumbuh tanpa batas.

## `/youtubei/v1/player/heartbeat` bukan player response

Heartbeat berbagi prefix dengan `/youtubei/v1/player` tapi **nggak punya
`videoDetails` sama sekali** (`{responseContext, playabilityStatus,
pollDelayMs, ...}`, ~3.6KB) dan diulang tiap beberapa detik saat play. Kalau
ikut ter-capture, cap "3 body terbaru" secara posisional jadi ngalahin
respons asli, sehingga `title`/`author`/`duration` kosong. Karena itu filter
per-URL (`isPlayerEndpoint`) + pemilihan body yang `videoId`-nya cocok dengan
halaman — bukan sekadar "body pertama yang punya videoId", karena buffer bisa
masih menyimpan respons halaman sebelumnya.

## `captionTracks` (di `/youtubei/v1/player` → `captions.playerCaptionsTracklistRenderer`)

- Tiap track: `{baseUrl, name: {simpleText}, vssId, languageCode, kind?}`.
  - Manual: `vssId: ".en-US"`, tanpa `kind`.
  - Auto: `vssId: "a.it"`, `kind: "asr"`.
- `baseUrl` juga ber-expiry (sama seperti timedtext) → hanya dipakai live, tidak disimpan.
- Tidak ada `captionTracks` / tidak ada `captions` **di respons video ini** =
  sinyal jujur "video ini tidak punya caption" → `EMPTY_TRANSCRIPT`.
- Track **ada** tapi `segments` kosong → `CAPTURE_MISSED` (bukan "tidak punya
  caption"). Jangan gabung dua kondisi ini — itu persis bug yang bikin video
  ber-caption dilaporkan "no captions at all" padahal body-nya ke-drop atau
  heartbeat ngalahin respons asli.
- Nggak ada respons player untuk video ini sama sekali → `CAPTURE_UNKNOWN`
  (reload tab, putar sebentar). Heartbeat **nggak** boleh dihitung sebagai
  "tidak punya caption".

## `videoDetails` (di player response yang sama)

- Dipakai: `videoId`, `title`, `lengthSeconds` (string!), `author`.
- `lengthSeconds` string → parse int defensif, gagal = kosong.

## Bahasa (observasi, bukan aturan)

- Video Indonesia dapat track `wd` + `caps=asr` berisi teks Indonesia. Label track
  tidak bisa dipercaya 1:1 dengan isi — catat `lang` dari track apa adanya.
