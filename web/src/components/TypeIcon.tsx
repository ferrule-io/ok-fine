import { clsx } from "clsx";
import {
  BookA,
  Bookmark,
  BookOpenCheck,
  Boxes,
  FileCode,
  FileText,
  Folder,
  FolderKanban,
  FolderOpen,
  Network,
  Plug,
  Ruler,
  Scale,
} from "lucide-react";

export const CONCEPT_TYPES: string[] = [
  "Project",
  "Decision",
  "Convention",
  "Architecture",
  "Component",
  "Playbook",
  "Interface",
  "Reference",
  "Glossary Term",
];

const TYPE_TINTS: Record<string, string> = {
  project: "text-accent-500",
  decision: "text-violet-600 dark:text-violet-400",
  convention: "text-sky-600 dark:text-sky-400",
  architecture: "text-cyan-600 dark:text-cyan-400",
  component: "text-cyan-600 dark:text-cyan-400",
  playbook: "text-emerald-600 dark:text-emerald-400",
  interface: "text-amber-600 dark:text-amber-400",
  reference: "text-zinc-600 dark:text-zinc-400",
  "glossary term": "text-pink-600 dark:text-pink-400",
};

export function typeTint(type: string | null): string {
  if (!type) return "text-zinc-600 dark:text-zinc-400";
  const key = type.trim().toLowerCase();
  return TYPE_TINTS[key] ?? "text-zinc-600 dark:text-zinc-400";
}

export interface TypeIconProps {
  type: string | null;
  className?: string;
  size?: number;
}

export function TypeIcon({ type, className, size = 16 }: TypeIconProps) {
  const key = type ? type.trim().toLowerCase() : "";
  const tint = typeTint(type);
  const classes = clsx("shrink-0", tint, className);

  switch (key) {
    case "project":
      return <FolderKanban size={size} className={classes} />;
    case "decision":
      return <Scale size={size} className={classes} />;
    case "convention":
      return <Ruler size={size} className={classes} />;
    case "architecture":
      return <Network size={size} className={classes} />;
    case "component":
      return <Boxes size={size} className={classes} />;
    case "playbook":
      return <BookOpenCheck size={size} className={classes} />;
    case "interface":
      return <Plug size={size} className={classes} />;
    case "reference":
      return <Bookmark size={size} className={classes} />;
    case "glossary term":
      return <BookA size={size} className={classes} />;
    default:
      return <FileText size={size} className={classes} />;
  }
}

export interface DirectoryIconProps {
  open?: boolean;
  className?: string;
  size?: number;
}

export function DirectoryIcon({ open = false, className, size = 16 }: DirectoryIconProps) {
  const classes = clsx("shrink-0 text-muted", className);
  return open ? <FolderOpen size={size} className={classes} /> : <Folder size={size} className={classes} />;
}

export interface FileIconProps {
  className?: string;
  size?: number;
}

export function FileIcon({ className, size = 16 }: FileIconProps) {
  return <FileCode size={size} className={clsx("shrink-0 text-muted", className)} />;
}
