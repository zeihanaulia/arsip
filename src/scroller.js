/**
 * Auto-expand loop for thread capture (Task 3).
 * Classic script on purpose, like x-adapter.js: exposes `XScroller` on
 * globalThis for the content script. Clicks "show more" affordances and
 * scrolls in batches until the timeline stops growing or a limit hits.
 */

/**
 * @typedef {Object} ExpandOptions
 * @property {number} [maxBatches] Hard cap on iterations (default 40).
 * @property {number} [batchDelayMs] Settle time per batch (default 1500).
 * @property {number} [maxIdleBatches] Give up after this many batches
 *   without growth (default 4). Separate from maxBatches so patience
 *   against slow chunks is tunable without raising the hard cap.
 * @property {number} [maxTweets] Stop once this many tweets load (default 300).
 * @property {() => boolean} [shouldStop] Cooperative cancel hook.
 */

/**
 * @typedef {Object} ScrollStats
 * @property {number} clicked Expand buttons clicked.
 * @property {number} batches Batches executed.
 * @property {number} tweets Tweets loaded when stopping.
 * @property {number[]} history Tweet count after each batch (growth curve).
 * @property {string} scrollTarget What was scrolled (tag#id/.class).
 * @property {string} stoppedWhy "idle" | "max-batches" | "max-tweets" | "cancelled".
 */

/**
 * @param {ParentNode} root
 * @returns {number}
 */
function countTweets(root) {
	const adapter = globalThis.XAdapter;
	return adapter.findTweetElements(root).length;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Click expand buttons, scroll, and wait for the timeline to settle.
 * Stops early when two consecutive batches add nothing.
 *
 * @param {ParentNode} [root]
 * @param {ExpandOptions} [options]
 * @param {(stats: ScrollStats) => void} [onProgress]
 * @returns {Promise<ScrollStats>}
 */
async function expandAndScroll(root, options = {}, onProgress) {
	const doc = root ?? document;
	const {
		maxBatches = 40,
		batchDelayMs = 1500,
		maxIdleBatches = 4,
		maxTweets = 300,
		shouldStop = () => false,
	} = options;
	const /** @type {ScrollStats} */ stats = {
			clicked: 0,
			batches: 0,
			tweets: 0,
			history: [],
			scrollTarget: describeScrollTarget(doc),
			stoppedWhy: "idle",
		};
	let idleBatches = 0;
	let previous = countTweets(doc);

	for (let batch = 0; batch < maxBatches; batch += 1) {
		if (shouldStop()) {
			stats.stoppedWhy = "cancelled";
			break;
		}
		for (const button of globalThis.XAdapter.findExpandButtons(doc)) {
			button.click();
			stats.clicked += 1;
		}
		await scrollStepped(doc);
		await sleep(batchDelayMs);
		stats.batches = batch + 1;
		stats.tweets = countTweets(doc);
		stats.history.push(stats.tweets);
		onProgress?.({ ...stats });
		if (stats.tweets >= maxTweets) {
			stats.stoppedWhy = "max-tweets";
			break;
		}
		idleBatches = stats.tweets > previous ? 0 : idleBatches + 1;
		previous = stats.tweets;
		if (idleBatches >= maxIdleBatches) {
			stats.stoppedWhy = "idle";
			break;
		}
		if (batch === maxBatches - 1) {
			stats.stoppedWhy = "max-batches";
		}
	}
	return stats;
}

/**
 * Scrolls every loaded tweet into view so lazily-mounted players
 * (preload="none" video, etc.) get created before the final scrape.
 * Cheap when nothing is lazy: one pass, one settle wait.
 *
 * @param {ParentNode} [root]
 * @param {{ settleMs?: number }} [options]
 * @returns {Promise<number>} Tweet count after mounting.
 */
async function mountLazyMedia(root, options = {}) {
	const { settleMs = 1500 } = options;
	const doc = root ?? document;
	for (const article of globalThis.XAdapter.findTweetElements(doc)) {
		if (
			article instanceof Element &&
			typeof article.scrollIntoView === "function"
		) {
			article.scrollIntoView({ block: "center" });
		}
	}
	await sleep(settleMs);
	return countTweets(doc);
}

/**
 * Finds everything that scrolls the timeline: all ancestors of the
 * first tweet with real scrollable overflow, deepest first, plus the
 * document scroller when it scrolls too. X virtualizes its timeline
 * in an inner container, and guessing a single container risks moving
 * the wrong one while the sentinel never fires.
 *
 * @param {ParentNode} doc
 * @returns {Element[]}
 */
function findScrollContainers(doc) {
	const /** @type {Element[]} */ targets = [];
	if (doc === document) {
		const first = document.querySelector('article[data-testid="tweet"]');
		let node = first?.parentElement ?? null;
		while (node) {
			if (
				node instanceof Element &&
				node.scrollHeight - node.clientHeight > 50 &&
				!targets.includes(node)
			) {
				targets.push(node);
			}
			node = node.parentElement;
		}
		const page = document.scrollingElement ?? document.body;
		if (page.scrollHeight - page.clientHeight > 50 && !targets.includes(page)) {
			targets.push(page);
		}
		return targets;
	}
	if (doc instanceof Element) {
		return [doc];
	}
	return [];
}

/**
 * Short descriptor list of the scroll targets for diagnosis
 * (which containers the batches actually moved).
 *
 * @param {ParentNode} doc
 * @returns {string} e.g. "DIV#timeline,DIV#outer".
 */
function describeScrollTarget(doc) {
	return findScrollContainers(doc).map(describeElement).join(",");
}

/**
 * @param {Element} target
 * @returns {string} e.g. "DIV#timeline" or "DIV.css-g5y9jx".
 */
function describeElement(target) {
	const tag = target.tagName || "?";
	const id = target.getAttribute?.("id");
	if (id) {
		return `${tag}#${id}`;
	}
	const classes = (target.getAttribute?.("class") ?? "")
		.split(/\s+/)
		.filter(Boolean);
	return classes.length > 0 ? `${tag}.${classes[0]}` : tag;
}

/**
 * Scrolls every scrollable ancestor in human-like steps instead of one
 * jump to the bottom. Virtualized timelines observe sentinels
 * progressively; an instant jump can add and recycle the sentinel
 * before its observer fires, so no chunk ever loads.
 *
 * @param {ParentNode} doc
 */
async function scrollStepped(doc) {
	for (const target of findScrollContainers(doc)) {
		const max = target.scrollHeight;
		for (let step = 1; step <= 2; step += 1) {
			target.scrollTop = (max * step) / 2;
			await sleep(300);
		}
	}
}

globalThis.XScroller = { expandAndScroll, mountLazyMedia };
