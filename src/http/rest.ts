import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { OkfError } from "../errors.js";
import { parseFrontmatter, splitFrontmatter } from "../okf/frontmatter.js";
import type { KnowledgeService } from "../service/knowledge-service.js";
import type { Principal } from "../service/principal.js";

const projectParams = z.object({ project: z.string() });
const wildcardParams = z.object({ project: z.string(), "*": z.string() });

function principalOf(req: FastifyRequest): Principal {
  if (!req.principal) throw new OkfError("internal", 500, "request is not authenticated");
  return req.principal;
}

function actorOf(req: FastifyRequest): string {
  const actor = req.headers["x-okf-actor"];
  if (typeof actor !== "string" || actor.trim() === "") {
    throw new OkfError("invalid_actor", 400, "X-OKF-Actor header is required");
  }
  return actor.trim();
}

/** Maps If-Match / If-None-Match to the service's expectedRevision (undefined = unconditional). */
function expectedRevisionOf(req: FastifyRequest): string | null | undefined {
  const ifMatch = req.headers["if-match"];
  const ifNoneMatch = req.headers["if-none-match"];
  if (ifMatch !== undefined && ifNoneMatch !== undefined) {
    throw new OkfError("bad_request", 400, "send either If-Match or If-None-Match, not both");
  }
  if (ifNoneMatch !== undefined) {
    if (ifNoneMatch.trim() !== "*") throw new OkfError("bad_request", 400, "If-None-Match supports only *");
    return null;
  }
  if (ifMatch !== undefined) {
    return ifMatch
      .trim()
      .replace(/^W\//, "")
      .replace(/^"(.*)"$/, "$1");
  }
  return undefined;
}

function withRevision<T extends { revision?: string | null }>(reply: FastifyReply, result: T): T {
  if (typeof result.revision === "string") reply.header("etag", `"${result.revision}"`);
  return result;
}

function decodeText(body: unknown): string {
  let text: string;
  if (typeof body === "string") {
    text = body;
  } else if (Buffer.isBuffer(body)) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      throw new OkfError("unsupported_media", 415, "file content must be UTF-8 text");
    }
  } else {
    throw new OkfError("unsupported_media", 415, "send text/* or application/octet-stream content");
  }
  if (text.includes("\0")) throw new OkfError("unsupported_media", 415, "file content must not contain NUL bytes");
  return text;
}

/** For routes whose target must already exist: If-None-Match: * cannot be honored, so it is rejected. */
function existingRevisionOf(req: FastifyRequest): string | undefined {
  const expected = expectedRevisionOf(req);
  if (expected === null) {
    throw new OkfError("bad_request", 400, "If-None-Match is not supported on this route; use If-Match");
  }
  return expected;
}

const conceptJsonBody = z.object({
  frontmatter: z.record(z.string(), z.unknown()),
  body: z.string(),
  message: z.string().optional(),
});

function conceptInput(req: FastifyRequest): { frontmatter: Record<string, unknown>; body: string; message?: string } {
  if (typeof req.body === "string") {
    const split = splitFrontmatter(req.body);
    if (!split) throw new OkfError("invalid_frontmatter", 400, "markdown must start with a --- delimited YAML frontmatter");
    const parsed = parseFrontmatter(split.yaml);
    if ("error" in parsed) throw new OkfError("invalid_frontmatter", 400, `${parsed.error}: ${parsed.message}`);
    return { frontmatter: parsed.data, body: split.body };
  }
  return conceptJsonBody.parse(req.body);
}

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
};

