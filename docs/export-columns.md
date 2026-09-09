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
| Quote Count | `metrics.quotes` (API) | kosong bila DOM-only — 0 adalah klaim |
| Bookmark Count | `metrics.bookmarks` (API) | kosong bila DOM-only |
| View Count | `metrics.views` | 0 bila tidak terbaca (default model) |
| Favorited | API `favorited` → Yes/No | **kosong** bila DOM-only |
| Retweeted | API `retweeted` → Yes/No | **kosong** bila DOM-only |
| Bookmarked | API `bookmarked` → Yes/No | **kosong** bila DOM-only |
| Is Quote Status | API `is_quote_status` → Yes/No | **kosong** bila DOM-only |
| Language | API `lang` | **kosong** bila DOM-only |
| Expanded URLs | URL http(s) diekstrak dari teks tweet | derivasi jujur dari teks, bukan API |
| Hashtags | `#tag` diekstrak dari teks tweet | derivasi jujur dari teks |
| User Mentions | `@user` diekstrak dari teks tweet | derivasi jujur dari teks |
| User Id | `user.id` | kosong bila tidak ada di DOM |
| User Name | `user.name` | — |
| User Screen Name | `user.screenName` | — |
| User Description | `user.description` (API) | **kosong** bila DOM-only |
| User Followers Count | `user.followersCount` (API) | **kosong** bila DOM-only |
| User Friends Count | `user.friendsCount` (API) | **kosong** bila DOM-only |
| User Favourites Count | — | **kosong, tidak ada di API maupun DOM** |
| User Statuses Count | `user.statusesCount` (API) | **kosong** bila DOM-only |
| User Listed Count | — | **kosong, tidak ada di API maupun DOM** |
| User Avatar Url | `user.avatarUrl` | — |
| User Profile Banner Url | `user.bannerUrl` (API) | **kosong** bila DOM-only |
| User Location | `user.location` (API) | **kosong** bila DOM-only |
| User Is Blue Verified | API → Yes/No | **kosong** bila DOM-only |
| User Is Verified | API → Yes/No | **kosong** bila DOM-only |
| User Is Protected | API → Yes/No | **kosong** bila DOM-only |
| User Professional Type | `user.professionalType` (API) | **kosong** bila DOM-only |
| User Created At | `user.createdAt` (API) | **kosong** bila DOM-only |
| Scraped At | waktu scrape (ISO) | — |
