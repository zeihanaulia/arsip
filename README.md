# X Thread Downloader

Extension Chrome (MV3) untuk download thread X yang lagi dibuka — tweet + semua comments/replies + media ter-download lokal — sekali klik, lalu upload hasilnya ke ChatGPT buat diskusi. Pengganti flow ChatGPT Atlas yang sudah dimatikan.

## Status

V1 dalam perencanaan. Lihat `tasks/plan.md` (8 task) dan `tasks/todo.md`.

## Cara pakai (target V1)

1. Buka thread X di Chrome.
2. Klik ikon extension → pilih preset:
   - **Buat LLM** → `thread.html` + `thread.md` + folder `media/` (ZIP)
   - **Data** → `thread.json` / `.csv` / `.xlsx` + `media/` (ZIP)
3. Atur opsi autoscroll (on/off), klik Download.
4. Upload file hasil ke ChatGPT, langsung diskusi tanpa copas satu-satu.

## Format output

| Format | Guna |
|--------|------|
| HTML + MD | Dibaca manusia + konteks LLM (offline, media lokal) |
| JSON | Data terstruktur penuh + `media-manifest.json` |
| CSV / XLSX | Flat, kolom meniru `XCommentsExporter` (43 kolom) |

## Prinsip

- Murni baca DOM tab aktif, tanpa API key / backend / login tambahan.
- Media di-bundle lokal (ZIP), bukan cuma URL.
- Permission minimal: `activeTab`, `scripting`, `downloads`.

## Develop

Load unpacked di `chrome://extensions` (belum ada build step).

```
docs/intent/x-thread-downloader.md  # intent (locked)
tasks/plan.md                       # rencana implementasi
tasks/todo.md                       # checklist
```

## Batasan dikenal

- DOM X sering berubah — selector diisolasi di `src/x-adapter.js`.
- Video HLS (m3u8) tidak bisa di-fetch sebagai 1 blob → poster + URL asli dicatat di manifest.
- V1 fokus X saja; support situs generic nyusul. Belum publish ke Chrome Web Store.
