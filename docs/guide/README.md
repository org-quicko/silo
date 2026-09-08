# silo guides

How to run, configure and extend silo. The [root README](../../README.md) is the
short version. For the reasons behind a design, read `../design/`.

| Guide | What it covers |
|-------|----------------|
| [configuration.md](configuration.md) | `silo.toml`, the `SILO_*` variables, schema references, and running as a service |
| [cli.md](cli.md) | Every subcommand and every flag |
| [http-api.md](http-api.md) | The routes, the query AST, search, and the error shape |
| [claims.md](claims.md) | The claim catalog, wildcards, delegation, and public reads |
| [plugins.md](plugins.md) | Write a plugin, enable it, install it, inspect it |
| [transfer.md](transfer.md) | Export, import, server copy, and the on-disk layout |
| [deployment.md](deployment.md) | Docker, systemd, and volumes |

The admin UI has its own README in [apps/admin/](../../apps/admin/README.md).
