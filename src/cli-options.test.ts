import { describe, expect, it } from "vitest";
import { parseCli } from "./cli-options.js";

const HOME = "/home/dev";

describe("parseCli", () => {
  it("resolves DATA_DIR with flag over env over the ~/.ok-fine default", () => {
    expect(parseCli([], {}, HOME)).toMatchObject({ command: "stdio", env: { DATA_DIR: "/home/dev/.ok-fine" } });
    expect(parseCli([], { DATA_DIR: "/srv/env" }, HOME).env.DATA_DIR).toBe("/srv/env");
    expect(parseCli(["--data-dir", "/srv/flag"], { DATA_DIR: "/srv/env" }, HOME).env.DATA_DIR).toBe("/srv/flag");
  });

  it("expands ~ in --data-dir against the home directory", () => {
    expect(parseCli(["--data-dir", "~/kb"], {}, HOME).env.DATA_DIR).toBe("/home/dev/kb");
  });

  it("defaults serve to loopback and derives PUBLIC_BASE_URL from the port", () => {
    const inv = parseCli(["serve", "--port", "9999"], {}, HOME);
    expect(inv.command).toBe("serve");
    expect(inv.env).toMatchObject({ HOST: "127.0.0.1", PORT: "9999", PUBLIC_BASE_URL: "http://localhost:9999" });
  });

  it("maps serve --no-auth to AUTH_MODE=none", () => {
    expect(parseCli(["serve", "--no-auth"], {}, HOME).env.AUTH_MODE).toBe("none");
  });

  it("rejects serve-only flags under stdio", () => {
    expect(() => parseCli(["--port", "1"], {}, HOME)).toThrow('--port only applies to "ok-fine serve"');
  });

  it("rejects unknown commands", () => {
    expect(() => parseCli(["bogus"], {}, HOME)).toThrow('unknown command "bogus"');
  });

  it("lets --help and --version win over unknown flags and commands", () => {
    expect(parseCli(["bogus", "--help", "--nope"], {}, HOME).command).toBe("help");
    expect(parseCli(["--port", "1", "-v"], {}, HOME).command).toBe("version");
    expect(() => parseCli(["--nope"], {}, HOME)).toThrow();
  });
});
