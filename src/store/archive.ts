import { Readable } from "node:stream";
import * as tar from "tar";
import { OkfError } from "../errors.js";

const IGNORED_ENTRY_TYPES = new Set([
  "GlobalExtendedHeader",
  "ExtendedHeader",
  "NextFileHasLongPath",
  "NextFileHasLongLinkpath",
  "OldGnuLongPath",
]);

const ALLOWED_ENTRY_TYPES = new Set(["File", "OldFile", "Directory"]);

export async function extractBundleArchive(
  buffer: Buffer,
  destDir: string,
  limits: { maxFileBytes: number; maxArchiveBytes: number }
): Promise<void> {
  // Pass 1: Listing and validation
  const { promise: listPromise, resolve: listResolve, reject: listReject } =
    Promise.withResolvers<void>();

  let validationError: Error | null = null;
  let entryCount = 0;
  let totalBytes = 0;
  const topDirs = new Set<string>();

  const listStream = tar.t({
    onentry: (entry) => {
      if (validationError) {
        return;
      }

      const type = entry.type;
      if (IGNORED_ENTRY_TYPES.has(type)) {
        return;
      }

      if (!ALLOWED_ENTRY_TYPES.has(type)) {
        validationError = new OkfError(
          "invalid_archive",
          400,
          `archive contains unsupported entry type: ${type}`
        );
        return;
      }

      if (entry.path.startsWith("/")) {
        validationError = new OkfError(
          "invalid_archive",
          400,
          "archive cannot contain absolute paths"
        );
        return;
      }

      const segments = entry.path.split("/").filter((s) => s.length > 0);
      if (segments.length === 0) {
        validationError = new OkfError(
          "invalid_archive",
          400,
          "archive contains empty entry path"
        );
        return;
      }

      if (segments.includes("..")) {
        validationError = new OkfError(
          "invalid_archive",
          400,
          "archive cannot contain path traversal (..) segments"
        );
        return;
      }

      if (type === "File" || type === "OldFile") {
        if (segments.length < 2) {
          validationError = new OkfError(
            "archive_layout",
            400,
            "archive must contain a single top-level directory, as produced by export"
          );
          return;
        }
      }

      const topDir = segments[0];
      if (topDir) {
        topDirs.add(topDir);
        if (topDirs.size > 1) {
          validationError = new OkfError(
            "archive_layout",
            400,
            "archive must contain a single top-level directory, as produced by export"
          );
          return;
        }
      }

      if (entry.size != null && entry.size > limits.maxFileBytes) {
        validationError = new OkfError(
          "payload_too_large",
          413,
          `archive entry "${entry.path}" exceeds maximum file size (${limits.maxFileBytes} bytes)`
        );
        return;
      }

      totalBytes += entry.size ?? 0;
      if (totalBytes > 5 * limits.maxArchiveBytes) {
        validationError = new OkfError(
          "payload_too_large",
          413,
          `uncompressed archive exceeds 5x max archive bytes limit (${5 * limits.maxArchiveBytes} bytes)`
        );
        return;
      }

      entryCount++;
      if (entryCount > 20000) {
        validationError = new OkfError(
          "payload_too_large",
          413,
          "archive contains more than 20,000 entries"
        );
        return;
      }
    },
  });

  listStream.on("end", () => {
    if (validationError) {
      listReject(validationError);
      return;
    }
    if (topDirs.size !== 1) {
      listReject(
        new OkfError(
          "archive_layout",
          400,
          "archive must contain a single top-level directory, as produced by export"
        )
      );
      return;
    }
    listResolve();
  });

  listStream.on("error", (err) => {
    listReject(new OkfError("invalid_archive", 400, `failed to read archive: ${err.message}`));
  });

  Readable.from(buffer).pipe(listStream);
  await listPromise;

  // Pass 2: Extract with strip: 1 and skip dotfiles
  const { promise: extractPromise, resolve: extractResolve, reject: extractReject } =
    Promise.withResolvers<void>();

  const extractStream = tar.x({
    cwd: destDir,
    strip: 1,
    filter: (entryPath: string) => {
      const parts = entryPath.split("/");
      return !parts.some((p) => p.startsWith("."));
    },
  });

  extractStream.on("end", extractResolve);
  extractStream.on("error", (err) => {
    extractReject(new OkfError("invalid_archive", 400, `failed to extract archive: ${err.message}`));
  });

  Readable.from(buffer).pipe(extractStream);
  await extractPromise;
}
