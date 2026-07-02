// ==UserScript==
// @name         Teams Transcript Extractor
// @namespace    https://local.codex/teams-transcript-extractor
// @version      0.1.0
// @description  Extract visible Teams/Stream transcript rows into Markdown and copy them locally.
// @author       Christian
// @match        https://*.sharepoint.com/*
// @match        https://*.office.com/*
// @match        https://*.microsoftstream.com/*
// @match        https://teams.microsoft.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const PANEL_ID = "tte-panel";
  const BUTTON_ID = "tte-extract-button";
  const COPY_BUTTON_ID = "tte-copy-button";
  const STATUS_ID = "tte-status";
  const STYLE_ID = "tte-style";
  const ROW_TEXT_SELECTOR = '[id^="sub-entry-"]';
  const ROW_CONTAINER_SELECTOR = '[id^="listItem-"], [role="listitem"], [aria-posinset]';
  const TRANSCRIPT_BUTTON_LABELS = [
    "transcript",
    "transkription",
    "transkript",
    "abschrift"
  ];
  const DEFAULT_WAIT_MS = 550;
  const MAX_SCROLL_ROUNDS = 2400;
  const IDLE_ROUND_LIMIT = 8;

  let lastMarkdown = "";
  let observer = null;
  let detectionTimer = null;
  let lastDetectionState = "idle";

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function extractTrailingNumber(value) {
    const match = String(value || "").match(/(\d+)$/);
    return match ? Number.parseInt(match[1], 10) : null;
  }

  function toFiniteNumber(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const number = Number.parseInt(String(value), 10);
    return Number.isFinite(number) ? number : null;
  }

  function getRowIndex(textElement, container) {
    return (
      extractTrailingNumber(textElement && textElement.id) ??
      extractTrailingNumber(container && container.id) ??
      toFiniteNumber(container && container.getAttribute("aria-posinset"))
    );
  }

  function getExpectedCount(root) {
    const candidates = root.querySelectorAll("[aria-setsize]");
    let expected = null;

    candidates.forEach((element) => {
      const value = toFiniteNumber(element.getAttribute("aria-setsize"));
      if (value !== null && (expected === null || value > expected)) {
        expected = value;
      }
    });

    return expected;
  }

  function getText(element) {
    return normalizeWhitespace(element ? element.textContent : "");
  }

  function queryById(root, id) {
    if (!id || !root.getElementById) {
      return null;
    }

    return root.getElementById(id);
  }

  function findSpeaker(container, root, index) {
    const header =
      (index !== null && queryById(root, `itemHeader-${index}`)) ||
      (container && container.querySelector('[id^="itemHeader-"]')) ||
      null;

    if (!header) {
      return "";
    }

    const speaker =
      header.querySelector('[class*="itemDisplayName"]') ||
      header.querySelector('[data-tid*="display"]') ||
      header.querySelector("span, div");

    return getText(speaker || header);
  }

  function findTimestamp(container, root, index) {
    const timestamp =
      (index !== null && queryById(root, `Header-timestamp-${index}`)) ||
      (container && container.querySelector('[id^="Header-timestamp-"]')) ||
      (container && container.querySelector("[data-tid*='timestamp']")) ||
      null;

    return getText(timestamp);
  }

  function findRowContainer(textElement) {
    if (!textElement || !textElement.closest) {
      return textElement || null;
    }

    return textElement.closest(ROW_CONTAINER_SELECTOR) || textElement.parentElement || textElement;
  }

  function parseVisibleRows(root) {
    const documentLike = root && root.ownerDocument ? root.ownerDocument : root;
    const textElements = Array.from(root.querySelectorAll(ROW_TEXT_SELECTOR));
    const rows = [];

    textElements.forEach((textElement, renderedOrder) => {
      const text = getText(textElement);
      if (!text) {
        return;
      }

      const container = findRowContainer(textElement);
      const index = getRowIndex(textElement, container);
      const position = toFiniteNumber(container && container.getAttribute("aria-posinset"));

      rows.push({
        key: makeRowKey({
          index,
          position,
          speaker: findSpeaker(container, documentLike, index),
          timestamp: findTimestamp(container, documentLike, index),
          text
        }, renderedOrder),
        index,
        position,
        renderedOrder,
        speaker: findSpeaker(container, documentLike, index),
        timestamp: findTimestamp(container, documentLike, index),
        text
      });
    });

    return rows;
  }

  function makeRowKey(row, fallbackIndex) {
    if (row.index !== null && row.index !== undefined) {
      return `index:${row.index}`;
    }

    if (row.position !== null && row.position !== undefined) {
      return `position:${row.position}`;
    }

    return `text:${row.timestamp || ""}|${row.speaker || ""}|${row.text || ""}|${fallbackIndex}`;
  }

  function rowSortValue(row) {
    if (row.index !== null && row.index !== undefined) {
      return row.index;
    }

    if (row.position !== null && row.position !== undefined) {
      return row.position;
    }

    return Number.MAX_SAFE_INTEGER;
  }

  function sortRows(rows) {
    return rows.slice().sort((left, right) => {
      const sortDifference = rowSortValue(left) - rowSortValue(right);
      if (sortDifference !== 0) {
        return sortDifference;
      }

      return (left.renderedOrder || 0) - (right.renderedOrder || 0);
    });
  }

  function carryForwardSpeakers(rows) {
    let previous = null;

    return sortRows(rows).map((row) => {
      const normalized = {
        ...row,
        speaker: normalizeWhitespace(row.speaker),
        timestamp: normalizeWhitespace(row.timestamp),
        text: normalizeWhitespace(row.text)
      };

      const currentOrder = rowSortValue(normalized);
      const previousOrder = previous ? rowSortValue(previous) : null;
      const isContiguous =
        previous &&
        Number.isFinite(currentOrder) &&
        Number.isFinite(previousOrder) &&
        currentOrder === previousOrder + 1;

      if (!normalized.speaker && isContiguous) {
        normalized.speaker = previous.speaker || "";
        normalized.speakerCarried = Boolean(normalized.speaker);
      } else {
        normalized.speakerCarried = false;
      }

      previous = normalized;
      return normalized;
    });
  }

  function escapeMarkdownText(value) {
    return normalizeWhitespace(value).replace(/\\/g, "\\\\").replace(/\*/g, "\\*");
  }

  function formatMarkdown(rows, metadata = {}) {
    const sortedRows = carryForwardSpeakers(rows).filter((row) => row.text);
    const title = normalizeWhitespace(metadata.title) || "Teams Transcript";
    const url = normalizeWhitespace(metadata.url);
    const extractedAt = metadata.extractedAt || new Date().toISOString();
    const expectedCount = metadata.expectedCount || null;

    const lines = [
      `# ${title}`,
      "",
      url ? `Source: ${url}` : null,
      `Extracted: ${extractedAt}`,
      `Rows: ${sortedRows.length}${expectedCount ? ` / ${expectedCount}` : ""}`,
      ""
    ].filter((line) => line !== null);

    sortedRows.forEach((row) => {
      const prefixParts = [];

      if (row.timestamp) {
        prefixParts.push(`\`${escapeMarkdownText(row.timestamp)}\``);
      }

      if (row.speaker) {
        prefixParts.push(`**${escapeMarkdownText(row.speaker)}:**`);
      }

      const prefix = prefixParts.length ? `${prefixParts.join(" ")} ` : "";
      lines.push(`${prefix}${escapeMarkdownText(row.text)}`);
      lines.push("");
    });

    return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
  }

  function buildFilename(title, now = new Date()) {
    const datePart = now.toISOString().slice(0, 10);
    const safeTitle = normalizeWhitespace(title || "teams-transcript")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);

    return `${datePart}-${safeTitle || "teams-transcript"}.md`;
  }

  function findTranscriptButton(root) {
    const buttons = Array.from(root.querySelectorAll('button, [role="button"]'));

    return buttons.find((button) => {
      if (button.closest && button.closest(`#${PANEL_ID}`)) {
        return false;
      }

      const label = normalizeWhitespace(
        button.getAttribute("aria-label") ||
        button.getAttribute("title") ||
        button.textContent ||
        ""
      ).toLowerCase();

      return TRANSCRIPT_BUTTON_LABELS.some((candidate) => label.includes(candidate));
    }) || null;
  }

  function isVisible(element) {
    if (!element || !element.getBoundingClientRect) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  }

  function transcriptRowsExist(root) {
    return root.querySelector(ROW_TEXT_SELECTOR) !== null;
  }

  function findTranscriptScroller(root) {
    const firstRow = root.querySelector(ROW_TEXT_SELECTOR);
    if (!firstRow) {
      return null;
    }

    const candidates = [];
    let current = firstRow.parentElement;

    while (current && current !== root.body && current !== root.documentElement) {
      const rowCount = current.querySelectorAll ? current.querySelectorAll(ROW_TEXT_SELECTOR).length : 0;
      const hasOverflow = current.scrollHeight > current.clientHeight + 16;

      if (hasOverflow && rowCount > 0) {
        candidates.push({
          element: current,
          rowCount,
          area: current.clientWidth * current.clientHeight
        });
      }

      current = current.parentElement;
    }

    if (!candidates.length) {
      return null;
    }

    candidates.sort((left, right) => {
      if (left.rowCount !== right.rowCount) {
        return right.rowCount - left.rowCount;
      }

      return left.area - right.area;
    });

    return candidates[0].element;
  }

  function wait(ms = DEFAULT_WAIT_MS) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function setStatus(message) {
    const status = document.getElementById(STATUS_ID);
    if (status) {
      status.textContent = message;
    }
  }

  function setBusy(isBusy) {
    const button = document.getElementById(BUTTON_ID);
    if (button) {
      button.disabled = isBusy;
      button.textContent = isBusy ? "Extracting..." : "Extract transcript";
    }
  }

  function showCopyButton(visible) {
    const copyButton = document.getElementById(COPY_BUTTON_ID);
    if (copyButton) {
      copyButton.hidden = !visible;
    }
  }

  async function copyText(text) {
    if (!text) {
      return false;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_error) {
        // Fall back to execCommand below. Some browsers require a fresh click.
      }
    }

    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "readonly");
    textArea.style.position = "fixed";
    textArea.style.top = "-1000px";
    textArea.style.left = "-1000px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      return document.execCommand("copy");
    } catch (_error) {
      return false;
    } finally {
      textArea.remove();
    }
  }

  async function ensureTranscriptOpen() {
    if (transcriptRowsExist(document)) {
      return true;
    }

    const transcriptButton = findTranscriptButton(document);
    if (!transcriptButton || !isVisible(transcriptButton)) {
      return false;
    }

    setStatus("Opening transcript panel...");
    transcriptButton.click();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await wait(350);
      if (transcriptRowsExist(document)) {
        return true;
      }
    }

    return transcriptRowsExist(document);
  }

  function upsertRows(rowMap, visibleRows) {
    let added = 0;

    visibleRows.forEach((row) => {
      const existing = rowMap.get(row.key);
      if (!existing || normalizeWhitespace(existing.text).length < normalizeWhitespace(row.text).length) {
        rowMap.set(row.key, row);
        if (!existing) {
          added += 1;
        }
      }
    });

    return added;
  }

  async function extractTranscript({ onProgress } = {}) {
    const opened = await ensureTranscriptOpen();
    if (!opened) {
      throw new Error("I could not find or open the transcript panel. Open the transcript manually and try again.");
    }

    await wait(400);

    const scroller = findTranscriptScroller(document);
    if (!scroller) {
      throw new Error("I found transcript rows, but not the scroll container. Try scrolling the transcript pane once and run again.");
    }

    const expectedCount = getExpectedCount(document);
    const rowsByKey = new Map();
    let idleRounds = 0;

    scroller.scrollTop = 0;
    await wait(600);

    for (let round = 0; round < MAX_SCROLL_ROUNDS; round += 1) {
      const visibleRows = parseVisibleRows(document);
      const added = upsertRows(rowsByKey, visibleRows);
      const collectedCount = rowsByKey.size;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;

      if (onProgress) {
        onProgress({
          collectedCount,
          expectedCount,
          visibleCount: visibleRows.length,
          atBottom,
          round
        });
      }

      if (expectedCount && collectedCount >= expectedCount) {
        break;
      }

      if (atBottom && added === 0) {
        idleRounds += 1;
      } else if (added > 0) {
        idleRounds = 0;
      }

      if (idleRounds >= IDLE_ROUND_LIMIT) {
        break;
      }

      const before = scroller.scrollTop;
      scroller.scrollTop = Math.min(
        scroller.scrollTop + Math.max(240, Math.floor(scroller.clientHeight * 0.78)),
        scroller.scrollHeight
      );

      if (scroller.scrollTop === before && atBottom) {
        idleRounds += 1;
      }

      await wait(DEFAULT_WAIT_MS);
    }

    const rows = sortRows(Array.from(rowsByKey.values()));
    if (!rows.length) {
      throw new Error("No transcript rows were collected.");
    }

    return {
      rows,
      expectedCount,
      markdown: formatMarkdown(rows, {
        title: document.title || "Teams Transcript",
        url: window.location.href,
        extractedAt: new Date().toISOString(),
        expectedCount
      })
    };
  }

  async function handleExtractClick() {
    setBusy(true);
    showCopyButton(false);
    setStatus("Looking for transcript...");

    try {
      const result = await extractTranscript({
        onProgress: ({ collectedCount, expectedCount, visibleCount }) => {
          const total = expectedCount ? ` / ${expectedCount}` : "";
          setStatus(`Collected ${collectedCount}${total} rows (${visibleCount} visible).`);
        }
      });

      lastMarkdown = result.markdown;
      const copied = await copyText(lastMarkdown);
      showCopyButton(true);

      const total = result.expectedCount ? ` / ${result.expectedCount}` : "";
      setStatus(copied
        ? `Copied ${result.rows.length}${total} rows to clipboard.`
        : `Collected ${result.rows.length}${total} rows. Click Copy Markdown to copy.`);
    } catch (error) {
      setStatus(error && error.message ? error.message : "Extraction failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyClick() {
    const copied = await copyText(lastMarkdown);
    setStatus(copied ? "Copied Markdown to clipboard." : "Clipboard copy failed. Try the button again.");
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        width: min(320px, calc(100vw - 32px));
        box-sizing: border-box;
        padding: 10px;
        border: 1px solid rgba(32, 31, 30, 0.25);
        border-radius: 8px;
        background: #ffffff;
        color: #201f1e;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
        font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #${PANEL_ID}[hidden] {
        display: none;
      }

      #${PANEL_ID} .tte-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 8px;
      }

      #${PANEL_ID} button {
        min-height: 32px;
        border: 1px solid #6264a7;
        border-radius: 6px;
        padding: 0 10px;
        color: #ffffff;
        background: #6264a7;
        cursor: pointer;
        font: inherit;
        font-weight: 600;
      }

      #${PANEL_ID} button:disabled {
        opacity: 0.64;
        cursor: wait;
      }

      #${PANEL_ID} button[data-secondary="true"] {
        color: #323130;
        background: #ffffff;
        border-color: rgba(32, 31, 30, 0.35);
      }

      #${PANEL_ID} button[hidden] {
        display: none;
      }

      #${STATUS_ID} {
        min-height: 18px;
        color: #323130;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function ensurePanel() {
    injectStyles();

    let panel = document.getElementById(PANEL_ID);
    if (panel) {
      return panel;
    }

    panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.hidden = true;
    panel.setAttribute("aria-label", "Teams transcript extractor");
    panel.innerHTML = `
      <div class="tte-actions">
        <button id="${BUTTON_ID}" type="button">Extract transcript</button>
        <button id="${COPY_BUTTON_ID}" type="button" data-secondary="true" hidden>Copy Markdown</button>
      </div>
      <div id="${STATUS_ID}">Waiting for transcript...</div>
    `;

    document.body.appendChild(panel);
    document.getElementById(BUTTON_ID).addEventListener("click", handleExtractClick);
    document.getElementById(COPY_BUTTON_ID).addEventListener("click", handleCopyClick);
    return panel;
  }

  function updatePanelVisibility() {
    const panel = ensurePanel();
    const hasRows = transcriptRowsExist(document);
    const hasTranscriptButton = Boolean(findTranscriptButton(document));
    const shouldShow = hasRows || hasTranscriptButton || lastMarkdown;
    const state = hasRows ? "rows" : hasTranscriptButton ? "button" : "hidden";

    panel.hidden = !shouldShow;

    if (state !== lastDetectionState && !lastMarkdown) {
      lastDetectionState = state;
      if (hasRows) {
        setStatus("Transcript detected.");
      } else if (hasTranscriptButton) {
        setStatus("Transcript button detected.");
      }
    }
  }

  function scheduleDetection() {
    if (detectionTimer) {
      window.clearTimeout(detectionTimer);
    }

    detectionTimer = window.setTimeout(updatePanelVisibility, 250);
  }

  function start() {
    if (!document.body) {
      window.setTimeout(start, 100);
      return;
    }

    ensurePanel();
    updatePanelVisibility();

    observer = new MutationObserver(scheduleDetection);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "aria-posinset", "aria-setsize", "id"]
    });
  }

  const api = {
    buildFilename,
    carryForwardSpeakers,
    extractTrailingNumber,
    formatMarkdown,
    getExpectedCount,
    makeRowKey,
    normalizeWhitespace,
    parseVisibleRows,
    rowSortValue,
    sortRows,
    upsertRows
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    window.TeamsTranscriptExtractor = api;
    start();
  }
})();
