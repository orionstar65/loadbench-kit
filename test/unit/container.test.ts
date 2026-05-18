import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// Create the mock function
const mockExecFile = jest.fn();

// Mock child_process before importing Container
jest.unstable_mockModule("child_process", () => ({
  execFile: mockExecFile,
}));

// Dynamic import after mock setup
const { default: Container } =
  await import("loadbench-kit/docker/container.js");

beforeEach(() => {
  mockExecFile.mockReset();
});

// ── Fixtures ────────────────────────────────────────────────────────────

const STATS_FIXTURE = {
  ID: "abc",
  Name: "test-container",
  Container: "test-container",
  PIDs: 5,
  CPUPerc: 1.5,
  MemPerc: 25,
  MemUsage: "100MiB / 1GiB",
  BlockIO: "50MB / 100MB",
  NetIO: "10kB / 20kB",
};

// Linux Docker Engine returns an array
const STATS_JSON = JSON.stringify([STATS_FIXTURE]);

// Docker Desktop for Mac returns a bare object
const STATS_JSON_MAC = JSON.stringify(STATS_FIXTURE);

const INSPECT_JSON = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify([
    {
      State: {
        Running: false,
        OOMKilled: false,
        Paused: false,
        Restarting: false,
        Health: { Status: "healthy", FailingStreak: 0 },
        ...overrides,
      },
    },
  ]);

const CONFIG_JSON = (ports: unknown[] = []) =>
  JSON.stringify({
    services: { app: { image: "test-image", ports } },
  });

// Helper: make mockExecFile call back with given stdout
function succeedWith(stdout: string) {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const callback = args[args.length - 1] as Function;
    callback(null, stdout, "");
  });
}

