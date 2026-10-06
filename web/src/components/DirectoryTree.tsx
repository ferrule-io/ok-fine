import { clsx } from "clsx";
import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo } from "react";
import { Link, useLocation, useParams } from "react-router";
import type { IndexEntry } from "../../../src/service/knowledge-service.js";
import { useIndex } from "../api/queries.js";
import { conceptUrl, fileUrl } from "../lib/links.js";
import { Skeleton } from "./Skeleton.js";
import { useTreeState } from "./TreeState.js";
import { DirectoryIcon, FileIcon, TypeIcon } from "./TypeIcon.js";

export interface DirectoryTreeProps {
  project: string;
}

interface DirectorySubtreeProps {
  project: string;
  dir: string;
  depth: number;
  activeConceptId: string | null;
  activeFilePath: string | null;
}

function sortEntries(entries: IndexEntry[], isRoot: boolean): IndexEntry[] {
  const dirs: Extract<IndexEntry, { kind: "directory" }>[] = [];
  const concepts: Extract<IndexEntry, { kind: "concept" }>[] = [];
  const files: Extract<IndexEntry, { kind: "file" }>[] = [];

  for (const entry of entries) {
    if (entry.kind === "directory") {
      dirs.push(entry);
    } else if (entry.kind === "concept") {
      if (isRoot && entry.id === "overview") {
        // Omit root overview concept per plan
        continue;
      }
      concepts.push(entry);
    } else if (entry.kind === "file") {
      files.push(entry);
    }
  }

  dirs.sort((a, b) => a.path.localeCompare(b.path));
  concepts.sort((a, b) => a.title.localeCompare(b.title));
  files.sort((a, b) => a.path.localeCompare(b.path));

  return [...dirs, ...concepts, ...files];
}

function DirectorySubtree({ project, dir, depth, activeConceptId, activeFilePath }: DirectorySubtreeProps) {
  const { data, isLoading } = useIndex(project, dir, true);
  const { expanded, toggle } = useTreeState();

  const sorted = useMemo(() => {
    if (!data) return [];
    return sortEntries(data, dir === "");
  }, [data, dir]);

  if (isLoading) {
    return (
      <div className="py-1 space-y-1" style={{ paddingLeft: `${depth * 12 + 12}px` }}>
        <Skeleton className="h-5 w-3/4 rounded-md" />
        <Skeleton className="h-5 w-1/2 rounded-md" />
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="py-1 text-[11px] text-subtle italic select-none" style={{ paddingLeft: `${depth * 12 + 16}px` }}>
        Empty directory
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {sorted.map((entry) => {
        if (entry.kind === "directory") {
          const isExpanded = expanded.has(entry.path);
          const dirName = entry.path.split("/").pop() ?? entry.path;

          return (
            <div key={`dir-${entry.path}`} data-tree-path={entry.path}>
              <button
                type="button"
                onClick={() => toggle(entry.path)}
                className="group flex w-full items-center gap-1.5 py-1 pr-2 rounded-md text-xs font-medium text-muted hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer text-left"
                style={{ paddingLeft: `${depth * 12 + 6}px` }}
              >
                <ChevronRight
                  size={12}
                  className={clsx("text-subtle transition-transform duration-150 shrink-0", isExpanded && "rotate-90")}
                />
                <DirectoryIcon open={isExpanded} size={14} />
                <span className="truncate flex-1">{dirName}</span>
                <span className="ml-auto text-[11px] text-subtle font-mono tabular-nums">{entry.conceptCount}</span>
              </button>

              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <DirectorySubtree
                      project={project}
                      dir={entry.path}
                      depth={depth + 1}
                      activeConceptId={activeConceptId}
                      activeFilePath={activeFilePath}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        }

        if (entry.kind === "concept") {
          const isActive = activeConceptId === entry.id;

          return (
            <div key={`concept-${entry.id}`} data-tree-path={entry.id}>
              <Link
                to={conceptUrl(project, entry.id)}
                className={clsx(
                  "group flex items-center gap-2 py-1 pr-2 rounded-md text-xs transition-colors",
                  isActive
                    ? "border-l-2 border-accent-500 bg-surface-2 text-fg font-medium pl-[calc(var(--tree-pad)-2px)]"
                    : "border-l-2 border-transparent text-muted hover:text-fg hover:bg-surface-2",
                )}
                style={
                  {
                    "--tree-pad": `${depth * 12 + 20}px`,
                    paddingLeft: isActive ? `${depth * 12 + 18}px` : `${depth * 12 + 20}px`,
                  } as React.CSSProperties
                }
              >
                <TypeIcon type={entry.type} size={14} />
                <span className="truncate">{entry.title}</span>
              </Link>
            </div>
          );
        }

        if (entry.kind === "file") {
          const isActive = activeFilePath === entry.path;
          const fileName = entry.path.split("/").pop() ?? entry.path;

          return (
            <div key={`file-${entry.path}`} data-tree-path={entry.path}>
              <Link
                to={fileUrl(project, entry.path)}
                className={clsx(
                  "group flex items-center gap-2 py-1 pr-2 rounded-md text-xs transition-colors",
                  isActive
                    ? "border-l-2 border-accent-500 bg-surface-2 text-fg font-medium font-mono"
                    : "border-l-2 border-transparent text-muted hover:text-fg hover:bg-surface-2 font-mono",
                )}
                style={{
                  paddingLeft: isActive ? `${depth * 12 + 18}px` : `${depth * 12 + 20}px`,
                }}
              >
                <FileIcon size={14} />
                <span className="truncate">{fileName}</span>
              </Link>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

export function DirectoryTree({ project }: DirectoryTreeProps) {
  const params = useParams();
  const location = useLocation();
  const wildcard = params["*"] ?? null;

  const isConcept = location.pathname.includes("/c/") && wildcard !== null;
  const isFile = location.pathname.includes("/f/") && wildcard !== null;

  const activeConceptId = isConcept ? wildcard : null;
  const activeFilePath = isFile ? wildcard : null;

  const { expanded, toggle } = useTreeState();

  // Ancestor auto-expand effect:
  // When viewing a concept or file, expand its directory ancestors in the tree state
  useEffect(() => {
    const activePath = activeConceptId ?? activeFilePath;
    if (!activePath) return;

    const segments = activePath.split("/");
    if (segments.length <= 1) return;

    let acc = "";
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      if (!seg) continue;
      acc = acc ? `${acc}/${seg}` : seg;
      if (!expanded.has(acc)) {
        toggle(acc);
      }
    }
  }, [activeConceptId, activeFilePath, expanded, toggle]);

  return (
    <div className="py-1">
      <DirectorySubtree
        project={project}
        dir=""
        depth={0}
        activeConceptId={activeConceptId}
        activeFilePath={activeFilePath}
      />
    </div>
  );
}
