# YouTube timedtext shape notes (jalur B)

Sumber: `network-log-2026-09-10 (1).json` (32 entri, sesi watch Endgame #277).
Fixture latih: `tests/fixtures/timedtext-sample.json` (verbatim excerpts, 4.4KB).
File log 770KB milik user TIDAK masuk repo.

## `/api/timedtext?v=...&caps=asr&...&signature=...`

- Response JSON (`wireMagic: "pb3"`), bukan XML. URL ada `expire` + `signature` →
  basi dalam hitungan jam. Konsumsi body tangkapan langsung, jangan simpan URL.
- `events[]`: `{tStartMs, id, wpWinPosId?, wsWinStyleId?, segs?}`.
  - Event tanpa `segs` = kosong (ada 1 dari 1196) → skip.
  - `segs[]`: `{utf8, acAsrConf?}`. Multi-seg (13 dari 1196) → gabung `utf8` berurutan.
  - Teks apa adanya (termasuk `\n` di dalam utf8) → gabung lalu trim, jangan normalisasi isi.
- Timestamp: `tStartMs` → `mm:ss` verbatim (`floor(ms/60000):floor(ms%60000/1000)`),
  `seconds = floor(ms/1000)` derivasi jujur.

## `captionTracks` (di `/youtubei/v1/player` → `captions.playerCaptionsTracklistRenderer`)

- Tiap track: `{baseUrl, name: {simpleText}, vssId, languageCode, kind?}`.
  - Manual: `vssId: ".en-US"`, tanpa `kind`.
  - Auto: `vssId: "a.it"`, `kind: "asr"`.
- `baseUrl` juga ber-expiry (sama seperti timedtext) → hanya dipakai live, tidak disimpan.
- Tidak ada `captionTracks` / tidak ada `captions` = sinyal jujur "video ini tidak
  punya caption" → `EMPTY_TRANSCRIPT` (bukan ZIP kosong, bukan throw).

## `videoDetails` (di player response yang sama)

- Dipakai: `videoId`, `title`, `lengthSeconds` (string!), `author`.
- `lengthSeconds` string → parse int defensif, gagal = kosong.

## Bahasa (observasi, bukan aturan)

- Video Indonesia dapat track `wd` + `caps=asr` berisi teks Indonesia. Label track
  tidak bisa dipercaya 1:1 dengan isi — catat `lang` dari track apa adanya.
