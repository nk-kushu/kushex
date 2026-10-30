# CLI sandbox syscall profile

`cli-seccomp.json` derives from the [Moby standard seccomp profile](https://github.com/moby/profiles/blob/main/seccomp/default.json), retrieved on 2026-10-29. The upstream profile is licensed under [Apache-2.0](https://github.com/moby/profiles/blob/main/LICENSE).

The default action remains `SCMP_ACT_ERRNO`, and the standard architecture mappings
and other syscall rules are retained. Bubblewrap additionally needs `unshare`, `mount`,
`umount2`, `pivot_root`, `setns`, `clone`, and `clone3` to create its namespaces and mount
tree without granting the backend `SYS_ADMIN` or privileged-container access. The
conditional `clone` rules and `clone3` compatibility rejection are replaced by the
explicit allow rule for these calls. Docker's masked paths and read-only `/proc/sys`
remain enabled. The CLI leaves `/proc` empty rather than relaxing those protections.

This profile applies to the backend container. Inside each CLI invocation Bubblewrap
creates separate namespaces, exposes only its system runtime and workspace, drops
capabilities, clears the environment, and isolates the network. The profile does not
replace that filesystem/process sandbox.

`compose.standalone.yml` applies this profile to the backend; the development override
inherits it. Hosts must support unprivileged user namespaces and may need host-specific
AppArmor configuration. No automatic fallback relaxes a host's security settings.

Run `pnpm test:agent:coding:container` to verify the actual integration and escape tests.
The second container deliberately uses Docker's default profile and verifies that a
blocked sandbox does not execute the command outside isolation.
