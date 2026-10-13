import { writable } from "svelte/store";

// Collapsed folders, kept client-side like pins so a reload keeps the tree
// as the user left it. Guarded on window so SSR never touches localStorage.
const COLLAPSED_STORAGE = "scrinium:collapsedDirs";
function loadCollapsed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(COLLAPSED_STORAGE) ?? "[]");
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((p): p is string => typeof p === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}
export const collapsedDirs = writable<Set<string>>(loadCollapsed());
collapsedDirs.subscribe((dirs) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COLLAPSED_STORAGE, JSON.stringify([...dirs]));
  } catch {
    // storage full/blocked - collapsing still works for this session
  }
});

export function toggleDir(path: string) {
  collapsedDirs.update((s) => {
    const next = new Set(s);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });
}

export function expandDir(path: string) {
  collapsedDirs.update((s) => {
    if (!s.has(path)) return s;
    const next = new Set(s);
    next.delete(path);
    return next;
  });
}

// Folders keep their collapsed state through a rename (and any subfolders
// underneath get their keys rewritten too).
export function renameDir(oldPath: string, newPath: string) {
  collapsedDirs.update((s) => {
    const next = new Set<string>();
    for (const p of s) {
      if (p === oldPath) next.add(newPath);
      else if (p.startsWith(oldPath + "/"))
        next.add(newPath + p.slice(oldPath.length));
      else next.add(p);
    }
    return next;
  });
}

export function parentDirOf(path: string): string | null {
  const i = path.lastIndexOf("/");
  return i === -1 ? null : path.slice(0, i);
}
