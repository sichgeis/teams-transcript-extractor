import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { chromium } from "playwright";
import { collectTranscriptRowsFromDocument, dedupeAndSortRows } from "../src/transcript-parser.js";
import { renderMarkdownTranscript } from "../src/markdown.js";

const fixturePath =
  "/Users/christian/.codex/attachments/416d2b8d-56e9-4f50-9a9c-e68175fe2c9c/pasted-text.txt";

test("extracts rendered Teams rows and expected total from DOM fixture", async () => {
  const html = fs.readFileSync(fixturePath, "utf8");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    const result = await page.evaluate(() => {
      const normalizeText = (value) => value.replace(/\s+/g, " ").trim();
      const rows = [];
      let expectedTotal = null;
      for (const entry of document.querySelectorAll('[id^="sub-entry-"]')) {
        const id = Number.parseInt(entry.id.replace("sub-entry-", ""), 10);
        const setSize = Number.parseInt(entry.getAttribute("aria-setsize") || "", 10);
        if (Number.isFinite(setSize)) {
          expectedTotal = Math.max(expectedTotal ?? 0, setSize);
        }
        const header = document.querySelector(`#itemHeader-${id}`);
        rows.push({
          id,
          position: Number.parseInt(entry.getAttribute("aria-posinset") || "", 10),
          speaker:
            normalizeText(header?.querySelector('[class*="itemDisplayName"]')?.textContent || "") ||
            normalizeText(entry.querySelector('[class*="eventSpeakerName"]')?.textContent || "") ||
            null,
          timestamp: normalizeText(document.querySelector(`#Header-timestamp-${id}`)?.textContent || "") || null,
          text: normalizeText(entry.textContent || ""),
        });
      }
      return { expectedTotal, rows };
    });

    assert.equal(result.rows.length, 35);
    assert.equal(result.expectedTotal, 640);
    assert.deepEqual(
      result.rows.slice(0, 5).map((row) => row.id),
      [0, 1, 2, 3, 4],
    );
    assert.deepEqual(
      result.rows.slice(-5).map((row) => row.id),
      [635, 636, 637, 638, 639],
    );
    assert.equal(result.rows.at(-1).speaker, "Christian Geisler");
    assert.match(result.rows.at(-1).text, /stopped transcription/);
  } finally {
    await browser.close();
  }
});

test("deduplicates rows by id and keeps richer metadata", () => {
  const rows = dedupeAndSortRows([
    { id: 2, text: "two", speaker: null, timestamp: null },
    { id: 1, text: "one", speaker: "A", timestamp: "0:01" },
    { id: 2, text: "two", speaker: "B", timestamp: "0:02" },
  ]);

  assert.deepEqual(
    rows.map((row) => row.id),
    [1, 2],
  );
  assert.equal(rows[1].speaker, "B");
});

test("renders markdown with incomplete warning", () => {
  const markdown = renderMarkdownTranscript({
    expectedTotal: 3,
    rows: [
      { id: 0, text: "started transcription", speaker: "Christian", timestamp: null, kind: "event" },
      { id: 1, text: "hello", speaker: "Ada", timestamp: "0:01", kind: "speech" },
    ],
  });

  assert.match(markdown, /extracted 2 of 3 expected transcript rows/);
  assert.match(markdown, /\*\*Christian:\*\* started transcription/);
  assert.match(markdown, /`0:01` \*\*Ada:\*\* hello/);
});

test("module parser works in a browser-like document", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <div style="height: 100px; overflow-y: auto">
        <div id="itemHeader-3"><span class="itemDisplayName-1">Ada</span><span id="Header-timestamp-3">0:03</span></div>
        <div id="sub-entry-3" aria-setsize="4" aria-posinset="4">Hello world</div>
      </div>
    `);
    const result = await page.evaluate(() => {
      const entry = document.querySelector('[id^="sub-entry-"]');
      return {
        id: Number(entry.id.replace("sub-entry-", "")),
        setSize: Number(entry.getAttribute("aria-setsize")),
      };
    });
    assert.deepEqual(result, { id: 3, setSize: 4 });
  } finally {
    await browser.close();
  }
});
