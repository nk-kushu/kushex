# Local agent plugins

Place each installed plugin in a subdirectory containing `kushex-plugin.json`,
then restart the server. See [the agent guide](../agents/README.md#local-plugins)
for the manifest, runtime contract and dependency setup.

This directory is mounted at `/plugins` by the standalone Docker configuration.
For another location, set `KUSHEX_PLUGINS_DIR` (and mount it when using Docker).
