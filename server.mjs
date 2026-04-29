import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");
const storeDir = path.join(rootDir, ".paper2data");
const uploadPdf = path.join(storeDir, "current.pdf");
const port = Number(process.env.PORT || 5177);

let currentPdf = null;

await mkdir(storeDir, { recursive: true });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/pdf") {
      const body = await readBody(req, 100 * 1024 * 1024);
      await writeFile(uploadPdf, body);
      currentPdf = uploadPdf;
      return sendJson(res, await pdfInfo(currentPdf));
    }

    const pageMatch = url.pathname.match(/^\/api\/page\/(\d+)\.svg$/);
    if (req.method === "GET" && pageMatch) {
      if (!currentPdf) {
        return sendText(res, 400, "No PDF loaded");
      }
      const page = Number(pageMatch[1]);
      const svg = await run("mutool", ["draw", "-F", "svg", "-o", "-", currentPdf, String(page)]);
      res.writeHead(200, {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "no-store"
      });
      return res.end(svg.stdout);
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    return sendText(res, 500, error.message || String(error));
  }
});

server.listen(port, () => {
  console.log(`PDF plot digitizer: http://localhost:${port}`);
});

async function readBody(req, maxBytes) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new Error("PDF is larger than 100 MB");
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function pdfInfo(pdfPath) {
  const [{ stdout }, stats] = await Promise.all([
    run("pdfinfo", [pdfPath]),
    stat(pdfPath)
  ]);
  const pages = Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1] || 0);

  return {
    name: path.basename(pdfPath),
    pages,
    size: stats.size
  };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        resolve({ stdout: out, stderr: err });
      } else {
        reject(new Error(err || `${command} exited with status ${code}`));
      }
    });
  });
}

async function serveStatic(rawPath, res) {
  const requestPath = rawPath === "/" ? "/index.html" : rawPath;
  const filePath = path.resolve(publicDir, `.${decodeURIComponent(requestPath)}`);

  if (!filePath.startsWith(`${publicDir}${path.sep}`)) {
    return sendText(res, 403, "Forbidden");
  }

  try {
    const mime = mimeType(filePath);
    await stat(filePath);
    res.writeHead(200, { "content-type": mime });
    createReadStream(filePath).pipe(res);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function mimeType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  return "application/octet-stream";
}

function sendJson(res, payload) {
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}
