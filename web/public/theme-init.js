(() => {
  let pref = "system";
  try {
    const stored = localStorage.getItem("okf.theme");
    if (stored === "light" || stored === "dark" || stored === "system") pref = stored;
  } catch {}
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();
