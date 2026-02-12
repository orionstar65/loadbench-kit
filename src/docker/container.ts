import { execFile } from "child_process";

import type {
  DockerStatsResult,
  DockerInspectResult,
  DockerContainerState,
  DockerComposeConfigResult,
  DockerComposeServiceResult,
} from "loadbench-kit/docker/models.js";
import usage, { type Usage } from "loadbench-kit/docker/usage.js";

const LOCALHOST = "127.0.0.1";

/**
 * Extended Docker stats with parsed sub-fields.
 *
 * Docker CLI returns `MemUsage`, `BlockIO`, and `NetIO` as slash-delimited
 * strings (e.g. `"120MiB / 1GiB"`). This type replaces those raw strings
 * with structured {@link Usage} objects so callers can compare values
 * numerically without additional parsing.
 *
 * @property MemUsage.Usage - Current memory consumption of the container.
 * @property MemUsage.Limit - Memory limit imposed on the container.
 * @property BlockIO.Read  - Cumulative bytes read from block devices.
 * @property BlockIO.Write - Cumulative bytes written to block devices.
 * @property NetIO.Read    - Cumulative bytes received over the network.
 * @property NetIO.Write   - Cumulative bytes transmitted over the network.
 */
export type StatsResult = DockerStatsResult & {
  MemUsage: { Usage: Usage; Limit: Usage };
  BlockIO: { Read: Usage; Write: Usage };
  NetIO: { Read: Usage; Write: Usage };
};

/**
 * Serializable snapshot of a container's identity and network location.
 *
 * Worker threads cannot receive class instances over the `workerData` channel,
 * so {@link Container.serialize} produces this plain object that workers can
 * use to issue HTTP requests against the running container.
 *
 * @property name    - Docker container name (used for `docker inspect`/`stats`).
 * @property service - Docker Compose service name.
 * @property url     - Resolved `http://127.0.0.1:<port>` base URL.
 */
export interface ContainerInfo {
  name: string;
  service: string;
  url: string;
}

/**
 * @class Container @implements AsyncDisposable
 *
 * Container class is a wrapper around the `docker` and `docker compose`
 * commands to help manage the life-cycle of a Container under performance
 * testing.
 *
 * @example
 *
 *   await using container = new Container(
 *     process.cwd(),
 *     "my-container",
 *     "app-service",
 *   ).up();
 *   console.log(await container.stats());
 *
 */
export default class Container {
  constructor(
    private readonly cwd: string,
    private readonly name: string,
    private readonly service: string = "app",
  ) {}

