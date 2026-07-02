export function renderMarkdownTranscript(result, options = {}) {
  const lines = ["# Teams Transcript", ""];

  if (options.sourceUrl) {
    lines.push(`Source: ${options.sourceUrl}`);
  }
  if (options.extractedAt) {
    lines.push(`Extracted: ${options.extractedAt}`);
  }
  if (options.sourceUrl || options.extractedAt) {
    lines.push("");
  }

  const expectedTotal = result.expectedTotal ?? maxExpectedTotal(result.rows);
  if (expectedTotal && result.rows.length < expectedTotal) {
    lines.push(
      `> Warning: extracted ${result.rows.length} of ${expectedTotal} expected transcript rows.`,
      "",
    );
  }

  for (const row of result.rows) {
    const text = stripDuplicatedEventSpeaker(row);
    if (!text) {
      continue;
    }

    if (row.timestamp && row.speaker) {
      lines.push(`\`${row.timestamp}\` **${escapeMarkdown(row.speaker)}:** ${text}`);
    } else if (row.speaker) {
      lines.push(`**${escapeMarkdown(row.speaker)}:** ${text}`);
    } else if (row.timestamp) {
      lines.push(`\`${row.timestamp}\` ${text}`);
    } else {
      lines.push(text);
    }
    lines.push("");
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function stripDuplicatedEventSpeaker(row) {
  if (row.kind !== "event" || !row.speaker) {
    return row.text;
  }

  if (row.text === row.speaker) {
    return "";
  }

  if (row.text.startsWith(`${row.speaker} `)) {
    return row.text.slice(row.speaker.length).trim();
  }

  return row.text;
}

function maxExpectedTotal(rows) {
  return rows.reduce((max, row) => Math.max(max, row.expectedTotal ?? 0), 0) || null;
}

function escapeMarkdown(value) {
  return value.replace(/([\\*_`])/g, "\\$1");
}
