import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join, sep } from "node:path";

export interface BrowseRoot {
  id: string;
  label: string;
  directory: string;
}

export interface ServedFile {
  path: string;
  name: string;
  type?: string;
  attachment?: boolean;
}

const contentTypes: Record<string, string> = {
  ".mp3": "audio/mpeg", ".mid": "audio/midi", ".midi": "audio/midi", ".wav": "audio/wav",
  ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".log": "text/plain; charset=utf-8",
};
const MAX_ENTRIES = 2_000;

/** Streams a file with byte ranges, so audio can be previewed, seeked and resumed. */
export async function serveFile(request: IncomingMessage, response: ServerResponse, file: ServedFile): Promise<void> {
  try {
    const { size } = await stat(file.path);
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
    let start = 0;
    let end = size - 1;
    if (range && (range[1] || range[2])) {
      if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
      else start = Math.max(0, size - Number(range[2]));
      if (start > end || start >= size) { response.writeHead(416, { "content-range": `bytes */${size}` }).end(); return; }
    }
    const partial = range !== null && (start !== 0 || end !== size - 1);
    const safeName = file.name.replace(/[^A-Za-z0-9 _.-]/g, "-");
    response.writeHead(partial ? 206 : 200, {
      "content-type": file.type ?? contentTypes[extname(file.name).toLowerCase()] ?? "application/octet-stream",
      "content-length": Math.max(0, end - start + 1),
      "accept-ranges": "bytes",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      ...file.attachment ? { "content-disposition": `attachment; filename="${safeName}"` } : {},
      ...partial ? { "content-range": `bytes ${start}-${end}/${size}` } : {},
    });
    if (request.method === "HEAD" || size === 0) { response.end(); return; }
    const stream = createReadStream(file.path, { start, end });
    stream.on("error", () => response.destroy());
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  } catch {
    if (!response.headersSent) response.writeHead(404).end();
    else response.destroy();
  }
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const hidden = (name: string): boolean => name.startsWith(".") || name.endsWith(".tmp") || name.endsWith(".part");
const formatSize = (bytes: number): string => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
const formatTime = (date: Date): string => {
  const two = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
};
const href = (segments: string[]): string => `/files/${segments.map(encodeURIComponent).join("/")}`;

const page = (title: string, body: string): string => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - Alesis files</title><style>
body{margin:0;padding:16px 20px;background:#000;color:#bfe;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace}
a{color:#4df;text-decoration:none}a:hover{text-decoration:underline}
h1{font-size:16px;margin:0 0 4px;color:#fff}nav{margin:0 0 14px;color:#789}
table{width:100%;max-width:900px;border-collapse:collapse}td,th{padding:5px 10px 5px 0;text-align:left;border-bottom:1px solid #123;vertical-align:middle}
th{color:#789;font-weight:normal}.size,.time{color:#789;white-space:nowrap}.empty{color:#789}audio{height:28px;width:220px}
</style></head><body>${body}</body></html>`;

/** A read-only view of the host's saved files; only the listed folders are reachable, and nothing is ever written. */
export function createFileBrowser(roots: readonly BrowseRoot[]): { matches(url: string | undefined): boolean; handle(request: IncomingMessage, response: ServerResponse): Promise<void> } {
  const send = (response: ServerResponse, status: number, html: string, head: boolean): void => {
    response.writeHead(status, {
      "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; media-src 'self'",
    });
    response.end(head ? undefined : html);
  };
  const notFound = (response: ServerResponse, head: boolean): void => send(response, 404, page("Not found", `<h1>Not found</h1><nav><a href="/files/">All folders</a></nav>`), head);

  return {
    matches: (url) => url === "/files" || url?.startsWith("/files/") === true || url?.startsWith("/files?") === true,
    async handle(request, response) {
      const head = request.method === "HEAD";
      if (request.method !== "GET" && !head) { response.writeHead(405, { allow: "GET, HEAD" }).end(); return; }
      try {
        const url = new URL(request.url ?? "/", "http://host");
        if (url.pathname === "/files") { response.writeHead(302, { location: "/files/" }).end(); return; }
        const parts = url.pathname.slice("/files/".length).split("/");
        if (parts.at(-1) === "") parts.pop();
        let segments: string[];
        try { segments = parts.map(decodeURIComponent); } catch { notFound(response, head); return; }
        if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || /[\\/\0]/.test(segment) || hidden(segment))) { notFound(response, head); return; }

        if (segments.length === 0) {
          const rows = roots.map((root) => `<tr><td><a href="${href([root.id])}/">${escapeHtml(root.label)}</a></td></tr>`).join("");
          send(response, 200, page("Saved files", `<h1>Saved files</h1><nav><a href="/">Back to the app</a> · read-only</nav><table>${rows}</table>`), head);
          return;
        }
        const root = roots.find(({ id }) => id === segments[0]);
        if (!root) { notFound(response, head); return; }
        const base = await realpath(root.directory).catch(() => null);
        const relative = segments.slice(1);
        const target = base ? await realpath(join(base, ...relative)).catch(() => null) : null;
        const inside = target !== null && base !== null && (target === base || target.startsWith(base + sep));
        if (!base && relative.length === 0) {
          send(response, 200, page(root.label, `<h1>${escapeHtml(root.label)}</h1><nav><a href="/files/">All folders</a></nav><p class="empty">Nothing saved here yet.</p>`), head);
          return;
        }
        if (!inside) { notFound(response, head); return; }
        const info = await stat(target);
        if (info.isFile()) {
          await serveFile(request, response, { path: target, name: basename(target), attachment: url.searchParams.has("download") });
          return;
        }
        if (!info.isDirectory()) { notFound(response, head); return; }

        const newest = url.searchParams.get("sort") === "time";
        const entries: Array<{ name: string; directory: boolean; size: number; modified: Date }> = [];
        for (const name of await readdir(target)) {
          if (hidden(name)) continue;
          const entry = await lstat(join(target, name)).catch(() => null);
          if (!entry || entry.isSymbolicLink() || !(entry.isFile() || entry.isDirectory())) continue;
          entries.push({ name, directory: entry.isDirectory(), size: entry.size, modified: entry.mtime });
        }
        entries.sort((left, right) => newest ? right.modified.getTime() - left.modified.getTime() : Number(right.directory) - Number(left.directory) || left.name.localeCompare(right.name));
        const shown = entries.slice(0, MAX_ENTRIES);
        const crumbs = [`<a href="/files/">All folders</a>`, ...segments.map((segment, index) => index === segments.length - 1 ? escapeHtml(index === 0 ? root.label : segment) : `<a href="${href(segments.slice(0, index + 1))}/">${escapeHtml(index === 0 ? root.label : segment)}</a>`)];
        const here = href(segments);
        const rows = shown.map((entry) => {
          const path = [...segments, entry.name];
          const link = `${href(path)}${entry.directory ? "/" : ""}`;
          const audio = !entry.directory && entry.name.toLowerCase().endsWith(".mp3") ? `<audio controls preload="none" src="${link}"></audio>` : "";
          const download = entry.directory ? "" : ` <a href="${link}?download=1">download</a>`;
          return `<tr><td><a href="${link}">${escapeHtml(entry.name)}${entry.directory ? "/" : ""}</a>${download}</td><td class="size">${entry.directory ? "" : formatSize(entry.size)}</td><td class="time">${formatTime(entry.modified)}</td><td>${audio}</td></tr>`;
        }).join("");
        const sortLinks = newest ? `<a href="${here}/">By name</a> · newest first` : `by name · <a href="${here}/?sort=time">Newest first</a>`;
        const body = `<h1>${escapeHtml(segments.at(-1) === root.id ? root.label : segments.at(-1)!)}</h1><nav>${crumbs.join(" / ")} · ${sortLinks}</nav>${shown.length === 0 ? `<p class="empty">Nothing here.</p>` : `<table><tr><th>Name</th><th>Size</th><th>Modified</th><th></th></tr>${rows}</table>`}${entries.length > shown.length ? `<p class="empty">Showing the first ${MAX_ENTRIES} of ${entries.length}.</p>` : ""}`;
        send(response, 200, page(root.label, body), head);
      } catch {
        if (!response.headersSent) send(response, 500, page("Error", `<h1>Could not read this folder</h1>`), head);
        else response.destroy();
      }
    },
  };
}
