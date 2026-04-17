const TEXT_CONTENT_TYPES = new Set([
  "text/markdown",
  "text/plain",
  "text/html",
  "text/css",
  "application/json",
  "application/yaml",
  "application/toml",
  "application/typescript",
  "application/javascript",
  "application/x-sh",
  "image/svg+xml",
]);

export default function isTextContentType(contentType: string): boolean {
  return TEXT_CONTENT_TYPES.has(contentType) || contentType.startsWith("text/");
}
