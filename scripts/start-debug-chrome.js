#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const DEFAULT_PORT = 9222;
const CHROME_BINARY = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const options = parseArgs(process.argv.slice(2));
const cdpUrl = `http://127.0.0.1:${options.port}`;

if (options.quitFirst) {
  await quitChrome();
  await delay(1500);
}

if (await isDevToolsReady(cdpUrl)) {
  console.log(`Chrome DevTools is already available at ${cdpUrl}`);
  process.exit(0);
}

const chromeArgs = [`--remote-debugging-port=${options.port}`];
if (options.isolated) {
  chromeArgs.push(`--user-data-dir=${options.userDataDir}`);
}

spawn(CHROME_BINARY, chromeArgs, {
  detached: true,
  stdio: "ignore",
}).unref();

if (await waitForDevTools(cdpUrl, options.timeoutMs)) {
  console.log(`Chrome DevTools is available at ${cdpUrl}`);
  if (options.isolated) {
    console.log(`Using isolated profile: ${options.userDataDir}`);
  }
  process.exit(0);
}

console.error(`Chrome started, but DevTools did not become available at ${cdpUrl}.`);
if (!options.isolated) {
  console.error("If Chrome was already running, quit Chrome completely and run `task chrome:debug` again.");
  console.error("Or run `task chrome:debug:restart` to let this project quit and reopen Chrome for you.");
  console.error("Fallback: run `task chrome:debug:isolated` and log in there once.");
} else {
  console.error("Try closing the isolated Chrome window and run `task chrome:debug:isolated` again.");
}
process.exit(1);

async function waitForDevTools(cdpUrl, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isDevToolsReady(cdpUrl)) {
      return true;
    }
    await delay(250);
  }
  return false;
}

async function isDevToolsReady(cdpUrl) {
  try {
    const response = await fetch(`${cdpUrl}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

function parseArgs(args) {
  const parsed = {
    isolated: false,
    quitFirst: false,
    port: DEFAULT_PORT,
    timeoutMs: 5000,
    userDataDir: path.resolve(".chrome-debug-profile"),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--isolated":
        parsed.isolated = true;
        break;
      case "--quit-first":
        parsed.quitFirst = true;
        break;
      case "--port":
        parsed.port = parsePositiveInteger(requireValue(args, ++index, arg), arg);
        break;
      case "--timeout-ms":
        parsed.timeoutMs = parsePositiveInteger(requireValue(args, ++index, arg), arg);
        break;
      case "--user-data-dir":
        parsed.userDataDir = path.resolve(requireValue(args, ++index, arg));
        break;
      default:
        if (arg.startsWith("--user-data-dir=")) {
          parsed.userDataDir = path.resolve(arg.slice("--user-data-dir=".length));
          break;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

async function quitChrome() {
  await new Promise((resolve) => {
    const child = spawn("osascript", ["-e", 'tell application "Google Chrome" to quit'], {
      stdio: "ignore",
    });
    child.on("close", resolve);
    child.on("error", resolve);
  });
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
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer.`);
  }
  return parsed;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
