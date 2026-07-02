export function collectTranscriptRowsFromDocument(document) {
  const entries = Array.from(document.querySelectorAll('[id^="sub-entry-"]'));
  const rows = [];
  let expectedTotal = null;

  for (const entry of entries) {
    const id = numericSuffix(entry.id, "sub-entry-");
    if (id === null) {
      continue;
    }

    const setSize = readIntegerAttribute(entry, "aria-setsize");
    if (setSize !== null) {
      expectedTotal = Math.max(expectedTotal ?? 0, setSize);
    }

    rows.push({
      id,
      position: readIntegerAttribute(entry, "aria-posinset"),
      expectedTotal: setSize,
      speaker: extractSpeaker(entry, id),
      timestamp: extractTimestamp(entry, id),
      text: normalizeText(entry.textContent ?? ""),
      kind: inferRowKind(entry),
    });
  }

  return {
    expectedTotal,
    rows: dedupeAndSortRows(rows),
  };
}

export function dedupeAndSortRows(rows) {
  const byId = new Map();

  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing || scoreRow(row) >= scoreRow(existing)) {
      byId.set(row.id, row);
    }
  }

  return Array.from(byId.values()).sort((left, right) => left.id - right.id);
}

export function findTranscriptScrollContainer(document) {
  const entry = document.querySelector('[id^="sub-entry-"]');
  if (!entry) {
    return null;
  }

  let candidate = entry.parentElement;
  while (candidate) {
    const style = document.defaultView.getComputedStyle(candidate);
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
}

function extractSpeaker(entry, id) {
  const header = entry.ownerDocument.querySelector(`#itemHeader-${id}`);
  const displayName = header?.querySelector('[class*="itemDisplayName"]')?.textContent;
  if (displayName && normalizeText(displayName)) {
    return normalizeText(displayName);
  }

  const eventSpeaker = entry.querySelector('[class*="eventSpeakerName"]')?.textContent;
  if (eventSpeaker && normalizeText(eventSpeaker)) {
    return normalizeText(eventSpeaker);
  }

  return null;
}

function extractTimestamp(entry, id) {
  const timestamp = entry.ownerDocument.querySelector(`#Header-timestamp-${id}`)?.textContent;
  if (timestamp && normalizeText(timestamp)) {
    return normalizeText(timestamp);
  }
  return null;
}

function inferRowKind(entry) {
  if (entry.querySelector('[class*="eventSpeakerName"]') || entry.closest('[class*="meetingEvent"]')) {
    return "event";
  }
  return "speech";
}

function readIntegerAttribute(element, attribute) {
  const value = element.getAttribute(attribute);
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function numericSuffix(value, prefix) {
  if (!value.startsWith(prefix)) {
    return null;
  }
  const parsed = Number.parseInt(value.slice(prefix.length), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function scoreRow(row) {
  return Number(Boolean(row.text)) + Number(Boolean(row.speaker)) + Number(Boolean(row.timestamp));
}