function failWith(error: Error) {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const callback = args[args.length - 1] as Function;
    callback(error);
  });
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("Container", () => {
  const CWD = "/project";
  const NAME = "test-container";
  let container: InstanceType<typeof Container>;

  beforeEach(() => {
    container = new Container(CWD, NAME);
  });

  describe("up()", () => {
    it("calls docker compose up with correct args", async () => {
      succeedWith("");
      await container.up();

      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        ["compose", "up", "--detach", "--wait", "app"],
        expect.objectContaining({ cwd: CWD }),
        expect.any(Function),
      );
    });

    it("passes extra env vars when provided", async () => {
      succeedWith("");
      await container.up({ FOO: "bar" });

      const opts = mockExecFile.mock.calls[0][2] as {
        env: Record<string, string>;
      };
      expect(opts.env).toMatchObject({ FOO: "bar" });
    });
  });

  describe("down()", () => {
    it("calls docker compose down", async () => {
      succeedWith("");
      await container.down();

      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        ["compose", "down"],
        expect.objectContaining({ cwd: CWD }),
        expect.any(Function),
      );
    });
  });

  describe("stats()", () => {
    it("parses Linux array-shaped docker stats JSON", async () => {
      succeedWith(STATS_JSON);
      const result = await container.stats();

      expect(result.MemUsage.Usage).toEqual({ value: 100, units: "MiB" });
      expect(result.MemUsage.Limit).toEqual({ value: 1, units: "GiB" });
      expect(result.BlockIO.Read).toEqual({ value: 50, units: "MB" });
      expect(result.BlockIO.Write).toEqual({ value: 100, units: "MB" });
      expect(result.NetIO.Read).toEqual({ value: 10, units: "kB" });
      expect(result.NetIO.Write).toEqual({ value: 20, units: "kB" });
      expect(result.ID).toBe("abc");
      expect(result.PIDs).toBe(5);
    });

    it("parses Mac bare-object docker stats JSON", async () => {
      succeedWith(STATS_JSON_MAC);
      const result = await container.stats();

      expect(result.MemUsage.Usage).toEqual({ value: 100, units: "MiB" });
      expect(result.MemUsage.Limit).toEqual({ value: 1, units: "GiB" });
      expect(result.ID).toBe("abc");
    });
  });

  describe("statsSafe()", () => {
    it("returns parsed stats on success", async () => {
      succeedWith(STATS_JSON);
      const result = await container.statsSafe();

      expect(result).not.toBeNull();
      expect(result!.MemUsage.Usage).toEqual({ value: 100, units: "MiB" });
    });

    it("returns null when stats() rejects", async () => {
      failWith(new Error("docker unavailable"));
      const result = await container.statsSafe();

      expect(result).toBeNull();
    });
  });

  describe("state helpers", () => {
    it("isRunning() returns true when running", async () => {
      succeedWith(INSPECT_JSON({ Running: true }));
      expect(await container.isRunning()).toBe(true);
    });

    it("isRunning() returns false when not running", async () => {
      succeedWith(INSPECT_JSON({ Running: false }));
      expect(await container.isRunning()).toBe(false);
    });

    it("isOomKilled() returns true when OOMKilled", async () => {
      succeedWith(INSPECT_JSON({ OOMKilled: true }));
      expect(await container.isOomKilled()).toBe(true);
    });

    it("isPaused() returns true when paused", async () => {
      succeedWith(INSPECT_JSON({ Paused: true }));
      expect(await container.isPaused()).toBe(true);
    });

    it("isRestarting() returns true when restarting", async () => {
      succeedWith(INSPECT_JSON({ Restarting: true }));
      expect(await container.isRestarting()).toBe(true);
    });

    it("isHealthy() returns true when healthy", async () => {
      succeedWith(
        INSPECT_JSON({ Health: { Status: "healthy", FailingStreak: 0 } }),
      );
      expect(await container.isHealthy()).toBe(true);
    });

    it("isHealthy() returns false when unhealthy", async () => {
      succeedWith(
        INSPECT_JSON({ Health: { Status: "unhealthy", FailingStreak: 3 } }),
      );
      expect(await container.isHealthy()).toBe(false);
    });
  });

  describe("url()", () => {
    it("extracts port from config when ingress port exists", async () => {
      succeedWith(
        CONFIG_JSON([
          { published: 3000, target: 8080, protocol: "tcp", mode: "ingress" },
        ]),
      );
      expect(await container.url()).toBe("http://127.0.0.1:3000");
    });

    it("defaults to 8080 when no ingress port found", async () => {
      succeedWith(
        CONFIG_JSON([
          { published: 3000, target: 8080, protocol: "tcp", mode: "host" },
        ]),
      );
      expect(await container.url()).toBe("http://127.0.0.1:8080");
    });

    it("defaults to 8080 when ports array is empty", async () => {
      succeedWith(CONFIG_JSON([]));
      expect(await container.url()).toBe("http://127.0.0.1:8080");
    });
  });

  describe("serialize()", () => {
    it("returns container info with resolved url", async () => {
      succeedWith(
        CONFIG_JSON([
          { published: 9090, target: 8080, protocol: "tcp", mode: "ingress" },
        ]),
      );
      const info = await container.serialize();

      expect(info).toEqual({
        name: "test-container",
        service: "app",
        url: "http://127.0.0.1:9090",
      });
    });
  });

  describe("error propagation", () => {
    const error = new Error("docker not found");

    it("up() rejects when execFile fails", async () => {
      failWith(error);
      await expect(container.up()).rejects.toThrow("docker not found");
    });

    it("down() rejects when execFile fails", async () => {
      failWith(error);
      await expect(container.down()).rejects.toThrow("docker not found");
    });

    it("stats() rejects when execFile fails", async () => {
      failWith(error);
      await expect(container.stats()).rejects.toThrow("docker not found");
    });

    it("isRunning() rejects when execFile fails", async () => {
      failWith(error);
      await expect(container.isRunning()).rejects.toThrow("docker not found");
    });
  });

  describe("custom service name", () => {
    it("uses the provided service name in up()", async () => {
      succeedWith("");
      const custom = new Container(CWD, NAME, "worker");
      await custom.up();

      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        ["compose", "up", "--detach", "--wait", "worker"],
        expect.anything(),
        expect.any(Function),
      );
    });
  });
});