  /**
   * Start the container via `docker compose up --detach --wait`.
   *
   * @param env - Optional environment variables merged with `process.env` and
   *              forwarded to the Compose process.
   * @returns Resolves when the container is running and healthy.
   */
  async up(env?: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        "docker",
        ["compose", "up", "--detach", "--wait", this.service],
        {
          cwd: this.cwd,
          env: { ...process.env, ...env },
        },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  /**
   * Tear down the container and its network via `docker compose down`.
   *
   * @returns Resolves when all Compose resources have been removed.
   */
  async down(): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile("docker", ["compose", "down"], { cwd: this.cwd }, (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }

  /**
   * Retrieve the full Docker Compose configuration as JSON.
   *
   * Runs `docker compose config --format=json` and parses the output.
   *
   * @returns The parsed Compose config including services, volumes, and networks.
   */
  private async config(): Promise<DockerComposeConfigResult> {
    return new Promise((resolve, reject) => {
      execFile(
        "docker",
        ["compose", "config", "--format=json"],
        { cwd: this.cwd },
        (error, stdout) => {
          return error ? reject(error) : resolve(JSON.parse(stdout.trim()));
        },
      );
    });
  }

  /**
   * Fetch a single snapshot of container resource usage via `docker stats`.
   *
   * The raw Docker output encodes memory, block I/O, and network I/O as
   * human-readable slash-delimited strings. This method splits each string
   * on `"/"` and parses both halves into structured {@link Usage} objects.
   *
   * @returns Parsed stats with numeric memory, block I/O, and network I/O.
   */
  async stats(): Promise<StatsResult> {
    return new Promise<DockerStatsResult>((resolve, reject) =>
      execFile(
        "docker",
        ["stats", this.name, "--no-stream", "--format=json"],
        { cwd: this.cwd },
        (error, stdout) => {
          if (error) return reject(error);
          const parsed = JSON.parse(stdout.trim());
          return resolve(Array.isArray(parsed) ? parsed[0] : parsed);
        },
      ),
    ).then((stats) => {
      // Split "120MiB / 1GiB" style strings on "/" into [left, right] halves
      const [memoryUsage, memoryLimit] = stats.MemUsage.split("/");
      const [blockRead, blockWrite] = stats.BlockIO.split("/");
      const [netRead, netWrite] = stats.NetIO.split("/");

      // Replace the raw string fields with parsed Usage objects
      return Object.assign(stats, {
        MemUsage: {
          Usage: usage.parse(memoryUsage),
          Limit: usage.parse(memoryLimit),
        },
        BlockIO: {
          Read: usage.parse(blockRead),
          Write: usage.parse(blockWrite),
        },
        NetIO: {
          Read: usage.parse(netRead),
          Write: usage.parse(netWrite),
        },
      }) as StatsResult;
    });
  }

  /**
   * Non-throwing variant of {@link stats}.
   *
   * Returns `null` instead of rejecting when Docker stats are unavailable,
   * so callers that treat stats as best-effort don't need try/catch boilerplate.
   *
   * @returns Parsed stats, or `null` if the call fails for any reason.
   */
  async statsSafe(): Promise<StatsResult | null> {
    try {
      return await this.stats();
    } catch {
      return null;
    }
  }

  /**
   * Run `docker inspect` and return the full inspection payload.
   *
   * The result includes the container's current {@link DockerContainerState},
   * which exposes health, OOM, pause, and restart status flags used by the
   * convenience query methods (`isRunning`, `isHealthy`, etc.).
   *
   * @returns The parsed `docker inspect` JSON for this container.
   */
  private async inspect(): Promise<DockerInspectResult> {
    return new Promise((resolve, reject) => {
      execFile(
        "docker",
        ["inspect", this.name, "--format=json"],
        { cwd: this.cwd },
        (error, stdout) => {
          if (error) return reject(error);
          const parsed = JSON.parse(stdout.trim());
          return resolve(Array.isArray(parsed) ? parsed[0] : parsed);
        },
      );
    });
  }

  /**
   * Retrieve the container's current runtime state from `docker inspect`.
   *
   * @returns The {@link DockerContainerState} sub-object of the inspect result.
   */
  private async state(): Promise<DockerContainerState> {
    return this.inspect().then((inspect) => inspect.State);
  }

  /** @returns `true` if the container is in the `running` state. */
  async isRunning(): Promise<boolean> {
    return this.state().then((state) => state.Running);
  }

  /** @returns `true` if the container was terminated by the OOM killer. */
  async isOomKilled(): Promise<boolean> {
    return this.state().then((state) => state.OOMKilled);
  }

  /** @returns `true` if the container is currently paused. */
  async isPaused(): Promise<boolean> {
    return this.state().then((state) => state.Paused);
  }

  /** @returns `true` if the container is in the middle of a restart. */
  async isRestarting(): Promise<boolean> {
    return this.state().then((state) => state.Restarting);
  }

  /** @returns `true` if the container health-check reports `"healthy"`. */
  async isHealthy(): Promise<boolean> {
    return this.state().then((state) => state.Health.Status === "healthy");
  }

  /**
   * Retrieve the Docker Compose service configuration for this container's
   * service (image, ports, etc.).
   *
   * @returns The service definition from `docker compose config`.
   */
  async serviceConfig(): Promise<DockerComposeServiceResult> {
    return this.config().then((config) => config.services[this.service]);
  }

  /**
   * @function url
   * Get the LOCALHOST URL of the container by finding the ingress port in the
   * `docker compose config`.
   */
  async url(): Promise<string> {
    const port = await this.serviceConfig()
      .then(({ ports }) => ports.find((port) => port.mode === "ingress"))
      .then((port) => port?.published);

    return `http://${LOCALHOST}:${port ?? 8080}`;
  }

  /**
   * Produce a plain-object snapshot of this container that can be safely
   * transferred to worker threads via `workerData`.
   *
   * @returns A {@link ContainerInfo} containing the container name, service,
   *          and resolved localhost URL.
   */
  async serialize(): Promise<ContainerInfo> {
    return {
      name: this.name,
      service: this.service,
      url: await this.url(),
    };
  }
}
