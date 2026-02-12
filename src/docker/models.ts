/**
 * Raw JSON output from `docker stats --format=json`.
 *
 * String fields (`MemUsage`, `BlockIO`, `NetIO`) contain slash-delimited
 * human-readable values (e.g. `"120MiB / 1GiB"`) that must be parsed
 * before numeric comparison. See {@link StatsResult} in `container.ts`
 * for the parsed variant.
 *
 * @property ID       - Short container ID.
 * @property Name     - Container name.
 * @property Container - Full container ID.
 * @property PIDs     - Number of running processes.
 * @property CPUPerc  - CPU usage percentage.
 * @property MemPerc  - Memory usage percentage.
 * @property MemUsage - Raw memory usage string (e.g. `"120MiB / 1GiB"`).
 * @property BlockIO  - Raw block I/O string (e.g. `"1.2GB / 500MB"`).
 * @property NetIO    - Raw network I/O string (e.g. `"50MB / 10MB"`).
 */
export interface DockerStatsResult {
  ID: string;
  Name: string;
  Container: string;
  PIDs: number;
  CPUPerc: number;
  MemPerc: number;
  MemUsage: string;
  BlockIO: string;
  NetIO: string;
}

/**
 * Possible lifecycle states of a Docker container as reported by the
 * Docker Engine API.
 */
export type DockerContainerStatus =
  | "created"
  | "running"
  | "paused"
  | "restarting"
  | "removing"
  | "exited"
  | "dead";

/**
 * Health-check status values reported by `docker inspect`.
 *
 * - `"none"`      -- No health-check configured.
 * - `"starting"`  -- Health-check has not yet passed.
 * - `"healthy"`   -- Health-check is passing.
 * - `"unhealthy"` -- Health-check is failing.
 */
export type DockerHealthStatus = "none" | "starting" | "healthy" | "unhealthy";

/**
 * Runtime state of a Docker container, extracted from `docker inspect`.
 *
 * Contains boolean flags for common status checks and nested health
 * information when a HEALTHCHECK is defined in the image.
 */
export interface DockerContainerState {
  Status: DockerContainerStatus;
  Running: boolean;
  OOMKilled: boolean;
  Paused: boolean;
  Restarting: boolean;
  StartedAt: Date;
  FinishedAt: Date;
  Pid: number;
  ExitCode: number;
  Error: string;
  Health: { Status: DockerHealthStatus; FailingStreak: number };
}

/**
 * Subset of the full `docker inspect` JSON relevant to performance testing.
 *
 * Includes identity fields, image metadata, and the container's runtime
 * {@link DockerContainerState}.
 */
export interface DockerInspectResult {
  ID: string;
  Created: Date;
  Path: string;
  Args: string[];
  Image: string;
  Name: string;
  RestartCount: number;
  Driver: string;
  Platform: string;
  State: DockerContainerState;
}

/**
 * A single service definition within a Docker Compose configuration.
 *
 * Used primarily to discover the published port for building the container's
 * localhost URL, but also exposes build context, resource limits, and
 * environment variables for test reporting.
 */
export interface DockerComposeServiceResult {
  image?: string;
  build?: {
    context: string;
    dockerfile?: string;
  };
  deploy?: {
    resources?: {
      limits?: { memory?: string; cpus?: string };
      reservations?: { memory?: string; cpus?: string };
    };
  };
  environment?: Record<string, string>;
  ports: {
    published: number;
    target: number;
    protocol: string;
    mode: string;
  }[];
}

/**
 * Top-level output of `docker compose config --format=json`.
 *
 * Provides the fully resolved Compose file including all services, volumes,
 * networks, and secrets.
 */
export interface DockerComposeConfigResult {
  name: string;
  version: string;
  services: Record<string, DockerComposeServiceResult>;
  volumes: Record<string, DockerComposeVolumeResult>;
  networks: Record<string, DockerComposeNetworkResult>;
  secrets: Record<string, DockerComposeSecretResult>;
}

/** A volume entry from the Docker Compose configuration. */
export interface DockerComposeVolumeResult {
  name: string;
  driver: string;
  driver_opts: Record<string, string>;
  external: boolean;
}

/** A network entry from the Docker Compose configuration. */
export interface DockerComposeNetworkResult {
  name: string;
  ipam: unknown;
}

/** A secret entry from the Docker Compose configuration. */
export interface DockerComposeSecretResult {
  name: string;
  file: string;
}
