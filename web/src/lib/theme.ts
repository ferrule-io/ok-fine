import { useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "okf.theme";
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function applyTheme(pref: ThemePreference): void {
  if (typeof document === "undefined") {
    return;
  }
  const systemDark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const dark = pref === "dark" || (pref === "system" && Boolean(systemDark));
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function getThemePreference(): ThemePreference {
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark" || stored === "system") {
        return stored;
      }
    }
  } catch {
    // Fall back to system on access errors
  }
  return "system";
}

export function setThemePreference(p: ThemePreference): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, p);
    }
  } catch {
    // Ignore storage quota or access errors
  }
  applyTheme(p);
  notify();
}

let initialized = false;

export function initTheme(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  applyTheme(getThemePreference());

  if (typeof window !== "undefined" && window.matchMedia) {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", () => {
      if (getThemePreference() === "system") {
        applyTheme("system");
        notify();
      }
    });

    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY) {
        applyTheme(getThemePreference());
        notify();
      }
    });
  }
}

export function useThemePreference(): [ThemePreference, (p: ThemePreference) => void] {
  const pref = useSyncExternalStore(subscribe, getThemePreference, (): ThemePreference => "system");
  return [pref, setThemePreference];
}
