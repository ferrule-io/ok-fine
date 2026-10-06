import { Monitor, Moon, Sun } from "lucide-react";
import { type ThemePreference, useThemePreference } from "../lib/theme.js";

const NEXT_THEME: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};

export function ThemeToggle({ className }: { className?: string }) {
  const [pref, setPref] = useThemePreference();

  const handleCycle = () => {
    setPref(NEXT_THEME[pref]);
  };

  return (
    <button
      type="button"
      onClick={handleCycle}
      className={
        className ??
        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg transition-colors"
      }
      aria-label={`Toggle theme (current: ${pref})`}
      title={`Theme: ${pref} (click to switch to ${NEXT_THEME[pref]})`}
    >
      {pref === "system" && <Monitor size={16} />}
      {pref === "light" && <Sun size={16} />}
      {pref === "dark" && <Moon size={16} />}
    </button>
  );
}
