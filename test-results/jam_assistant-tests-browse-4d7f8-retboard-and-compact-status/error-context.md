# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: jam_assistant/tests/browser/mp3-benchmark.spec.ts >> fills a mobile landscape viewport with the fretboard and compact status
- Location: jam_assistant/tests/browser/mp3-benchmark.spec.ts:136:1

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
  38  |   await expect(page.locator(".chord-details strong").nth(1)).toHaveText("Major");
  39  |   await expect(page.locator(".fret-row")).toHaveCount(6);
  40  |   await expect(page.locator(".fret-row").first()).toHaveAttribute("data-string-index", "5");
  41  |   await expect(page.locator(".fret-row").last()).toHaveAttribute("data-string-index", "0");
  42  |   await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(24);
  43  |   await expect(page.locator(".fret-labels")).not.toContainText("OPEN");
  44  |   await expect(page.locator(".fret-cell > span")).toHaveCount(144);
  45  |   await expect(page.locator(".fret-cell > span").filter({ hasText: /.+/ })).toHaveCount(144);
  46  |   await expect(page.locator(".role-root").first()).toBeVisible();
  47  |   await expect(page.locator(".role-chord-tone").first()).toBeVisible();
  48  |   await expect(page.locator(".role-root span").first()).toHaveCSS("border-color", "rgb(255, 138, 61)");
  49  |   await expect(page.locator(".role-chord-tone span").first()).toHaveCSS("border-color", "rgb(255, 228, 92)");
  50  |   await expect(page.locator("#scale")).toHaveCount(0);
  51  | 
  52  |   const firstFretX = (await page.locator(".fret-row").first().locator(".fret-cell").first().boundingBox())?.x;
  53  |   const firstFretWidth = (await page.locator(".fret-row").first().locator(".fret-cell").first().boundingBox())?.width ?? 0;
  54  |   const lastFretWidth = (await page.locator(".fret-row").first().locator(".fret-cell").last().boundingBox())?.width ?? 0;
  55  |   expect(firstFretWidth).toBeGreaterThan(lastFretWidth * 2);
  56  |   expect(firstFretWidth).toBeLessThan(lastFretWidth * 2.6);
  57  |   await page.getByRole("button", { name: "Zoom in" }).click();
  58  |   await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(16);
  59  |   expect((await page.locator(".fret-row").first().locator(".fret-cell").first().boundingBox())?.x).toBeCloseTo(firstFretX ?? 0, 0);
  60  |   await page.getByRole("button", { name: "Next fret", exact: true }).click();
  61  |   await expect(page.locator(".fret-labels span:not(.string-label)")).toHaveText(
  62  |     Array.from({ length: 16 }, (_, index) => String(index + 2)),
  63  |   );
  64  |   await expect(page.getByText("2–17 / 24")).toBeVisible();
  65  |   await page.getByRole("button", { name: "Previous fret", exact: true }).click();
  66  |   await page.getByRole("button", { name: "Zoom out" }).click();
  67  |   await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(24);
  68  | 
  69  |   const playAudio = page.getByLabel("Play audio");
  70  |   await playAudio.check();
  71  |   await expect(playAudio).toBeChecked();
  72  |   await expect(page.locator("audio")).toHaveJSProperty("muted", false);
  73  |   const playTimeline = page.getByRole("button", { name: "Play timeline" });
  74  |   await playTimeline.click();
  75  |   await expect(page.locator("audio")).toHaveJSProperty("paused", false);
  76  |   await page.getByRole("button", { name: "Pause timeline" }).click();
  77  |   await expect(page.locator("audio")).toHaveJSProperty("paused", true);
  78  |   await playAudio.uncheck();
  79  |   await expect(page.locator("audio")).toHaveJSProperty("muted", true);
  80  | });
  81  | 
  82  | test("shows chord names and seeks when a marker is clicked", async ({ page }) => {
  83  |   const fixturePath = fileURLToPath(
  84  |     new URL("../fixtures/c-major-d-minor.wav", import.meta.url),
  85  |   );
  86  |   await page.goto("/");
  87  |   await page.locator('input[type="file"]').setInputFiles(fixturePath);
  88  | 
  89  |   const markers = page.locator(".chord-marker");
  90  |   await expect.poll(() => markers.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  91  |   await expect(markers.nth(0)).toContainText("C");
  92  |   const dMinorMarker = page.getByRole("button", { name: "Seek to Dm" });
  93  |   await expect(dMinorMarker).toBeVisible();
  94  |   await dMinorMarker.click();
  95  |   await expect(page.locator(".chord-symbol")).toHaveText("Dm");
  96  | });
  97  | 
  98  | test("latches the fretboard while the current chord continues changing", async ({ page }) => {
  99  |   const fixturePath = fileURLToPath(
  100 |     new URL("../fixtures/c-major-d-minor.wav", import.meta.url),
  101 |   );
  102 |   await page.goto("/");
  103 |   await page.locator('input[type="file"]').setInputFiles(fixturePath);
  104 | 
  105 |   await expect(page.locator(".chord-symbol")).toHaveText("C");
  106 |   const latch = page.getByRole("button", { name: "Latch" });
  107 |   const rootNotes = page.locator(".role-root");
  108 |   const rootTitles = await rootNotes.evaluateAll((notes) =>
  109 |     notes.map((note) => note.getAttribute("title")),
  110 |   );
  111 |   await latch.click();
  112 |   await expect(page.getByRole("button", { name: "Latched" })).toHaveAttribute("aria-pressed", "true");
  113 | 
  114 |   await page.getByRole("button", { name: "Seek to Dm" }).click();
  115 |   await expect(page.locator(".chord-symbol")).toHaveText("Dm");
  116 |   await expect.poll(() => rootNotes.evaluateAll((notes) =>
  117 |     notes.map((note) => note.getAttribute("title")),
  118 |   )).toEqual(rootTitles);
  119 | 
  120 |   await page.getByRole("button", { name: "Latched" }).click();
  121 |   await expect(page.getByRole("button", { name: "Latch" })).toHaveAttribute("aria-pressed", "false");
  122 |   await expect.poll(() => rootNotes.evaluateAll((notes) =>
  123 |     notes.map((note) => note.getAttribute("title")),
  124 |   )).not.toEqual(rootTitles);
  125 | });
  126 | 
  127 | test("keeps the fretboard surface usable on mobile", async ({ page }) => {
  128 |   await page.setViewportSize({ width: 390, height: 844 });
  129 |   await page.goto("/");
  130 |   await expect(page.locator('input[type="file"]')).toBeVisible();
  131 |   await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL("../fixtures/c-major.wav", import.meta.url)));
  132 |   await expect(page.getByLabel("Guitar fretboard visualization")).toBeVisible({ timeout: 10_000 });
  133 |   await expect(page.getByLabel("Analysis timeline")).toBeEnabled();
  134 | });
  135 | 
  136 | test("fills a mobile landscape viewport with the fretboard and compact status", async ({ page }) => {
  137 |   await page.setViewportSize({ width: 390, height: 844 });
> 138 |   await page.goto("/");
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  139 |   await page.locator('input[type="file"]').setInputFiles(
  140 |     fileURLToPath(new URL("../fixtures/c-major.wav", import.meta.url)),
  141 |   );
  142 |   await expect(page.locator(".chord-symbol")).toBeVisible({ timeout: 10_000 });
  143 |   await page.getByRole("button", { name: "Zoom in" }).click();
  144 |   await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(16);
  145 |   await page.setViewportSize({ width: 844, height: 390 });
  146 | 
  147 |   const panel = page.locator(".fretboard-panel");
  148 |   await expect(page.getByLabel("Guitar fretboard visualization")).toBeVisible({ timeout: 10_000 });
  149 |   await expect(page.locator(".control-strip")).toBeHidden();
  150 |   await expect(page.locator(".analysis-grid")).toBeHidden();
  151 |   await expect(page.locator(".landscape-status")).toBeVisible();
  152 |   await expect(page.locator(".landscape-status strong")).toHaveText("C / --");
  153 |   await expect(page.locator(".fret-row")).toHaveCount(6);
  154 |   await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(24);
  155 |   await expect.poll(async () => {
  156 |     const box = await panel.boundingBox();
  157 |     return box === null ? null : [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
  158 |   }).toEqual([0, 0, 844, 390]);
  159 |   await page.setViewportSize({ width: 390, height: 844 });
  160 |   await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(16);
  161 | });
  162 | 
  163 | test("starts and stops microphone mode without a playback timeline", async ({ page }) => {
  164 |   await page.goto("/");
  165 |   await page.getByRole("button", { name: "Microphone" }).click();
  166 |   await expect(page.getByText("Listening")).toBeVisible({ timeout: 10_000 });
  167 |   await expect(page.getByText("Analysis timeline")).toHaveCount(0);
  168 |   await expect(page.getByLabel("Guitar fretboard visualization")).toBeVisible();
  169 |   await page.getByRole("button", { name: "Stop" }).click();
  170 |   await expect(page.getByText("Microphone stopped")).toBeVisible();
  171 | });
  172 | 
  173 | test("merges live microphone heat with chord outlines", async ({ page }) => {
  174 |   await page.goto("/");
  175 |   await page.getByRole("button", { name: "Microphone" }).click();
  176 |   await expect(page.getByText("Listening")).toBeVisible({ timeout: 10_000 });
  177 | 
  178 |   await expect(page.getByLabel("FFT window")).not.toBeVisible();
  179 |   await page.getByText("Options", { exact: true }).click();
  180 |   await expect(page.getByLabel("FFT window")).toHaveValue("2");
  181 |   await expect(page.getByLabel("Accumulation time")).toHaveValue("0.2");
  182 |   await expect(page.getByLabel("Fade time")).toHaveValue("0.2");
  183 |   await expect(page.getByRole("slider", { name: "Log response" })).toHaveValue("0.1");
  184 |   await page.getByLabel("FFT window").fill("1");
  185 |   await page.getByLabel("Accumulation time").fill("0.1");
  186 |   await page.getByLabel("Fade time").fill("10");
  187 |   await page.getByRole("slider", { name: "Log response" }).fill("1");
  188 |   await expect(page.getByText("43 ms")).toBeVisible();
  189 |   await expect(page.getByText("0.1 s")).toBeVisible();
  190 |   await expect(page.getByText("10.0 s")).toBeVisible();
  191 |   await expect(page.getByText("1.0", { exact: true })).toBeVisible();
  192 |   await expect(page.locator(".fretboard .fret-cell")).toHaveCount(144);
  193 |   await expect.poll(async () => {
  194 |     const strengths = await page.locator(".fretboard .fret-cell").evaluateAll(
  195 |       (cells) => cells.map((cell) => Number((cell as HTMLElement).dataset.strength ?? 0)),
  196 |     );
  197 |     return Math.max(...strengths);
  198 |   }, { timeout: 10_000 }).toBeGreaterThan(0.05);
  199 |   await expect.poll(async () => {
  200 |     const values = await page.locator(".fretboard .fret-cell").evaluateAll(
  201 |       (cells) => cells.map((cell) => ({
  202 |         strength: Number((cell as HTMLElement).dataset.strength ?? 0),
  203 |         opacity: Number((cell as HTMLElement).dataset.opacity ?? 0),
  204 |       })),
  205 |     );
  206 |     return values.some((value) => value.strength > 0 && value.opacity > value.strength);
  207 |   }).toBe(true);
  208 |   await expect.poll(async () =>
  209 |     page.locator(".landscape-status strong").textContent(),
  210 |   { timeout: 10_000 }).not.toMatch(/\/ --$/);
  211 | });
  212 | 
```