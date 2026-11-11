import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFileBrowser } from "./file-browser.js";

let root: string;
let server: Server;
let port: number;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "alesis-browse-"));
  await mkdir(join(root, "jams", "nested"), { recursive: true });
  await mkdir(join(root, "outside"));
  await writeFile(join(root, "outside", "secret.txt"), "top secret");
  await writeFile(join(root, "jams", "one.mp3"), Buffer.from("0123456789"));
  await writeFile(join(root, "jams", "one.mid"), "MThd");
  await writeFile(join(root, "jams", "<b>x.json"), "{}");
  await writeFile(join(root, "jams", "page.html"), "<script>alert(1)</script>");
  await writeFile(join(root, "jams", ".hidden"), "no");
  await writeFile(join(root, "jams", "half.mp3.part"), "no");
  await writeFile(join(root, "jams", "nested", "deep.txt"), "deep");
  await symlink(join(root, "outside"), join(root, "jams", "escape"));
  await symlink(join(root, "outside", "secret.txt"), join(root, "jams", "link.txt"));
  const browser = createFileBrowser([
    { id: "jams", label: "Jams <&>", directory: join(root, "jams") },
    { id: "missing", label: "Missing", directory: join(root, "does-not-exist") },
  ]);
  server = createServer((req, res) => { if (browser.matches(req.url)) void browser.handle(req, res); else res.writeHead(404).end("app"); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => { server.close(); await rm(root, { recursive: true, force: true }); });

const get = (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual", ...init });

describe("file browser", () => {
  it("lists the configured folders, escaping their names", async () => {
    const response = await get("/files/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    const html = await response.text();
    expect(html).toContain("Jams &lt;&amp;&gt;");
    expect(html).toContain('href="/files/jams/"');
    expect((await get("/files")).status).toBe(302);
  });

  it("lists a folder with names escaped, hiding dotfiles, partial files and symlinks", async () => {
    const html = await (await get("/files/jams/")).text();
    expect(html).toContain("one.mp3");
    expect(html).toContain("nested/");
    expect(html).toContain("&lt;b&gt;x.json");
    expect(html).not.toContain("<b>x");
    expect(html).not.toMatch(/\.hidden|half\.mp3\.part|escape|link\.txt/);
    expect(html).toContain('<audio controls preload="none" src="/files/jams/one.mp3">');
    expect((await get("/files/jams/?sort=time")).status).toBe(200);
    expect(await (await get("/files/jams/nested/")).text()).toContain("deep.txt");
  });

  it("serves files with ranges, as downloads on request, and never as active content", async () => {
    const whole = await get("/files/jams/one.mp3");
    expect(whole.headers.get("content-type")).toBe("audio/mpeg");
    expect(whole.headers.get("content-disposition")).toBeNull();
    expect(await whole.text()).toBe("0123456789");
    const part = await get("/files/jams/one.mp3", { headers: { range: "bytes=2-4" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(await part.text()).toBe("234");
    expect((await get("/files/jams/one.mp3", { headers: { range: "bytes=50-" } })).status).toBe(416);
    const download = await get("/files/jams/one.mid?download=1");
    expect(download.headers.get("content-disposition")).toBe('attachment; filename="one.mid"');
    const html = await get("/files/jams/page.html");
    expect(html.headers.get("content-type")).toBe("application/octet-stream");
    expect(html.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await get("/files/jams/one.mp3", { method: "HEAD" })).headers.get("content-length")).toBe("10");
  });

  it("refuses traversal, symlink escapes, unknown roots, hidden files and writes", async () => {
    for (const path of ["/files/jams/..%2foutside/secret.txt", "/files/jams/../outside/secret.txt", "/files/jams/%2e%2e/outside", "/files/jams/escape/secret.txt", "/files/jams/link.txt", "/files/jams/.hidden", "/files/jams/half.mp3.part", "/files/nowhere/", "/files/jams//one.mp3", "/files/jams/%00", "/files/jams/%E0%A4%A", "/files/jams/a%5Cb"]) {
      expect((await get(path)).status, path).toBe(404);
    }
    expect((await get("/files/jams/one.mp3", { method: "POST", body: "x" })).status).toBe(405);
    expect((await get("/files/jams/one.mp3", { method: "DELETE" })).status).toBe(405);
  });

  it("shows an empty message for a folder that does not exist yet", async () => {
    const response = await get("/files/missing/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Nothing saved here yet");
    expect((await get("/files/missing/x.txt")).status).toBe(404);
  });

  it("leaves other URLs to the app", async () => {
    expect((await get("/filesystem")).status).toBe(404);
    expect(await (await get("/filesystem")).text()).toBe("app");
  });
});
