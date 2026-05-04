export function assertNever(x: never): never {
  throw new Error(`Unreachable: ${String(x)}`);
}

export function pathToDisplayTitle(path: string): string {
  const filename = path.split("/").filter(Boolean).pop() ?? path;
  return filename.replace(/\.md$/i, "").replace(/[-_]/g, " ");
}

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
