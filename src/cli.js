#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { extractTranscriptFromPage } from "./browser-extractor.js";
import { renderMarkdownTranscript } from "./markdown.js";

const DEFAULT_CDP_URL = "http://127.0.0.1:9222";

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const browser = await connectToChrome(options.cdpUrl);
  try {
    const page = await resolvePage(browser, options.url);
    const result = await extractTranscriptFromPage(page, {
      delayMs: options.delayMs,
      maxIdleRounds: options.maxIdleRounds,
      debug: options.debug,
    });

    const output = renderMarkdownTranscript(result, {
      sourceUrl: page.url(),
      extractedAt: new Date().toISOString(),
    });

    await fs.mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
    await fs.writeFile(options.out, output, "utf8");

    const expectedSuffix = result.expectedTotal ? ` / ${result.expectedTotal}` : "";
    console.log(`Done: wrote ${options.out}`);
    console.log(`Rows: ${result.rows.length}${expectedSuffix}`);
    if (result.expectedTotal && result.rows.length < result.expectedTotal) {
      console.warn(`Warning: extracted fewer rows than Teams reported.`);
    }
  } finally {
    await closeBrowserConnection(browser);
  }
}

async function closeBrowserConnection(browser) {
  try {
    await browser.close();
  } catch (error) {
    console.warn(`Warning: could not close the Chrome DevTools connection cleanly: ${error.message}`);
  }
}

async function connectToChrome(cdpUrl) {
  try {
    return await chromium.connectOverCDP(cdpUrl);
  } catch (error) {
    throw new Error(
      [
        `Could not attach to Chrome at ${cdpUrl}.`,
        `Start Chrome first with: task chrome:debug`,
        `If Chrome was already open, quit Chrome completely and run: task chrome:debug`,
        `Or let the project restart Chrome with: task chrome:debug:restart`,
        `Fallback: task chrome:debug:isolated`,
        `Then log in/open Teams as needed and rerun the extract task.`,
        `Original error: ${error.message}`,
      ].join("\n"),
    );
  }
}

async function resolvePage(browser, url) {
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const pages = context.pages();

  if (url) {
    const existing = pages.find((page) => page.url() === url);
    const page = existing ?? pages[0] ?? (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    return page;
  }

  const currentPage = pages.find((page) => page.url() && page.url() !== "about:blank") ?? pages[0];
  if (!currentPage) {
    throw new Error("No open Chrome tab found. Provide URL=... or open the transcript tab first.");
  }
  return currentPage;
}

function parseArgs(args) {
  const options = {
    url: null,
    out: "transcript.md",
    cdpUrl: DEFAULT_CDP_URL,
    delayMs: 500,
    maxIdleRounds: 8,
    debug: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--url":
        options.url = normalizeUrlArgument(requireValue(args, ++index, arg));
        break;
      case "--out":
        options.out = requireValue(args, ++index, arg);
        break;
      case "--cdp-url":
        options.cdpUrl = requireValue(args, ++index, arg);
        break;
      case "--delay-ms":
        options.delayMs = parsePositiveInteger(requireValue(args, ++index, arg), arg);
        break;
      case "--max-idle-rounds":
        options.maxIdleRounds = parsePositiveInteger(requireValue(args, ++index, arg), arg);
        break;
      case "--debug":
        options.debug = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function normalizeUrlArgument(value) {
  return value
    .replaceAll("\\?", "?")
    .replaceAll("\\&", "&")
    .replaceAll("\\=", "=")
    .replaceAll("\\.", ".");
}

function requireValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a positive integer.`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: teams-transcript-extractor [options]

Options:
  --url <url>                Teams/Stream URL. If omitted, uses the current Chrome tab.
  --out <path>               Markdown output path. Default: transcript.md
  --cdp-url <url>            Chrome DevTools URL. Default: ${DEFAULT_CDP_URL}
  --delay-ms <number>        Delay between scrolls. Default: 500
  --max-idle-rounds <number> Stop after this many idle bottom rounds. Default: 8
  --debug                    Log every scroll round.
`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
