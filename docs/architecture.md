# CoinGabbarSignals — Architecture

> Status: Part 01 foundation. Standalone application. It shares **no** UI, design, routes, or code with the legacy CoinGabbar app.

## 1. Repository inspection findings
| Item | Finding |
|---|---|
| Existing repo / git | None (empty workspace) |
| Framework / build system | None → chosen: React 18 + Vite (web), Express + TypeScript (API) |
| Package manager | None → npm (Node 22 LTS, `.nvmrc`) |
| Existing routes / folders / backend / DB | None found — nothing to reuse or conflict with |
| Deployment environment | Undetermined → target is container/PaaS-agnostic: static web bundle + one Node service + Postgres |

## 2. Folder layout
```
/src        Frontend SPA (React, Vite). Browser-only code.
/server     Backend API + signal engine host (Node). Server-only code.
/shared     Dependency-free contracts (types, constants) used by both sides.
/database   SQL migrations + DEMO seeds.
/tests      Vitest suites (unit + API).
/assets     Static brand assets.
/docs       Planning documents.
```

## 3. Frontend / backend separation
- **Two deployables**: `dist/web` (static files, any CDN) and `dist/server` (Node process). They communicate only via HTTP/JSON (+ SSE for streaming) under `/api/v1`.
- **Hard import boundary** enforced by ESLint `no-restricted-imports`: `src/**` cannot import `server/**`, `server/**` cannot import `src/**`. Both may import `shared/**`.
- `shared/` contains **types and constants only** (no runtime deps, no `window`, no `process`).
- Separate tsconfigs: `tsconfig.app.json` (DOM, Bundler resolution), `tsconfig.server.json` (Node, NodeNext), `tsconfig.tests.json`.
- The frontend holds **no secrets**. Only `VITE_*` values are bundled and they are public by definition.
- The server is the single authority on data mode, signal generation, scoring and persistence. The client renders; it never computes signals.

## 4. Runtime topology
```
Browser (SPA) ──HTTPS──▶ /api/v1 (Express) ──▶ Signal Engine (in-process worker, later separable)
                                   │                 │
                                   ▼                 ▼
                              Postgres         Market data provider
                                              (synthetic | real)
```
The signal engine starts in-process behind an interface so it can be moved to a dedicated worker without API changes.

## 5. Environment variables
Validated at boot by `server/config/env.ts` (zod). Invalid config = process refuses to start.

| Variable | Scope | Purpose | Notes |
|---|---|---|---|
| `APP_ENV` | server | `development` \| `staging` \| `production` | default `development` |
| `DATA_MODE` | server | default data mode | must be in `ALLOWED_DATA_MODES` |
| `ALLOWED_DATA_MODES` | server | comma list of modes clients may request | filtered by env policy |
| `LIVE_MODE_CONFIRM` | server | must equal `I_UNDERSTAND_LIVE_DATA` to enable LIVE | production only |
| `SERVER_HOST` / `SERVER_PORT` | server | bind address | `127.0.0.1:8787` |
| `CORS_ORIGINS` | server | allowed browser origins | comma list |
| `LOG_LEVEL` | server | `debug`…`error` | |
| `DATABASE_URL` | server | Postgres connection | required for PAPER/LIVE outside dev |
| `SESSION_SECRET` | server | ≥32 chars | required in staging/production |
| `MARKET_DATA_PROVIDER` | server | `synthetic` or a real provider id | |
| `MARKET_DATA_API_KEY` | server | provider credential | required if provider ≠ synthetic |
| `SIGNAL_ENGINE_INTERVAL_MS` | server | engine tick | min 1000 |
| `VITE_API_BASE_URL` | web | API origin | public |
| `VITE_APP_ENV` | web | environment label | public, cosmetic only |

## 6. Environments
| | development | staging | production |
|---|---|---|---|
| Purpose | local work | pre-release verification, prod-like | real users |
| Allowed modes | DEMO, PAPER | DEMO, PAPER | DEMO, PAPER, LIVE |
| Default mode | DEMO | PAPER (or DEMO) | PAPER or LIVE (explicit) |
| Database | optional (DEMO needs none) | required, isolated instance | required, backed up |
| Secrets | `.env` (git-ignored) | platform secret store | platform secret store |
| Market data | synthetic or real | real (sandbox keys) | real |
| LIVE possible | **No** | **No** | Yes, with `LIVE_MODE_CONFIRM` |
| Deploy | manual | auto on `main` | manual promotion of staging build |

Rule: a build artifact is environment-agnostic; behaviour is driven only by env vars. Staging and production **never share** a database or secrets.

## 7. Data modes
| Mode | Market data | Execution / portfolio | Persistence | Requires |
|---|---|---|---|---|
| **DEMO** | Synthetic, seeded, deterministic | None (signals only) | Optional / ephemeral | nothing |
| **PAPER** | Real | Virtual accounts, simulated fills | Postgres | DB, provider key |
| **LIVE** | Real | Real-world signal publication; any future execution stays opt-in and out of scope | Postgres | DB, provider key, production, confirm phrase |

Guarantees:
1. Every mode-scoped row and API response carries an explicit `data_mode`. Modes never mix in one query result.
2. UI always shows the active mode badge; DEMO/PAPER output can never be presented as LIVE.
3. Client may request a mode via `X-Data-Mode`, only among `ALLOWED_DATA_MODES`; otherwise `403 mode_not_allowed`.
4. Switching to LIVE is an env-level decision, never a UI toggle.

## 8. Tooling
`npm run dev:web`, `dev:server`, `build`, `typecheck`, `lint`, `test`. CI runs `typecheck → lint → test → build`.

## 9. Out of scope for Part 01
Dashboard UI, DB migrations, signal engine logic, auth, real provider adapters.

## 10. Part 02 additions
Product IA lives in `information-architecture.md`, `navigation.md`, `user-flows.md` and the generated `routes.md`. The route/navigation registry (`shared/routes.ts`, `shared/navigation.ts`) is shared by web and server; `npm run docs:routes` regenerates `routes.md` and a test fails if it drifts.
