/**
 * Hands out archive paths that do not collide, the way a desktop names a
 * second copy: `photo.png`, then `photo (1).png`. Compared case-blind, since
 * Windows and macOS extract `A.png` and `a.png` onto the same file.
 */
export class MediaArchiveNames {
  private readonly taken = new Set<string>();

  /** `path` itself when free, else the first free `name (n).ext` beside it. */
  claim(path: string): string {
    if (this.take(path)) return path;
    const slash = path.lastIndexOf("/");
    const directory = path.slice(0, slash + 1);
    const name = path.slice(slash + 1);
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    for (let copy = 1; ; copy++) {
      const candidate = `${directory}${stem} (${copy})${extension}`;
      if (this.take(candidate)) return candidate;
    }
  }

  private take(path: string): boolean {
    const key = path.toLowerCase();
    if (this.taken.has(key)) return false;
    this.taken.add(key);
    return true;
  }
}
