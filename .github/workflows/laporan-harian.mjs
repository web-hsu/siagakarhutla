import { chromium } from "playwright";
import fs from "node:fs/promises";

const { URL_DASHBOARD, URL_GAS, LAPORAN_TOKEN } = process.env;
for (const [k, v] of Object.entries({ URL_DASHBOARD, URL_GAS, LAPORAN_TOKEN })) {
  if (!v) throw new Error(`Secret/env ${k} belum diisi`);
}

const tanggal = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Makassar" }).format(new Date());

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  locale: "id-ID",
  timezoneId: "Asia/Makassar",
  acceptDownloads: true,
});
const page = await ctx.newPage();
page.on("dialog", (d) => { console.log("Dialog web:", d.message()); d.dismiss(); });
page.on("pageerror", (e) => console.log("Error halaman:", e.message));

await page.goto(URL_DASHBOARD, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForSelector(".jpg-btn", { timeout: 60_000 });
await page.waitForFunction(() => typeof html2canvas !== "undefined" && !!window.jspdf, null, { timeout: 60_000 });
await page.waitForSelector(".leaflet-tile-loaded", { timeout: 60_000 }).catch(() => console.log("Peta belum terlihat, lanjut."));
await page.waitForTimeout(20_000);

async function ambil(selector, mime) {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 180_000 }),
    page.click(selector),
  ]);
  const buf = await fs.readFile(await dl.path());
  console.log(`Diunduh: ${dl.suggestedFilename()} (${(buf.length / 1e6).toFixed(2)} MB)`);
  return { nama: dl.suggestedFilename(), mime, base64: buf.toString("base64") };
}

const jpg = await ambil(".jpg-btn", "image/jpeg");
await page.waitForTimeout(8_000);
const pdf = await ambil(".pdf-btn", "application/pdf");
await browser.close();

const res = await fetch(URL_GAS, {
  method: "POST",
  headers: { "Content-Type": "text/plain;charset=utf-8" },
  body: JSON.stringify({ aksi: "laporanHarian", token: LAPORAN_TOKEN, tanggal, file: [jpg, pdf] }),
});
const teks = await res.text();
let hasil;
try { hasil = JSON.parse(teks); } catch { throw new Error("Respons Apps Script bukan JSON: " + teks.slice(0, 300)); }
console.log("Hasil:", hasil);
if (hasil.status !== "success") throw new Error(hasil.message || hasil.__error || "Gagal mengirim email");