const searchQuery = z.object({
  q: z.string().optional(),
  project: z.string().optional(),
  type: z.string().optional(),
  tag: z.union([z.string(), z.array(z.string())]).optional(),
  status: z.enum(["draft", "stable", "deprecated"]).optional(),
  trustTier: z.enum(["unverified", "machine-confirmed", "human-reviewed"]).optional(),
  stale: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export function registerRestRoutes(app: FastifyInstance, service: KnowledgeService): void {
  const read = { permission: "read" } as const;
  const write = { permission: "write" } as const;
  const admin = { permission: "admin" } as const;

  app.get("/api/v1/projects", { config: read }, async () => service.listProjects());

  app.post("/api/v1/projects", { config: write }, async (req, reply) => {
    const body = z.object({ project: z.string(), title: z.string(), description: z.string().optional() }).parse(req.body);
    const result = await service.createProject(principalOf(req), { ...body, actor: actorOf(req) });
    return reply.code(201).send(result);
  });

  app.get("/api/v1/projects/:project", { config: read }, async (req) => {
    const { project } = projectParams.parse(req.params);
    return service.getProject(project);
  });

  app.delete("/api/v1/projects/:project", { config: admin }, async (req) => {
    const { project } = projectParams.parse(req.params);
    return service.deleteProject(principalOf(req), { project, actor: actorOf(req) });
  });

  app.get("/api/v1/projects/:project/index", { config: read }, async (req) => {
    const { project } = projectParams.parse(req.params);
    const { path } = z.object({ path: z.string().optional() }).parse(req.query);
    return service.getIndex(project, path ?? "");
  });

  app.get("/api/v1/projects/:project/concepts/*", { config: read }, async (req, reply) => {
    const { project, "*": id } = wildcardParams.parse(req.params);
    const concept = withRevision(reply, await service.readConcept(project, id));
    if ((req.headers.accept ?? "").includes("text/markdown")) {
      return reply.type("text/markdown; charset=utf-8").send(concept.markdown);
    }
    return concept;
  });

  app.put("/api/v1/projects/:project/concepts/*", { config: write }, async (req, reply) => {
    const { project, "*": id } = wildcardParams.parse(req.params);
    const input = conceptInput(req);
    const expectedRevision = expectedRevisionOf(req);
    const result = await service.writeConcept(principalOf(req), {
      project,
      id,
      ...input,
      actor: actorOf(req),
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    });
    return reply.code(result.created ? 201 : 200).send(withRevision(reply, result));
  });

  app.delete("/api/v1/projects/:project/concepts/*", { config: write }, async (req) => {
    const { project, "*": id } = wildcardParams.parse(req.params);
    const expectedRevision = existingRevisionOf(req);
    return service.deleteConcept(principalOf(req), {
      project,
      id,
      actor: actorOf(req),
      ...(typeof expectedRevision === "string" ? { expectedRevision } : {}),
    });
  });

  app.post("/api/v1/projects/:project/verifications", { config: write }, async (req, reply) => {
    const { project } = projectParams.parse(req.params);
    const { id } = z.object({ id: z.string() }).parse(req.body);
    const expectedRevision = existingRevisionOf(req);
    const result = await service.verifyConcept(principalOf(req), {
      project,
      id,
      actor: actorOf(req),
      ...(typeof expectedRevision === "string" ? { expectedRevision } : {}),
    });
    return reply.code(201).send(withRevision(reply, result));
  });

  app.get("/api/v1/projects/:project/files/*", { config: read }, async (req, reply) => {
    const { project, "*": path } = wildcardParams.parse(req.params);
    const file = withRevision(reply, await service.readFile(project, path));
    const extension = /\.[^./]+$/.exec(path)?.[0].toLowerCase() ?? "";
    return reply.type(CONTENT_TYPE_BY_EXTENSION[extension] ?? "text/plain; charset=utf-8").send(file.content);
  });

  app.put("/api/v1/projects/:project/files/*", { config: write }, async (req, reply) => {
    const { project, "*": path } = wildcardParams.parse(req.params);
    const expectedRevision = expectedRevisionOf(req);
    const result = await service.writeFile(principalOf(req), {
      project,
      path,
      content: decodeText(req.body),
      actor: actorOf(req),
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    });
    return withRevision(reply, result);
  });

  app.delete("/api/v1/projects/:project/files/*", { config: write }, async (req) => {
    const { project, "*": path } = wildcardParams.parse(req.params);
    const expectedRevision = existingRevisionOf(req);
    return service.deleteFile(principalOf(req), {
      project,
      path,
      actor: actorOf(req),
      ...(typeof expectedRevision === "string" ? { expectedRevision } : {}),
    });
  });

  app.get("/api/v1/projects/:project/history", { config: read }, async (req) => {
    const { project } = projectParams.parse(req.params);
    const { id, limit } = z
      .object({ id: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() })
      .parse(req.query);
    return service.history(project, id, limit);
  });

  app.get("/api/v1/projects/:project/lint", { config: read }, async (req) => {
    const { project } = projectParams.parse(req.params);
    return service.lint(project);
  });

  app.get("/api/v1/projects/:project/archive", { config: read }, async (req, reply) => {
    const { project } = projectParams.parse(req.params);
    const stream = await service.exportArchive(project);
    return reply
      .type("application/gzip")
      .header("content-disposition", `attachment; filename="${project}.tar.gz"`)
      .send(stream);
  });

  app.put("/api/v1/projects/:project/archive", { config: admin }, async (req) => {
    const { project } = projectParams.parse(req.params);
    if (!Buffer.isBuffer(req.body)) {
      throw new OkfError("unsupported_media", 415, "send the archive as application/gzip");
    }
    return service.importArchive(principalOf(req), { project, actor: actorOf(req), archive: req.body });
  });

  app.get("/api/v1/search", { config: read }, async (req) => {
    const q = searchQuery.parse(req.query);
    return service.search({
      ...(q.q === undefined ? {} : { query: q.q }),
      ...(q.project === undefined ? {} : { project: q.project }),
      ...(q.type === undefined ? {} : { type: q.type }),
      ...(q.tag === undefined ? {} : { tags: Array.isArray(q.tag) ? q.tag : [q.tag] }),
      ...(q.status === undefined ? {} : { status: q.status }),
      ...(q.trustTier === undefined ? {} : { trustTier: q.trustTier }),
      ...(q.stale === undefined ? {} : { stale: q.stale === "true" }),
      ...(q.limit === undefined ? {} : { limit: q.limit }),
    });
  });

  app.get("/api/v1/sync", { config: read }, async () => service.syncStatus());

  app.post("/api/v1/sync", { config: admin }, async () => service.syncNow());
}
