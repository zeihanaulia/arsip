/**
 * Site adapter registry (Task 10). Maps hosts to the classic scripts
 * implementing the SiteAdapter contract for that site:
 *
 * - detect: pure host/path matching lives here (unit-tested).
 * - scrape/scroll/media: implemented per site in its classic file
 *   (x-adapter.js exposes XAdapter, oreilly-adapter.js exposes XOReilly).
 *
 * x-adapter.js behavior is unchanged by this refactor; it simply becomes
 * the first registered implementation of the contract.
 */

/**
 * @typedef {Object} SiteAdapterEntry
 * @property {string} id "x" | "oreilly".
 * @property {string[]} hosts Suffix-matched hostnames.
 * @property {string[]} scripts Classic files, load order = array order.
 * @property {string} global Global object the scripts expose.
 */

/** @type {SiteAdapterEntry[]} */
export const SITE_ADAPTERS = [
	{
		id: "x",
		hosts: ["x.com", "twitter.com"],
		scripts: [
			"src/x-adapter.js",
			"src/scroller.js",
			"vendor/jszip.min.js",
			"vendor/xlsx.full.min.js",
			"src/media.js",
			"src/content.js",
		],
		global: "XAdapter",
	},
	{
		id: "oreilly",
		hosts: ["learning.oreilly.com"],
		scripts: ["src/hook-main.js", "src/oreilly-adapter.js", "src/content.js"],
		global: "XOReilly",
	},
];

/**
 * @param {string} url
 * @returns {string | null} Adapter id, or null when unregistered.
 */
export function detectAdapter(url) {
	let host = "";
	try {
		host = new URL(String(url ?? "")).hostname.toLowerCase();
	} catch {
		return null;
	}
	for (const adapter of SITE_ADAPTERS) {
		if (
			adapter.hosts.some(
				(known) => host === known || host.endsWith(`.${known}`),
			)
		) {
			return adapter.id;
		}
	}
	return null;
}
