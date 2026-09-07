/**
 * Thin orchestrator: relays popup requests to the tab and triggers
 * `chrome.downloads` on completion. Never touches page DOM or media bytes.
 */
import { createMessage, isMessage, MESSAGE_TYPES } from "./messaging.js";

chrome.runtime.onMessage.addListener((raw, _sender, respond) => {
	if (!isMessage(raw)) {
		respond(createMessage(MESSAGE_TYPES.SCRAPE_ERROR, { code: "BAD_MESSAGE" }));
		return false;
	}
	forwardToActiveTab(raw).then(respond);
	return true;
});

/**
 * @param {{ type: string, payload: Record<string, unknown> }} message
 * @returns {Promise<unknown>}
 */
async function forwardToActiveTab(message) {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (tab?.id === undefined) {
		return createMessage(MESSAGE_TYPES.SCRAPE_ERROR, { code: "NO_ACTIVE_TAB" });
	}
	return chrome.tabs.sendMessage(tab.id, message);
}
