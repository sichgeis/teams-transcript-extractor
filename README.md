# Teams Transcript Extractor

Tampermonkey userscript that adds a small `Extract transcript` button to Teams, Stream, SharePoint, and Office recording pages. It extracts transcript rows that are already visible to you in the browser by scrolling the transcript pane, deduplicates virtualized rows, formats Markdown, and copies it to your clipboard. If clipboard access is blocked, it falls back to a local `.md` download.

The script does not call private APIs, inspect cookies, read browser storage, replay network requests, or bypass access controls.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open the raw userscript URL: [teams-transcript-extractor.user.js](https://raw.githubusercontent.com/sichgeis/teams-transcript-extractor/main/teams-transcript-extractor.user.js).
3. Tampermonkey should offer to install it. Confirm the installation.

If Tampermonkey does not open automatically, create a new script in the Tampermonkey dashboard and paste in the contents of [`teams-transcript-extractor.user.js`](./teams-transcript-extractor.user.js).

## Use

1. Open a Teams/Stream recording page where you can access the transcript.
2. The userscript shows a small panel in the bottom-right corner when it runs on a supported page.
3. Click `Extract transcript`.
4. If the transcript panel is not open yet and the script finds a Transcript button, it opens the panel automatically.
5. Wait while it scrolls through the virtualized transcript list.
6. Paste the copied Markdown wherever you need it.

If automatic clipboard copy is blocked by the browser, the script downloads a `.md` file automatically. After extraction, the panel also keeps `Copy Markdown` and `Download .md` buttons available.

## Supported Pages

The userscript currently matches:

- `https://*.sharepoint.com/*`
- `https://*.office.com/*`
- `https://*.microsoft365.com/*`
- `https://*.cloud.microsoft/*`
- `https://*.microsoftstream.com/*`
- `https://teams.microsoft.com/*`
- `https://teams.live.com/*`

## Limitations

- The transcript DOM must be present in the page or openable through a visible Transcript button.
- If no panel appears at all, the current page URL is probably not matched by the userscript or Tampermonkey is not running on that site.
- Teams and Stream use virtualized lists, so extraction can take a little while for long transcripts.
- If Microsoft changes the transcript DOM shape, selectors may need to be adjusted.
- Local transcript copies may still be governed by company or meeting policy. Use this only for transcripts you are allowed to access and retain.

## Development

Run the focused helper tests with:

```sh
npm test
```

Run the syntax/lint check with:

```sh
npm run lint
```

The installable artifact is the single userscript file:

```text
teams-transcript-extractor.user.js
```

Behavioral boundaries are captured in [`SPEC.md`](./SPEC.md).
