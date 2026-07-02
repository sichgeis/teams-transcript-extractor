import { dedupeAndSortRows } from "./transcript-parser.js";

export async function extractTranscriptFromPage(page, options = {}) {
  const delayMs = options.delayMs ?? 500;
  const maxIdleRounds = options.maxIdleRounds ?? 8;
  const maxScrollRounds = options.maxScrollRounds ?? 2000;
  const debug = options.debug ?? false;

  await ensureTranscriptPanel(page);
  const containerHandle = await waitForTranscriptContainer(page);

  await containerHandle.evaluate((container) => {
    container.scrollTop = 0;
  });
  await page.waitForTimeout(delayMs);

  const rowsById = new Map();
  let expectedTotal = null;
  let idleRounds = 0;
  let previousScrollTop = -1;

  for (let round = 0; round < maxScrollRounds; round += 1) {
    const snapshot = await collectVisibleRows(page);
    expectedTotal = Math.max(expectedTotal ?? 0, snapshot.expectedTotal ?? 0) || expectedTotal;

    const before = rowsById.size;
    for (const row of snapshot.rows) {
      rowsById.set(row.id, row);
    }
    const collected = rowsById.size;

    if (debug || collected !== before) {
      logProgress(collected, expectedTotal);
    }

    if (expectedTotal && collected >= expectedTotal) {
      break;
    }

    const scrollState = await containerHandle.evaluate((container) => {
      const before = container.scrollTop;
      const step = Math.max(100, Math.floor(container.clientHeight * 0.85));
      container.scrollTop = Math.min(container.scrollTop + step, container.scrollHeight);
      return {
        before,
        after: container.scrollTop,
        clientHeight: container.clientHeight,
        scrollHeight: container.scrollHeight,
      };
    });

    const noNewRows = collected === before;
    const noScrollAdvance = scrollState.after === previousScrollTop || scrollState.after === scrollState.before;
    previousScrollTop = scrollState.after;

    if (noNewRows || noScrollAdvance) {
      idleRounds += 1;
    } else {
      idleRounds = 0;
    }

    const atBottom = scrollState.after + scrollState.clientHeight >= scrollState.scrollHeight - 2;
    if (idleRounds >= maxIdleRounds && atBottom) {
      break;
    }

    await page.waitForTimeout(delayMs);
  }

  const rows = dedupeAndSortRows(Array.from(rowsById.values()));
  return {
    expectedTotal,
    rows,
    complete: expectedTotal ? rows.length >= expectedTotal : null,
  };
}

export async function ensureTranscriptPanel(page) {
  const hasRows = await page.locator('[id^="sub-entry-"]').first().count();
  if (hasRows) {
    return;
  }

  const transcriptButton = page
    .getByRole("menuitem", { name: /transcript/i })
    .or(page.getByRole("button", { name: /transcript/i }))
    .first();

  if (await transcriptButton.count()) {
    await transcriptButton.click();
  }
}

async function waitForTranscriptContainer(page) {
  await page.waitForSelector('[id^="sub-entry-"]', { timeout: 30000 });
  const handle = await page.evaluateHandle(() => {
    const entry = document.querySelector('[id^="sub-entry-"]');
    if (!entry) {
      return null;
    }

    let candidate = entry.parentElement;
    while (candidate) {
      const style = window.getComputedStyle(candidate);
      const overflowY = style.overflowY;
      const scrollableStyle = overflowY === "auto" || overflowY === "scroll";
      const scrollableSize = candidate.scrollHeight > candidate.clientHeight + 2;
      if (scrollableStyle && scrollableSize) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }

    candidate = entry.parentElement;
    while (candidate) {
      if (candidate.scrollHeight > candidate.clientHeight + 2) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }

    return null;
  });

  const container = handle.asElement();
  if (!container) {
    throw new Error("Could not find the transcript scroll container.");
  }
  return container;
}

async function collectVisibleRows(page) {
  return page.evaluate(() => {
    const normalizeText = (value) => value.replace(/\s+/g, " ").trim();
    const numericSuffix = (value, prefix) => {
      if (!value || !value.startsWith(prefix)) {
        return null;
      }
      const parsed = Number.parseInt(value.slice(prefix.length), 10);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const readIntegerAttribute = (element, attribute) => {
      const value = element.getAttribute(attribute);
      if (!value) {
        return null;
      }
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const rows = [];
    let expectedTotal = null;

    for (const entry of document.querySelectorAll('[id^="sub-entry-"]')) {
      const id = numericSuffix(entry.id, "sub-entry-");
      if (id === null) {
        continue;
      }

      const setSize = readIntegerAttribute(entry, "aria-setsize");
      if (setSize !== null) {
        expectedTotal = Math.max(expectedTotal ?? 0, setSize);
      }

      const header = document.querySelector(`#itemHeader-${id}`);
      const displayName = header?.querySelector('[class*="itemDisplayName"]')?.textContent;
      const eventSpeaker = entry.querySelector('[class*="eventSpeakerName"]')?.textContent;
      const timestamp = document.querySelector(`#Header-timestamp-${id}`)?.textContent;

      rows.push({
        id,
        position: readIntegerAttribute(entry, "aria-posinset"),
        expectedTotal: setSize,
        speaker: normalizeText(displayName || eventSpeaker || "") || null,
        timestamp: normalizeText(timestamp || "") || null,
        text: normalizeText(entry.textContent || ""),
        kind:
          entry.querySelector('[class*="eventSpeakerName"]') || entry.closest('[class*="meetingEvent"]')
            ? "event"
            : "speech",
      });
    }

    return { expectedTotal, rows };
  });
}

function logProgress(collected, expectedTotal) {
  const suffix = expectedTotal ? ` / ${expectedTotal}` : "";
  console.log(`Collected: ${collected}${suffix}`);
}
