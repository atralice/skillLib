const MIME_TYPES: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  ts: "application/typescript",
  tsx: "application/typescript",
  js: "application/javascript",
  jsx: "application/javascript",
  mjs: "application/javascript",
  cjs: "application/javascript",
  html: "text/html",
  css: "text/css",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  wasm: "application/wasm",
  sh: "application/x-sh",
};

export function contentTypeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return "application/octet-stream";
  return MIME_TYPES[ext] ?? "application/octet-stream";
}
