import { clsx } from "clsx";
import { Link, useLocation, useParams } from "react-router";
import { useConcept, useProject } from "../api/queries.js";

export function Breadcrumbs({ className }: { className?: string }) {
  const params = useParams();
  const location = useLocation();
  const project = params.project;
  const wildcard = params["*"];

  const projectQuery = useProject(project ?? "");
  const projectTitle = projectQuery.data?.title ?? project;

  const isConcept = location.pathname.includes("/c/") && Boolean(wildcard);
  const isFile = location.pathname.includes("/f/") && Boolean(wildcard);
  const isActivity = location.pathname.endsWith("/activity");
  const isHealth = location.pathname.endsWith("/health");
  const isSearch = location.pathname === "/search";
  const isMetrics = location.pathname === "/metrics";

  const conceptQuery = useConcept(project ?? "", isConcept ? (wildcard ?? "") : "");
  const conceptTitle = conceptQuery.data?.derived?.title ?? (wildcard ? wildcard.split("/").pop() : "");
  const segments = wildcard ? wildcard.split("/") : [];
  const dirSegments = segments.slice(0, -1);
  const leafName = segments[segments.length - 1] ?? "";

  const separator = <span className="text-subtle/50 select-none mx-0.5">/</span>;

  return (
    <nav
      aria-label="Breadcrumbs"
      className={clsx("flex items-center gap-1 text-xs overflow-hidden whitespace-nowrap min-w-0", className)}
    >
      <Link
        to="/"
        className={clsx(
          "transition-colors shrink-0",
          !project && !isSearch && !isMetrics ? "font-medium text-fg" : "text-muted hover:text-fg",
        )}
      >
        Projects
      </Link>

      {isSearch && (
        <>
          {separator}
          <span className="font-medium text-fg truncate">Search</span>
        </>
      )}

      {isMetrics && (
        <>
          {separator}
          <span className="font-medium text-fg truncate">Metrics</span>
        </>
      )}

      {project && (
        <>
          {separator}
          {!isConcept && !isFile && !isActivity && !isHealth ? (
            <span className="font-medium text-fg truncate max-w-[200px]" title={projectTitle}>
              {projectTitle}
            </span>
          ) : (
            <Link
              to={`/p/${encodeURIComponent(project)}`}
              className="text-muted hover:text-fg transition-colors truncate max-w-[160px] shrink-0"
              title={projectTitle}
            >
              {projectTitle}
            </Link>
          )}
        </>
      )}

      {isActivity && (
        <>
          {separator}
          <span className="font-medium text-fg truncate">Activity</span>
        </>
      )}

      {isHealth && (
        <>
          {separator}
          <span className="font-medium text-fg truncate">Health</span>
        </>
      )}

      {(isConcept || isFile) && (
        <>
          {dirSegments.map((dir, idx) => {
            const dirPrefix = dirSegments.slice(0, idx + 1).join("/");
            return (
              <span key={dirPrefix} className="flex items-center gap-1 shrink-0">
                {separator}
                <span className="text-subtle select-none max-w-[120px] truncate" title={dir}>
                  {dir}
                </span>
              </span>
            );
          })}

          {separator}
          {isConcept ? (
            <span className="font-medium text-fg truncate max-w-[220px]" title={conceptTitle}>
              {conceptTitle}
            </span>
          ) : (
            <span className="font-medium font-mono text-fg truncate max-w-[220px]" title={leafName}>
              {leafName}
            </span>
          )}
        </>
      )}
    </nav>
  );
}
