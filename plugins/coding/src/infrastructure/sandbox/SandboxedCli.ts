// Start an operating-system process directly; spawn does not use a shell by default.
import { spawn } from "node:child_process";
// Use asynchronous filesystem checks: existence/access, entry metadata, and canonical paths.
import { access, lstat, realpath } from "node:fs/promises";
// Import only the TypeScript type; this import produces no runtime dependency.
import type { IExecutionContext } from "kushibot";

// Describe the result returned to callers. Readonly prevents property reassignment in TypeScript.
export type CliResult = Readonly<{
  exitCode: number | null;
  output: string;
  // True if some output bytes were discarded because the 16 KiB limit was reached.
  truncated: boolean;
  // True if this runner’s timer fired; cancellation alone does not set this flag.
  timedOut: boolean;
}>;

/** Linux namespace sandbox. No host-shell fallback is permitted. */
// Expose the sandbox runner to other modules; each run creates a separate process.
export class SandboxedCli {
  // Maximum command runtime in milliseconds; an earlier context deadline still takes precedence.
  private readonly executionTimeoutMs = 45_000;

  // Maximum combined stdout/stderr bytes retained before UTF-8 decoding.
  private readonly maxOutputBytes = 16_384;

  // Run one command asynchronously and resolve with its exit information.
  async run(
    // Host directory to expose as /workspace inside the sandbox.
    directory: string,
    // Executable followed by arguments, for example ["git", "status"]; shell syntax is not interpreted here.
    command: readonly string[],
    // Choose whether the workspace mount permits writes.
    readOnly: boolean,
    // Supply the cancellation signal and optional absolute execution deadline.
    context: IExecutionContext,
  // The caller receives a Promise because filesystem checks and process execution are asynchronous.
  ): Promise<CliResult> {
    // Fail closed on unsupported operating systems instead of running the command without isolation.
    if (process.platform !== "linux")
      // Reject the async call with an explanatory error.
      throw new Error(
        // Tell callers which environment is required to run this CLI.
        "The coding CLI requires Linux with Bubblewrap; use the Kushex backend container.",
      );
    // Check that Bubblewrap exists and is accessible; this does not prove it is executable or namespaces are permitted.
    await access("/usr/bin/bwrap");
    // Stop before preparing the sandbox if cancellation has already been requested.
    context.signal.throwIfAborted();
    // Resolve the workspace to its canonical absolute host path, following symlinks.
    const root = await realpath(directory);
    // Build Bubblewrap arguments. Option values are separate array entries, not shell-quoted text.
    const args = [
      // Create all namespaces supported by Bubblewrap, including network isolation.
      "--unshare-all",
      // Explicitly request a separate user namespace as well.
      "--unshare-user",
      // Ask the kernel to terminate Bubblewrap when its parent dies.
      "--die-with-parent",
      // Start a new terminal session inside the sandbox to isolate terminal control.
      "--new-session",
      // Drop the Linux capabilities named by the next argument.
      "--cap-drop",
      // Remove every capability from the sandboxed command.
      "ALL",
      // Clear the sandbox command environment before adding explicit variables below.
      "--clearenv",
      // Mount a host path read-only; the next two entries are source and destination.
      "--ro-bind",
      // Host source or sandbox destination for the read-only system tools and libraries mount.
      "/usr",
      // Host source or sandbox destination for the read-only system tools and libraries mount.
      "/usr",
      // Create a sandbox symlink; the next entries are its target and its location.
      "--symlink",
      // Relative symlink target inside the sandbox: /usr/bin.
      "usr/bin",
      // Expose /bin as a link to /usr/bin.
      "/bin",
      // Create a sandbox symlink; the next entries are its target and its location.
      "--symlink",
      // Relative symlink target inside the sandbox: /usr/sbin.
      "usr/sbin",
      // Expose /sbin as a link to /usr/sbin.
      "/sbin",
      // Create a sandbox symlink; the next entries are its target and its location.
      "--symlink",
      // Relative symlink target inside the sandbox: /usr/lib.
      "usr/lib",
      // Expose /lib as a link to /usr/lib.
      "/lib",
      // Create a sandbox symlink; the next entries are its target and its location.
      "--symlink",
      // Relative symlink target inside the sandbox: /usr/lib64.
      "usr/lib64",
      // Expose /lib64 as a link to /usr/lib64.
      "/lib64",
      // Create an empty directory at the following sandbox path.
      "--dir",
      // Create only a directory here; this code does not mount a proc filesystem.
      "/proc",
      // Create Bubblewrap’s minimal device filesystem at the following path.
      "--dev",
      // Location of the sandbox’s minimal device filesystem.
      "/dev",
      // Mount a fresh temporary in-memory filesystem at the following path.
      "--tmpfs",
      // Use the sandbox’s temporary filesystem for temporary files.
      "/tmp",
      // Create an empty directory at the following sandbox path.
      "--dir",
      // Use an isolated home directory inside the sandbox.
      "/home/sandbox",
      // Mount the workspace read-only or writable according to this call’s mode.
      readOnly ? "--ro-bind" : "--bind",
      // Use the resolved host workspace as the bind-mount source.
      root,
      // Workspace mount destination, also used below as the command’s working directory.
      "/workspace",
      // Set the environment variable named next to the value after it.
      "--setenv",
      // Name of the executable-search-path environment variable.
      "PATH",
      // Search only these sandbox paths for executable names.
      "/usr/local/bin:/usr/bin:/bin",
      // Set the environment variable named next to the value after it.
      "--setenv",
      // Name of the home-directory environment variable.
      "HOME",
      // Use an isolated home directory inside the sandbox.
      "/home/sandbox",
      // Set the environment variable named next to the value after it.
      "--setenv",
      // Name of the preferred temporary-directory environment variable.
      "TMPDIR",
      // Use the sandbox’s temporary filesystem for temporary files.
      "/tmp",
      // Set the environment variable named next to the value after it.
      "--setenv",
      // Name of the default locale environment variable.
      "LANG",
      // Request the C locale with UTF-8 text encoding.
      "C.UTF-8",
      // Set the command’s initial working directory to the next path.
      "--chdir",
      // Workspace mount destination, also used below as the command’s working directory.
      "/workspace",
    ];
    // Dependencies can be executed/read but are never part of the editable scope.
    // Check for dependencies so they can receive a separate read-only mount.
    try {
      // Inspect the node_modules entry itself without following a final symlink.
      const stat = await lstat(`${root}/node_modules`);
      // Accept only an actual directory; reject files and symbolic links.
      if (!stat.isDirectory() || stat.isSymbolicLink())
        // Reject an unexpected dependency layout instead of mounting it.
        throw new Error("node_modules must be a real workspace directory.");
      // Overlay node_modules read-only even when the rest of /workspace is writable.
      args.push("--ro-bind", `${root}/node_modules`, "/workspace/node_modules");
    // Handle a missing dependency directory separately from invalid layouts and other filesystem errors.
    } catch (error) {
      // Ignore only “entry not found”; the type assertion helps TypeScript and performs no runtime conversion.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // End Bubblewrap option parsing, then append the executable and its arguments unchanged.
    args.push("--", ...command);
    // Calculate the allowed process runtime in milliseconds.
    const remaining =
      // A null deadline means the caller supplied no absolute deadline.
      context.deadlineEpochMs === null
        // Without a caller deadline, use the class’s maximum execution time.
        ? this.executionTimeoutMs
        // Otherwise use the smaller of the class limit and the time remaining before the caller’s deadline.
        : Math.min(this.executionTimeoutMs, context.deadlineEpochMs - Date.now());
    // Reject an already-expired deadline before launching a process.
    if (remaining <= 0) throw new Error("CLI deadline exceeded.");
    // Translate child-process events into a Promise: launch errors reject, process closure resolves.
    return new Promise((resolve, reject) => {
      // Launch Bubblewrap directly with the constructed argument list.
      const child = spawn("/usr/bin/bwrap", args, {
        // Pass no inherited host environment to Bubblewrap; explicit --setenv options define the command environment.
        env: {},
        // Create a separate process group/session so the runner can kill the process group.
        detached: true,
        // Provide no stdin and capture both stdout and stderr through pipes.
        stdio: ["ignore", "pipe", "pipe"],
      });
      // Start with an empty byte buffer; cap retained bytes before decoding text.
      let output = Buffer.alloc(0);
      // Track whether any received output exceeds the retained-byte limit.
      let truncated = false;
      // Track whether the runtime timer, specifically, requested termination.
      let timedOut = false;
      // Define a termination helper shared by timeout, cancellation, and cleanup.
      const stop = () => {
        // A failed spawn may have no PID, leaving no process to terminate.
        if (!child.pid) return;
        // Attempt to terminate the whole process group first.
        try {
          // On Linux, a negative PID targets the process group; SIGKILL cannot be caught or ignored.
          process.kill(-child.pid, "SIGKILL");
        // Handle a process group that disappeared or could not be signaled.
        } catch (error) {
          // ESRCH means the target is already gone; for other errors, try killing the direct child.
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill("SIGKILL");
        }
      };
      // Schedule forced termination after the computed runtime budget.
      const timer = setTimeout(() => {
        // Record the timeout before requesting termination so the result reports its cause.
        timedOut = true;
        // Request termination using the shared process-group helper.
        stop();
      // Use the computed millisecond budget as the timer delay.
      }, remaining);
      // Terminate on cancellation; once removes this listener automatically after it fires.
      context.signal.addEventListener("abort", stop, { once: true });
      // Cover cancellation that happened after the earlier check but before the listener was attached.
      if (context.signal.aborted) stop();
      // Handle a chunk from either output stream; chunks are collected in event-delivery order.
      const collect = (data: Buffer) => {
        // Retain bytes up to the class’s output limit; never let remaining capacity become negative.
        const available = Math.max(0, this.maxOutputBytes - output.length);
        // Mark output as truncated if this chunk contains bytes that will not fit.
        if (data.length > available) truncated = true;
        // Append only the portion that fits; keep draining later chunks so full pipes do not block the process.
        output = Buffer.concat([output, data.subarray(0, available)]);
      };
      // Collect standard output using the shared byte limit.
      child.stdout.on("data", collect);
      // Collect standard error into the same buffer; stream identity is not preserved.
      child.stderr.on("data", collect);
      // Release runner resources when spawning fails or the process and its output streams close.
      const cleanup = () => {
        // Cancel the timer so it cannot fire after execution finishes.
        clearTimeout(timer);
        // Remove the cancellation listener to avoid retaining the completed execution.
        context.signal.removeEventListener("abort", stop);
        // Request termination using the shared process-group helper.
        stop();
      };
      // Handle failures to start or manage the child process.
      child.on("error", (error) => {
        // Clear timer/listener resources and attempt to stop any remaining process-group members.
        cleanup();
        // Reject with the process error rather than returning an ordinary CLI result.
        reject(error);
      });
      // Wait for process termination and closure of its stdio streams before returning captured output.
      child.on("close", (exitCode) => {
        // Clear timer/listener resources and attempt to stop any remaining process-group members.
        cleanup();
        // Return the exit status and flags; UTF-8 decoding may use a replacement character if truncation split a character.
        resolve({ exitCode, output: output.toString("utf8"), truncated, timedOut });
      });
    });
  }
}
