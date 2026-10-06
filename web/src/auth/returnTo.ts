export function currentReturnTo(): string {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const search = typeof window !== "undefined" ? window.location.search : "";
  const hash = typeof window !== "undefined" ? window.location.hash : "";

  let path = pathname.replace(/^\/ui(?:\/|$)/, "/");
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  return `${path}${search}${hash}`;
}
