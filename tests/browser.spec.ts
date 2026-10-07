/**
 * Portable browser regressions for a locally running scientific backend.
 * Normal calculation tests read actual API results; only explicitly labeled
 * failure/race scenarios intercept transport. Run with npm run test:browser.
 */
import {
  expect,
  test,
  type Download,
  type Page,
  type Response,
} from "@playwright/test";

async function downloadedText(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("The downloaded file has no readable content.");
  const decoder = new TextDecoder();
  let content = "";
  for await (const chunk of stream)
    content += decoder.decode(chunk, { stream: true });
  return content + decoder.decode();
}

function experimentResponse(page: Page, seed?: number): Promise<Response> {
  return page.waitForResponse((response) => {
    if (
      !response.url().endsWith("/api/experiment") ||
      response.status() !== 200
    )
      return false;
    return (
      seed === undefined || response.request().postDataJSON().seed === seed
    );
  });
}

async function ready(page: Page) {
  await expect(
    page.getByText("LIVE COMPUTATION", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
}

async function open(page: Page) {
  const response = experimentResponse(page);
  await page.goto("/");
  const result = await (await response).json();
  await ready(page);
  return result;
}

async function chapter(page: Page, index: number, label: string) {
  const button = page
    .getByRole("navigation", { name: "Chapters" })
    .getByRole("button", {
      name: new RegExp(`${String(index).padStart(2, "0")}.*${label}`),
    });
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "step");
}

test.beforeEach(async ({ page }) => {
  // Most behavioral tests use the complete SVG path to remove GPU variance.
  // Automatic WebGL failure is exercised separately below.
  await page.addInitScript(() =>
    localStorage.setItem("qrecall-quality", "fallback"),
  );
});

test("all eight chapters render equations and real comparison data without runtime errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const result = await open(page);
  expect(result.model.energies).toHaveLength(256);
  expect(result.quantum.counts).not.toEqual({});
  const chapters = [
    "Store",
    "Damage",
    "Recall",
    "Thermal",
    "Quantum",
    "Measure",
    "Compare",
    "Export",
  ];
  for (let index = 0; index < chapters.length; index++) {
    await chapter(page, index + 1, chapters[index]);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".katex-error")).toHaveCount(0);
  }
  await chapter(page, 7, "Compare");
  await expect(page.locator(".comparison-table tbody tr")).toHaveCount(6);
  await expect(page.locator(".comparison-table tbody")).not.toContainText(
    "Computing",
  );
  await expect(
    page.getByText("Target identity stays in the evaluator.", { exact: false }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("cue and stored-memory edits recompute the actual conditioned model", async ({
  page,
}) => {
  const initial = await open(page);
  const cueResponse = experimentResponse(page);
  await page
    .getByRole("group", { name: "Input cue", exact: true })
    .getByRole("button", { name: "Pixel 1: unknown", exact: true })
    .click();
  const cue = await (await cueResponse).json();
  await ready(page);
  expect(cue.config_hash).not.toBe(initial.config_hash);
  expect(cue.model.free_indices).not.toContain(1);
  expect(cue.model.energies).toHaveLength(128);
  expect(cue.model.trusted_indices).toContain(1);
  // Evaluation identity is never sent to the solver endpoint.
  expect(cue.config).not.toHaveProperty("target_index");
  expect(cue.config).not.toHaveProperty("target");
  const memoryResponse = experimentResponse(page);
  await page
    .getByRole("group", { name: "Stored memory 1", exact: true })
    .getByRole("button", { name: /^Pixel 0:/ })
    .click();
  const memory = await (await memoryResponse).json();
  await ready(page);
  expect(memory.model.weights).not.toEqual(cue.model.weights);
  expect(memory.model.energies).not.toEqual(cue.model.energies);
  expect(memory.model.memories[0][0]).toBe(-cue.model.memories[0][0]);
});

test("step, scrub, play, pause and reset stay synchronized with backend events", async ({
  page,
}) => {
  const result = await open(page);
  await chapter(page, 3, "Recall");
  const timeline = page.getByRole("slider", { name: "Scrub event timeline" });
  const readout = page.locator(".event-values");
  async function assertEvent(index: number) {
    const event = result.hopfield.trace[index];
    await expect(timeline).toHaveValue(String(index));
    await expect(readout.locator("span").nth(0).locator("b")).toHaveText(
      String(event.neuron),
    );
    await expect(readout.locator("span").nth(1).locator("b")).toHaveText(
      event.local_field.toFixed(3),
    );
    await expect(readout.locator("span").nth(2).locator("b")).toHaveText(
      (event.energy_after - event.energy_before).toFixed(3),
    );
  }
  await assertEvent(0);
  await page.getByRole("button", { name: "Next event", exact: true }).click();
  await assertEvent(1);
  await timeline.press("End");
  await assertEvent(result.hopfield.trace.length - 1);
  await page.getByRole("button", { name: "Reset playback" }).click();
  await assertEvent(0);
  await page
    .getByRole("combobox", { name: "Playback speed" })
    .selectOption("4");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(async () => Number(await timeline.inputValue()))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = Number(await timeline.inputValue());
  await page.waitForTimeout(400); // Longer than one 4× event interval.
  await assertEvent(paused);
  await page.getByRole("button", { name: "Previous event" }).click();
  await assertEvent(Math.max(0, paused - 1));
});

test("Play recall opens the computed Recall chapter from an interactive chapter", async ({
  page,
}) => {
  const result = await open(page);
  expect(result.hopfield.trace.length).toBeGreaterThan(1);
  await expect(page.locator(".playback-help")).toContainText(
    "Play recall opens the first computed animation",
  );
  await page.getByRole("button", { name: "Play recall", exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Chapters" })
      .getByRole("button", { name: /03.*Recall/ }),
  ).toHaveAttribute("aria-current", "step");
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  const timeline = page.getByRole("slider", { name: "Scrub event timeline" });
  await expect
    .poll(async () => Number(await timeline.inputValue()))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await timeline.inputValue();
  await page.waitForTimeout(250);
  await expect(timeline).toHaveValue(paused);
});

test("interactive chapters guard empty transport while retaining Play recall", async ({
  page,
}) => {
  await open(page);
  for (const [index, label] of [
    [1, "Store"],
    [2, "Damage"],
    [7, "Compare"],
    [8, "Export"],
  ] as const) {
    await chapter(page, index, label);
    await expect(
      page.getByRole("button", { name: "Reset playback" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Previous event" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Next event" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("slider", { name: "Scrub event timeline" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("combobox", { name: "Playback speed" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Play recall", exact: true }),
    ).toBeEnabled();
    await expect(page.locator(".timeline-caption")).toContainText(
      "INTERACTIVE CHAPTER",
    );
  }
});

test("Replay rewinds a finished trace and starts its first real event", async ({
  page,
}) => {
  const result = await open(page);
  await chapter(page, 3, "Recall");
  const timeline = page.getByRole("slider", { name: "Scrub event timeline" });
  await page
    .getByRole("combobox", { name: "Playback speed" })
    .selectOption(".5");
  await timeline.press("End");
  await expect(timeline).toHaveValue(String(result.hopfield.trace.length - 1));
  await expect(page.getByRole("button", { name: "Next event" })).toBeDisabled();
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect(timeline).toHaveValue("0");
  await expect(
    page.locator(".event-values span").first().locator("b"),
  ).toHaveText(String(result.hopfield.trace[0].neuron));
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(timeline).toHaveValue("0");
});

for (const [index, label] of [
  [1, "Store"],
  [2, "Damage"],
  [3, "Recall"],
  [4, "Thermal"],
  [5, "Quantum"],
  [6, "Measure"],
] as const) {
  test(`${label} Explain, Math and Circuit tabs expose distinct content`, async ({
    page,
  }) => {
    await open(page);
    await chapter(page, index, label);
    const inspector = page.locator(".inspector");
    const content = inspector.locator(".inspector-content");
    await inspector
      .getByRole("button", { name: "Explain", exact: true })
      .click();
    const explanation = await content.locator("h2").innerText();
    await expect(content.locator(".inspector-kicker")).not.toContainText(
      "MATHEMATICAL MODEL",
    );
    await inspector.getByRole("button", { name: "Math", exact: true }).click();
    await expect(content.locator(".inspector-kicker")).toHaveText(
      `MATHEMATICAL MODEL / CHAPTER ${index}`,
    );
    await expect(content.locator("h2")).not.toHaveText(explanation);
    await expect(content.locator(".katex")).not.toHaveCount(0);
    await expect(content.locator(".katex-error")).toHaveCount(0);
    await inspector
      .getByRole("button", { name: "Circuit", exact: true })
      .click();
    await expect(
      content.getByRole("heading", {
        name: "Inspect every gate.",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      content.getByRole("img", { name: /Actual Qiskit QAOA circuit/ }),
    ).toBeVisible();
    await expect(content.locator(".inspector-kicker")).toHaveText(
      "ACTUAL CIRCUIT / PIXEL MAPPING",
    );
    await inspector
      .getByRole("button", { name: "Explain", exact: true })
      .click();
    await expect(content.locator("h2")).toHaveText(explanation);
  });
}

test("Edit input opens the cue editor and restore/erase recompute the real model", async ({
  page,
}) => {
  const initial = await open(page);
  await chapter(page, 5, "Quantum");
  await page.getByRole("button", { name: "Edit input", exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Chapters" })
      .getByRole("button", { name: /02.*Damage/ }),
  ).toHaveAttribute("aria-current", "step");
  const editor = page.getByRole("group", {
    name: "Edit damaged cue",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await expect(page.locator(".notice-banner")).toContainText(
    "Edit input: click a pixel",
  );
  const pixel = initial.model.free_indices[0];
  const restoredResponse = experimentResponse(page);
  await editor
    .getByRole("button", { name: `Pixel ${pixel}: unknown`, exact: true })
    .click();
  const restored = await (await restoredResponse).json();
  await ready(page);
  expect(restored.config.cue[pixel]).toBe(initial.config.memories[0][pixel]);
  expect(restored.model.free_indices).not.toContain(pixel);
  expect(restored.model.trusted_indices).toContain(pixel);
  await expect(
    page.getByRole("slider", { name: "Corruption amount" }),
  ).toHaveValue(String(initial.model.free_indices.length - 1));
  const erasedResponse = experimentResponse(page);
  await editor
    .getByRole("button", { name: new RegExp(`^Pixel ${pixel}:`) })
    .click();
  const erased = await (await erasedResponse).json();
  await ready(page);
  expect(erased.config.cue).toEqual(initial.config.cue);
  expect(erased.model.free_indices).toEqual(initial.model.free_indices);
  expect(erased.model.energies).toEqual(initial.model.energies);
  await expect(
    editor.getByRole("button", {
      name: `Pixel ${pixel}: unknown`,
      exact: true,
    }),
  ).toBeVisible();
});

test("Present demo loads a verified case and starts live Recall playback", async ({
  page,
}) => {
  await open(page);
  await expect(
    page
      .getByRole("combobox", { name: "Scenario preset" })
      .locator('option[value="easy"]'),
  ).toHaveCount(1);
  const response = experimentResponse(page);
  await page.getByRole("button", { name: "Present demo", exact: true }).click();
  const demo = await (await response).json();
  await ready(page);
  await expect(page.locator(".app")).toHaveClass(/presenter/);
  await expect(
    page
      .getByRole("navigation", { name: "Chapters" })
      .getByRole("button", { name: /03.*Recall/ }),
  ).toHaveAttribute("aria-current", "step");
  expect(demo.model.free_indices).toHaveLength(6);
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  const timeline = page.getByRole("slider", { name: "Scrub event timeline" });
  await expect
    .poll(async () => Number(await timeline.inputValue()))
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Exit presentation", exact: true })
    .click();
  await expect(page.locator(".app")).not.toHaveClass(/presenter/);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
});

test("the same verified preset can be loaded again after an input edit", async ({
  page,
}) => {
  await open(page);
  const preset = page.getByRole("combobox", { name: "Scenario preset" });
  await expect(preset.locator('option[value="easy"]')).toHaveCount(1);
  const firstResponse = experimentResponse(page);
  await preset.selectOption("easy");
  const first = await (await firstResponse).json();
  await ready(page);
  await expect(preset).toHaveValue("easy");
  const modifiedResponse = experimentResponse(page, first.config.seed + 1);
  await page
    .locator('.method-control input[type="number"]')
    .first()
    .fill(String(first.config.seed + 1));
  const modified = await (await modifiedResponse).json();
  await ready(page);
  expect(modified.config_hash).not.toBe(first.config_hash);
  await expect(preset).toHaveValue("");
  const restoredResponse = experimentResponse(page, first.config.seed);
  await preset.selectOption("easy");
  const restored = await (await restoredResponse).json();
  await ready(page);
  expect(restored.config_hash).toBe(first.config_hash);
  expect(restored.config.cue).toEqual(first.config.cue);
  expect(restored.model.energies).toEqual(first.model.energies);
  await expect(preset).toHaveValue("easy");
  await expect(page.locator(".notice-banner")).toContainText(
    "Easy recall loaded",
  );
});

test("Reset cue creates a fully observed model with zero actual quantum shots", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const initial = await open(page);
  const response = experimentResponse(page);
  await page.getByRole("button", { name: "Reset cue", exact: true }).click();
  const restored = await (await response).json();
  await ready(page);
  expect(restored.config.cue).toEqual(initial.config.memories[0]);
  expect(restored.model.free_indices).toEqual([]);
  expect(restored.model.energies).toHaveLength(1);
  expect(restored.quantum.resources.qubits).toBe(0);
  expect(restored.quantum.resources.shots).toBe(0);
  expect(restored.quantum.measurement_trace).toEqual([]);
  expect(restored.quantum.output).toEqual(restored.config.cue);
  await expect(
    page.getByRole("slider", { name: "Corruption amount" }),
  ).toHaveValue("0");
  await expect(page.locator(".playback-help")).toContainText(
    "All pixels are observed",
  );
  await expect(
    page.getByRole("button", { name: "Play recall", exact: true }),
  ).toBeDisabled();
  await chapter(page, 6, "Measure");
  await expect(page.locator(".measurement-label")).toContainText(
    "0 actual circuit shots",
  );
  await expect(
    page.getByRole("slider", { name: "Scrub event timeline" }),
  ).toBeDisabled();
  await chapter(page, 7, "Compare");
  await expect(page.locator(".comparison-table tbody")).not.toContainText(
    "Computing",
  );
  await expect(page.locator(".quantum-row .resource-text")).toContainText(
    "0 shots",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("JSON export reviews actual evidence, copies content and downloads an HTTP file", async ({
  page,
  context,
}) => {
  const result = await open(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  await chapter(page, 8, "Export");
  const filename = `qrecall-seed-${result.config.seed}.json`;
  const prepared = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/exports") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Export experiment JSON", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: filename, exact: true });
  await expect(dialog).toBeVisible();
  const preview = await dialog
    .getByRole("textbox", { name: "Export content", exact: true })
    .inputValue();
  expect(preview.startsWith("{")).toBe(true);
  expect(preview.length).toBeLessThanOrEqual(20000);
  const response = await prepared;
  expect(response.status()).toBe(201);
  const fullContent = response.request().postDataJSON().content;
  expect(preview).toBe(fullContent.slice(0, 20000));
  if (fullContent.length > 20000)
    await expect(dialog).toContainText(
      "Preview shows the first 20,000 characters",
    );
  const evidence = JSON.parse(fullContent);
  expect(evidence.config.cue).toEqual(result.config.cue);
  expect(evidence.result.config_hash).toBe(result.config_hash);
  expect(evidence.result.quantum.counts).toEqual(result.quantum.counts);
  expect(evidence.result.hopfield.trace).toEqual(result.hopfield.trace);
  expect(evidence.evaluation.methods.quantum).toHaveProperty("recovery");
  const file = await response.json();
  expect(response.request().postDataJSON()).toMatchObject({
    filename,
    content: fullContent,
    media_type: "application/json",
  });
  const downloadLink = dialog.getByRole("link", {
    name: "Download file",
    exact: true,
  });
  await expect(downloadLink).toHaveAttribute("href", file.url);
  expect(file.url).toMatch(/^\/api\/exports\/[a-f0-9]+$/);
  await dialog
    .getByRole("button", { name: "Copy content", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText("Content copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    fullContent,
  );
  const httpFile = await context.request.get(
    new URL(file.url, page.url()).href,
  );
  expect(httpFile.status()).toBe(200);
  expect(httpFile.headers()["content-disposition"]).toContain(filename);
  expect(await httpFile.json()).toEqual(evidence);
  const download = page.waitForEvent("download");
  await downloadLink.click();
  const received = await download;
  expect(received.suggestedFilename()).toBe(filename);
  expect(await received.failure()).toBeNull();
  expect(JSON.parse(await downloadedText(received))).toEqual(evidence);
  await dialog
    .getByRole("button", { name: "Close export", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
});

test("recorded benchmark CSV opens a review modal before copy and HTTP download", async ({
  page,
  context,
}) => {
  const recordedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/benchmarks/recorded") &&
      response.status() === 200,
  );
  await open(page);
  const recorded = await (await recordedResponse).json();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  await chapter(page, 7, "Compare");
  await page
    .getByRole("button", { name: "Load recorded evidence", exact: true })
    .click();
  await expect(page.locator(".benchmark-results")).toContainText(
    "Recorded replay",
  );
  const prepared = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/exports") &&
      response.request().method() === "POST",
  );
  await page
    .locator(".benchmark-results")
    .getByRole("button", { name: "CSV", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "qrecall-benchmark.csv",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const preview = await dialog
    .getByRole("textbox", { name: "Export content", exact: true })
    .inputValue();
  const lines = preview.trim().split(/\r?\n/);
  expect(lines[0]).toBe(
    "case,method,recovery,bit_error_rate,energy_gap,target_probability",
  );
  let rows = 0;
  for (const [index, cue] of recorded.cases.entries()) {
    for (const [method, metrics] of Object.entries(
      cue.comparison?.methods || cue.evaluation?.methods || cue.metrics || {},
    ) as [string, any][]) {
      expect(lines).toContain(
        [
          index,
          method,
          metrics.recovery,
          metrics.bit_error_rate,
          metrics.energy_gap ?? "",
          metrics.target_probability ?? "",
        ].join(","),
      );
      rows++;
    }
  }
  expect(rows).toBeGreaterThan(0);
  expect(lines).toHaveLength(rows + 1);
  const response = await prepared;
  expect(response.status()).toBe(201);
  const file = await response.json();
  expect(response.request().postDataJSON()).toMatchObject({
    filename: "qrecall-benchmark.csv",
    content: preview,
    media_type: "text/csv",
  });
  const downloadLink = dialog.getByRole("link", {
    name: "Download file",
    exact: true,
  });
  await expect(downloadLink).toHaveAttribute("href", file.url);
  await dialog
    .getByRole("button", { name: "Copy content", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText("Content copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    preview,
  );
  const httpFile = await context.request.get(
    new URL(file.url, page.url()).href,
  );
  expect(httpFile.status()).toBe(200);
  expect(httpFile.headers()["content-type"]).toContain("text/csv");
  expect(await httpFile.text()).toBe(preview);
  const download = page.waitForEvent("download");
  await downloadLink.click();
  const received = await download;
  expect(received.suggestedFilename()).toBe("qrecall-benchmark.csv");
  expect(await received.failure()).toBeNull();
  expect(await downloadedText(received)).toBe(preview);
});

test("thermal controls change the exact reference and display a genuine seeded draw", async ({
  page,
}) => {
  const initial = await open(page);
  await chapter(page, 4, "Thermal");
  const event = initial.gibbs.trace[0];
  await expect(page.locator(".probability-labels")).toContainText(
    `P(+1) = ${event.p_plus.toFixed(3)}`,
  );
  await expect(page.locator(".probability-labels")).toContainText(
    `draw = ${event.draw.toFixed(3)}`,
  );
  const response = experimentResponse(page);
  await page
    .getByRole("slider", { name: "Temperature", exact: true })
    .press("End");
  const warm = await (await response).json();
  await ready(page);
  expect(warm.config.temperature).toBe(3);
  expect(warm.model.energies).toEqual(initial.model.energies);
  expect(warm.gibbs.exact_probabilities).not.toEqual(
    initial.gibbs.exact_probabilities,
  );
  expect(warm.gibbs.probabilities).not.toEqual(warm.gibbs.exact_probabilities);
  expect(warm.gibbs.resources.gibbs_draws).toBe(
    (warm.config.burn_in + warm.config.samples * warm.config.thinning) * 8,
  );
});

test("measurement playback uses cumulative actual shots and its modal reconstruction", async ({
  page,
}) => {
  const result = await open(page);
  await chapter(page, 6, "Measure");
  const events = result.quantum.measurement_trace;
  expect(events.length).toBeGreaterThan(1);
  const timeline = page.getByRole("slider", { name: "Scrub event timeline" });
  await expect(page.locator(".measurement-label")).toContainText(
    `${events[0].shots} actual circuit shots`,
  );
  await page.getByRole("button", { name: "Next event", exact: true }).click();
  await expect(page.locator(".measurement-label")).toContainText(
    `${events[1].shots} actual circuit shots`,
  );
  await timeline.press("End");
  await expect(page.locator(".measurement-label")).toContainText(
    `${result.config.shots} actual circuit shots`,
  );
  const reconstructed = page.getByRole("group", {
    name: "Quantum reconstructed pattern",
  });
  for (let pixel = 0; pixel < result.model.n; pixel++) {
    await expect(reconstructed.locator(".pixel").nth(pixel)).toHaveAttribute(
      "title",
      new RegExp(`spin ${result.quantum.output[pixel] === 1 ? "\\+1" : "−1"}`),
    );
  }
  expect(events.at(-1).counts).toEqual(result.quantum.counts);
});

test("the eighth-free-variable limit is explained without accepting a ninth", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("group", { name: "Input cue", exact: true })
    .getByRole("button", { name: /^Pixel 0:/ })
    .click();
  await expect(page.getByRole("alert")).toContainText("Restore a pixel first");
  await expect(page.locator(".chapter-meta")).toContainText("8 unknown pixels");
  await expect(
    page
      .getByRole("group", { name: "Input cue", exact: true })
      .getByRole("button", { name: /^Pixel 0:/ }),
  ).not.toHaveAttribute("aria-label", /unknown/);
});

test("invalid seed errors from the actual backend clear when the seed is repaired", async ({
  page,
}) => {
  await open(page);
  const seed = page.locator('.method-control input[type="number"]').first();
  await seed.fill("-1");
  await expect(page.getByRole("alert")).toContainText(
    /seed|greater than|nonnegative/i,
  );
  const response = experimentResponse(page, 43);
  await seed.fill("43");
  await response;
  await ready(page);
  await expect(page.locator(".chapter-meta")).toContainText("SEED 43");
});

test("new input ignores an older delayed solver response", async ({ page }) => {
  await open(page);
  let olderArrived = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/experiment", async (route) => {
    const input = route.request().postDataJSON();
    if (input.seed !== 31415) return route.continue();
    const response = await route.fetch();
    olderArrived = true;
    await held;
    // An aborted transport may reject fulfillment; either outcome must not
    // update the newest visible scientific result.
    await route.fulfill({ response }).catch(() => {});
  });
  const seed = page.locator('.method-control input[type="number"]').first();
  await seed.fill("31415");
  await expect.poll(() => olderArrived).toBe(true);
  const newestResponse = experimentResponse(page, 31416);
  await seed.fill("31416");
  const newest = await (await newestResponse).json();
  await ready(page);
  release();
  await chapter(page, 8, "Export");
  await expect(page.locator(".provenance")).toContainText(
    newest.config_hash.slice(0, 16),
  );
  await expect(page.locator(".provenance")).toContainText("31416");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("failed computation explains the error and retry recovers", async ({
  page,
}) => {
  let failed = false;
  await page.route("**/api/experiment", (route) => {
    if (failed) return route.continue();
    failed = true;
    // Deliberate transport fixture, not a fabricated scientific result.
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { message: "Test engine temporarily unavailable" },
      }),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "local scientific engine is unavailable",
  );
  const response = experimentResponse(page);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await response;
  await ready(page);
});

test("keyboard navigation and reduced-motion preference remain functional", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await expect(
    page.getByRole("checkbox", { name: "Reduced motion" }),
  ).toBeChecked();
  await page.locator("body").press("3");
  await expect(
    page
      .getByRole("navigation", { name: "Chapters" })
      .getByRole("button", { name: /03.*Recall/ }),
  ).toHaveAttribute("aria-current", "step");
  await page.locator("body").press("ArrowRight");
  await expect(
    page.getByRole("slider", { name: "Scrub event timeline" }),
  ).toHaveValue("1");
  await page.locator("body").press("ArrowLeft");
  await expect(
    page.getByRole("slider", { name: "Scrub event timeline" }),
  ).toHaveValue("0");
  await page.getByRole("button", { name: "About the science" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator("body").press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("functional fallback shows energies and circuit probabilities on a narrow screen", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(
    page.getByRole("img", { name: "Stored memory weighted neuron network" }),
  ).toBeVisible();
  await chapter(page, 3, "Recall");
  await expect(
    page.getByRole("img", { name: "Exact discrete state energies" }),
  ).toBeVisible();
  await chapter(page, 5, "Quantum");
  await expect(
    page.getByRole("img", { name: "Quantum probabilities in 2D" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Actual Qiskit QAOA circuit/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  await page.screenshot({
    path: testInfo.outputPath("mobile-quantum.png"),
    fullPage: true,
  });
});

test("2D, Low and High quality switches can return to a live canvas after disposal", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  const quality = page.getByRole("combobox", {
    name: "Rendering quality",
    exact: true,
  });
  const canvas = page.locator(".scene-canvas canvas");
  await expect(quality).toHaveValue("fallback");
  await expect(canvas).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "Stored memory weighted neuron network" }),
  ).toBeVisible();
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const setting of ["low", "high"]) {
      await quality.selectOption(setting);
      await expect(quality).toHaveValue(setting);
      await expect(canvas).toHaveCount(1);
      await expect
        .poll(async () =>
          page
            .locator(".scene-canvas canvas")
            .evaluate((element: HTMLCanvasElement) => {
              const context = element.getContext("webgl2");
              return !!context && !context.isContextLost();
            }),
        )
        .toBe(true);
      // The previous canvas is deliberately disposed after 500 ms. It must
      // not mark the newly selected renderer as failed.
      await page.waitForTimeout(650);
      await expect(canvas).toHaveCount(1);
    }
    if (cycle === 0) {
      await quality.selectOption("fallback");
      await expect(canvas).toHaveCount(0);
      await expect(
        page.getByRole("img", {
          name: "Stored memory weighted neuron network",
        }),
      ).toBeVisible();
    }
  }
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("unavailable WebGL automatically falls back to the same usable SVG model", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("qrecall-quality", "high");
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: any[]
    ) {
      if (String(args[0]).startsWith("webgl")) return null;
      return original.apply(this, args as any);
    } as typeof original;
  });
  await open(page);
  await expect(
    page.getByRole("img", { name: "Stored memory weighted neuron network" }),
  ).toBeVisible();
  await chapter(page, 3, "Recall");
  await page.getByRole("button", { name: "Next event", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "Scrub event timeline" }),
  ).toHaveValue("1");
  await expect(
    page.getByRole("img", { name: "Exact discrete state energies" }),
  ).toBeVisible();
});

test("optimization can be cancelled through its actual backend job", async ({
  page,
}) => {
  await open(page);
  await chapter(page, 5, "Quantum");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/jobs") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Optimize angles", exact: true })
    .click();
  const job = await (await created).json();
  await expect(page.locator(".job-banner")).toContainText(
    "Optimizing ideal expected energy",
  );
  const cancelled = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/jobs/${job.id}`) &&
      response.request().method() === "DELETE",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const cancellation = await (await cancelled).json();
  expect(["cancelled", "completed"]).toContain(cancellation.status);
  await expect(page.locator(".job-banner")).toContainText(
    /cancelled|completed/,
  );
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.locator(".job-banner")).toHaveCount(0);
});

test("a late optimization-start response cannot attach to a changed configuration", async ({
  page,
}) => {
  await open(page);
  await chapter(page, 5, "Quantum");
  let returned = false;
  let jobId = "";
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    jobId = (await response.json()).id;
    returned = true;
    await held;
    await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Optimize angles", exact: true })
    .click();
  await expect.poll(() => returned).toBe(true);
  const recomputed = experimentResponse(page);
  await page
    .getByRole("group", { name: "Input cue", exact: true })
    .getByRole("button", { name: "Pixel 1: unknown", exact: true })
    .click();
  await recomputed;
  await ready(page);
  const discarded = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/jobs/${jobId}`) &&
      request.method() === "DELETE",
  );
  release();
  await discarded;
  await expect(page.locator(".job-banner")).toHaveCount(0);
  await expect(page.locator(".angle-row input").first()).toHaveValue("0.7");
});
