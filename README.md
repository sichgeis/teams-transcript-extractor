# Teams Transcript Extractor

Local Playwright helper for extracting a Teams/Stream transcript that you can already read in your browser.

## Usage

Start your default Chrome profile with a DevTools port:

```sh
task chrome:debug
```

If Chrome was already running, Chrome may ignore the debugging flag. In that case the task will now fail with a clear message; quit Chrome completely and run `task chrome:debug` again, or let the project do that with:

```sh
task chrome:debug:restart
```

Log in if needed, then extract:

```sh
task extract URL="https://..." OUT="meeting.md"
```

Or extract from the current tab:

```sh
task extract:current OUT="meeting.md"
```

The tool scrolls the transcript pane, deduplicates rows by Teams row id, and writes Markdown.

If your default Chrome profile cannot be started with DevTools enabled, use an isolated local profile:

```sh
task chrome:debug:isolated
```

## Safety Boundaries

- Uses only page content visible to the logged-in user.
- Does not call private Teams/SharePoint APIs.
- Does not inspect auth headers, scrape tokens, or save authenticated DOM snapshots.
- Logs progress and counts, not cookies, headers, profile images, or raw page HTML.

## Tests

```sh
task test
```
