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

// Drag-and-drop state, shared across the recursive FileTree instances so a
// drag started on one level can highlight a drop target on any other level.
export const dragPath = writable<string | null>(null);
export const dragKind = writable<"file" | "directory" | null>(null);
export const dropDir = writable<string | null>(null);
export const dropRoot = writable<boolean>(false);

export function parentDirOf(path: string): string | null {
  const i = path.lastIndexOf("/");
  return i === -1 ? null : path.slice(0, i);
}

// A folder (or the root) is a valid drop target unless it IS the dragged item
// or one of its descendants (a folder can't be moved into itself). A file is
// always droppable on any folder - including its own ancestors, which is the
// normal way to move a file up out of a subfolder.
export function canDrop(
  source: string | null,
  target: string | null,
  kind: "file" | "directory" | null,
): boolean {
  if (!source || !kind) return false;
  if (!target) return true;
  if (target === source) return false;
  if (kind === "directory" && source.startsWith(target + "/")) return false;
  return true;
}

export function clearDragState() {
  dragPath.set(null);
  dragKind.set(null);
  dropDir.set(null);
  dropRoot.set(false);
}
