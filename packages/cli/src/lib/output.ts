export function info(msg: string) {
  console.log(msg);
}

export function success(msg: string) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}

export function warn(msg: string) {
  console.log(`\x1b[33m⚠\x1b[0m ${msg}`);
}

export function error(msg: string) {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
}

export function table(rows: Record<string, string>[]) {
  if (rows.length === 0) return;

  const keys = Object.keys(rows[0]!);
  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => (r[k] ?? "").length)),
  );

  const header = keys.map((k, i) => k.padEnd(widths[i]!)).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");

  info(header);
  info(separator);
  for (const row of rows) {
    info(keys.map((k, i) => (row[k] ?? "").padEnd(widths[i]!)).join("  "));
  }
}
