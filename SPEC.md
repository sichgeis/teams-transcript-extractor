# Teams Transcript Extractor Spec

## Goal

Provide a low-friction Tampermonkey userscript that copies a Teams/Stream transcript to Markdown when the user can already view the transcript in the browser.

## Scope

- Extract only rendered transcript DOM rows.
- Scroll the transcript pane to collect virtualized rows.
- Deduplicate rows by stable row id or ARIA position.
- Auto-open the transcript panel when a visible Transcript button is available.
- Copy Markdown to the clipboard and keep manual copy/download buttons after extraction.
- Download a `.md` file automatically when clipboard access is blocked.

## Out Of Scope

- Private API calls.
- Cookie, token, header, local storage, or session storage inspection.
- Network replay.
- Access-control bypass.
- Automatic upload or sync of transcript contents.

## Success Criteria

- The floating panel appears on supported pages so users can tell the script is running.
- Clicking `Extract transcript` opens the transcript panel if needed.
- Extraction reports progress while scrolling.
- Output contains title, source URL, extraction timestamp, collected count, and transcript rows.
- Browser clipboard failures download a `.md` fallback and leave visible retry/download buttons.
- Downloaded filenames are generic timestamped names and do not include meeting titles.

## Known Risks

- Microsoft may change Teams/Stream transcript DOM attributes.
- Very long transcripts can take time because scrolling waits for virtualized rendering.
- Browser or managed-device policy may block Tampermonkey, require extension developer mode, require an explicit "allow user scripts" toggle, or block clipboard access.
