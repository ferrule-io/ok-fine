import { OkfError } from "../errors.js";
import { parseActor } from "../okf/semantics.js";

export interface Principal {
  subject: string;
  clientId: string;
  identity: string | null;
  scopes: string[];
  /** IdP groups from the configured groups claim; empty for AUTH_MODE=none and stdio. */
  groups: string[];
  canRead: boolean;
  canWrite: boolean;
  canAdmin: boolean;
}

export function checkActor(actor: string, p: Principal): string {
  const parsed = parseActor(actor);
  if (!parsed) {
    throw new OkfError("invalid_actor", 400, "actor must be <producer>/<version>, human:<id>, or process:<id>");
  }

  if (parsed.kind === "human") {
    if (p.identity === null) {
      throw new OkfError("forbidden_actor", 403, "this token carries no identity claim; human: actors are not allowed");
    }
    // Email identities compare case-insensitively; any other identity must match exactly.
    const matches = p.identity.includes("@")
      ? parsed.id.toLowerCase() === p.identity.toLowerCase()
      : parsed.id === p.identity;
    if (!matches) {
      throw new OkfError("forbidden_actor", 403, `this token may only act as human:${p.identity}`);
    }
  }

  return actor;
}
