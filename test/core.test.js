const assert = require("node:assert/strict");
const test = require("node:test");

const extractor = require("../teams-transcript-extractor.user.js");

test("normalizes whitespace", () => {
  assert.equal(extractor.normalizeWhitespace("  hello\n   world\t "), "hello world");
});

test("extracts trailing numeric ids", () => {
  assert.equal(extractor.extractTrailingNumber("sub-entry-640"), 640);
  assert.equal(extractor.extractTrailingNumber("Header-timestamp-12"), 12);
  assert.equal(extractor.extractTrailingNumber("no-number"), null);
});

test("builds generic timestamped markdown filenames", () => {
  assert.equal(
    extractor.buildFilename("Sensitive Meeting Name", new Date("2026-07-02T12:34:56.000Z")),
    "teams-transcript-2026-07-02-12-34-56.md"
  );
});

test("deduplicates rows by key and keeps richer text", () => {
  const rows = new Map();
  const addedFirst = extractor.upsertRows(rows, [
    { key: "index:1", index: 1, text: "Short", speaker: "Alex" }
  ]);
  const addedSecond = extractor.upsertRows(rows, [
    { key: "index:1", index: 1, text: "Longer replacement", speaker: "Alex" }
  ]);

  assert.equal(addedFirst, 1);
  assert.equal(addedSecond, 0);
  assert.equal(rows.get("index:1").text, "Longer replacement");
});

test("carries speakers only across contiguous rows", () => {
  const rows = extractor.carryForwardSpeakers([
    { index: 1, speaker: "Alex", timestamp: "00:00:01", text: "First" },
    { index: 2, speaker: "", timestamp: "", text: "Continuation" },
    { index: 5, speaker: "", timestamp: "", text: "Gap should not carry" },
    { index: 6, speaker: "Sam", timestamp: "00:00:20", text: "New speaker" },
    { index: 7, speaker: "", timestamp: "", text: "Sam continuation" }
  ]);

  assert.equal(rows[1].speaker, "Alex");
  assert.equal(rows[1].speakerCarried, true);
  assert.equal(rows[2].speaker, "");
  assert.equal(rows[4].speaker, "Sam");
});

test("formats transcript markdown with metadata and carried speakers", () => {
  const markdown = extractor.formatMarkdown([
    { index: 1, speaker: "Alex", timestamp: "00:00:01", text: "Hello *team*" },
    { index: 2, speaker: "", timestamp: "", text: "Continuation line" }
  ], {
    title: "Weekly Sync",
    url: "https://example.test/recording",
    extractedAt: "2026-07-02T12:00:00.000Z",
    expectedCount: 2
  });

  assert.match(markdown, /^# Weekly Sync/);
  assert.match(markdown, /Source: https:\/\/example\.test\/recording/);
  assert.match(markdown, /Rows: 2 \/ 2/);
  assert.ok(markdown.includes("`00:00:01` **Alex:** Hello \\*team\\*"));
  assert.ok(markdown.includes("**Alex:** Continuation line"));
});

test("adds a warning when fewer rows are extracted than expected", () => {
  const markdown = extractor.formatMarkdown([
    { index: 1, speaker: "Alex", timestamp: "00:00:01", text: "Only row" }
  ], {
    title: "Partial Sync",
    extractedAt: "2026-07-02T12:00:00.000Z",
    expectedCount: 3
  });

  assert.match(markdown, /> Note: extracted 1 rows, but the page reported 3 total rows\./);
});
