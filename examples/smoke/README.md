# Maho smoke example

Minimal host + 1 remote workspace for manually verifying `@maho/cli`.

This example is **not part of the monorepo workspace** (it has its own
`pnpm-workspace.yaml`) so it stays out of `pnpm -r run typecheck`.

## Usage

From this directory:

```bash
pnpm install
pnpm dev
```

The host is configured via `config/config.yml` only — `vite.config.ts`
is hidden behind `@maho/cli`, which loads the boot adapter declared by
`boot: "@maho/boot-vue"` and composes the plugin stack at runtime.

Expected output:

```
[module-home] ready: http://127.0.0.1:5174/
[smoke-host]  ready: http://127.0.0.1:5173/
All services ready: ...
```

Open `http://127.0.0.1:5173/` in a browser. The root path redirects to
`/home/` (provided by `module-home` via federation) and the nav strip
links to three demo pages:

| Path             | Source                            | Purpose                                                |
|------------------|-----------------------------------|--------------------------------------------------------|
| `/home/`         | `module-home/src/pages/Home.vue`  | Smoke landing page                                     |
| `/home/about`    | `module-home/src/pages/About.vue` | Static About page                                      |
| `/home/counter`  | `module-home/src/pages/Counter.vue` | Pinia store — verifies shared-singleton survives nav |

The remote runs in `build + preview` mode (no HMR) because
`@originjs/vite-plugin-federation` only emits `remoteEntry.js` during
`vite build`. Edit remote source → restart `pnpm dev`.

Press `Ctrl+C` to stop — all child processes should exit cleanly.
