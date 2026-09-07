# Export Columns: ThreadSnapshot → 43 kolom tabular

Sumber kolom: `XCommentsExporter_asidorenko__12_2026-09-07_15-47.xlsx`
(header 1:1, disimpan di `tests/fixtures/xcomments-headers.json`).
Aturan: field tanpa sumber DOM diisi kosong. Angka tidak pernah dikarang.

| Kolom | Sumber | Catatan |
|---|---|---|
| Tweet Id | `tweet.id` (dari `/status/<id>` di DOM) | — |
| Full Text | `tweet.text` | — |
| Tweet Url | `tweet.url` | — |
| Media URLs | `localPath` bila ter-download, else URL asli; multi dipisah spasi | — |
| Media Types | `photo` / `video` / `captions`, dipisah spasi | `captions` tambahan milik kita (track subtitle) |
| Media Count | jumlah item media | — |
| Created At | `tweet.createdAt` (ISO dari `<time datetime>`) | kosong bila tidak ada di DOM |
| Conversation Id | dari URL thread, fallback tweet pertama | `inferred` bila fallback |
| In Reply To Status Id | `tweet.replyTo` | null bila tidak diketahui (jangan baca posisi sebagai parent) |
| In Reply To User Id | — | **kosong, tidak ada di DOM** |
| In Reply To Screen Name | — | **kosong, tidak ada di DOM** |
| Reply Count | `metrics.replies` | 0 bila tidak terbaca (default model) |
| Retweet Count | `metrics.reposts` | 0 bila tidak terbaca (default model) |
| Favorite Count | `metrics.likes` | 0 bila tidak terbaca (default model) |
| Quote Count | — | **kosong, tidak ada di DOM** (tidak diisi 0 — 0 adalah klaim) |
| Bookmark Count | — | **kosong, tidak ada di DOM** |
| View Count | `metrics.views` | 0 bila tidak terbaca (default model) |
| Favorited | — | **kosong** (relasi viewer, tidak ada di DOM) |
| Retweeted | — | **kosong** (relasi viewer, tidak ada di DOM) |
| Bookmarked | — | **kosong** (relasi viewer, tidak ada di DOM) |
| Is Quote Status | — | **kosong, tidak ada di DOM** |
| Language | — | **kosong, tidak ada di DOM** |
| Expanded URLs | URL http(s) diekstrak dari teks tweet | derivasi jujur dari teks, bukan API |
| Hashtags | `#tag` diekstrak dari teks tweet | derivasi jujur dari teks |
| User Mentions | `@user` diekstrak dari teks tweet | derivasi jujur dari teks |
| User Id | `user.id` | kosong bila tidak ada di DOM |
| User Name | `user.name` | — |
| User Screen Name | `user.screenName` | — |
| User Description | — | **kosong, tidak ada di DOM** |
| User Followers Count | — | **kosong, tidak ada di DOM** |
| User Friends Count | — | **kosong, tidak ada di DOM** |
| User Favourites Count | — | **kosong, tidak ada di DOM** |
| User Statuses Count | — | **kosong, tidak ada di DOM** |
| User Listed Count | — | **kosong, tidak ada di DOM** |
| User Avatar Url | `user.avatarUrl` | — |
| User Profile Banner Url | — | **kosong, tidak ada di DOM** |
| User Location | — | **kosong, tidak ada di DOM** |
| User Is Blue Verified | — | **kosong, tidak ada di DOM** |
| User Is Verified | — | **kosong, tidak ada di DOM** |
| User Is Protected | — | **kosong, tidak ada di DOM** |
| User Professional Type | — | **kosong, tidak ada di DOM** |
| User Created At | — | **kosong, tidak ada di DOM** |
| Scraped At | waktu scrape (ISO) | — |
