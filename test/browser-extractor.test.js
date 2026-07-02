import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { extractTranscriptFromPage } from "../src/browser-extractor.js";

test("scrolls a virtualized transcript container until all rows are collected", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.setContent(virtualizedTranscriptPage({ total: 42, windowSize: 7 }));
    const result = await extractTranscriptFromPage(page, {
      delayMs: 10,
      maxIdleRounds: 3,
      debug: false,
    });

    assert.equal(result.expectedTotal, 42);
    assert.equal(result.rows.length, 42);
    assert.equal(result.rows[0].id, 0);
    assert.equal(result.rows.at(-1).id, 41);
    assert.equal(result.rows[5].speaker, "Speaker 1");
  } finally {
    await browser.close();
  }
});

test("returns an incomplete result when virtualized scrolling stalls", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.setContent(virtualizedTranscriptPage({ total: 20, windowSize: 5, stallAfter: 8 }));
    const result = await extractTranscriptFromPage(page, {
      delayMs: 10,
      maxIdleRounds: 2,
      debug: false,
    });

    assert.equal(result.expectedTotal, 20);
    assert.ok(result.rows.length < 20);
  } finally {
    await browser.close();
  }
});

function virtualizedTranscriptPage({ total, windowSize, stallAfter = null }) {
  return `<!doctype html>
  <html>
    <body>
      <button role="menuitem" aria-label="Transcript">Transcript</button>
      <div id="scroll-container" style="height: 210px; overflow-y: auto; border: 1px solid black;">
        <div id="spacer" style="height: ${total * 30}px; position: relative;"></div>
      </div>
      <script>
        const total = ${total};
        const windowSize = ${windowSize};
        const stallAfter = ${JSON.stringify(stallAfter)};
        const container = document.getElementById("scroll-container");
        const spacer = document.getElementById("spacer");

        function render() {
          const rawStart = Math.floor(container.scrollTop / 30);
          const start = stallAfter === null ? rawStart : Math.min(rawStart, stallAfter);
          spacer.innerHTML = "";
          for (let offset = 0; offset < windowSize && start + offset < total; offset += 1) {
            const id = start + offset;
            const row = document.createElement("div");
            row.setAttribute("role", "presentation");
            row.style.position = "absolute";
            row.style.top = (id * 30) + "px";
            row.style.height = "30px";
            row.innerHTML = \`
              <div id="itemHeader-\${id}">
                <span class="itemDisplayName-test">Speaker \${id % 2}</span>
                <span id="Header-timestamp-\${id}">0:\${String(id).padStart(2, "0")}</span>
              </div>
              <div id="sub-entry-\${id}" aria-setsize="\${total}" aria-posinset="\${id + 1}">Text \${id}</div>
            \`;
            spacer.appendChild(row);
          }
        }

        container.addEventListener("scroll", render);
        render();
      </script>
    </body>
  </html>`;
}
