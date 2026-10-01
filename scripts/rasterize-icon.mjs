import { readFileSync, writeFileSync } from "node:fs";
import { launch } from "./verify/drv.mjs";

const svg = readFileSync(new URL("../app/public/icon.svg", import.meta.url), "utf8");
const page = await launch({ url: "data:image/svg+xml," + encodeURIComponent(svg) });
try {
  await page.send("Emulation.setDeviceMetricsOverride", { width: 512, height: 512, deviceScaleFactor: 1, mobile: false });
  await page.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  const screenshot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(new URL("../app/public/store/logo.png", import.meta.url), Buffer.from(screenshot.data, "base64"));
} finally { await page.close(); }
