# silo — Architectural Ideas Scratchpad

**Status:** Living Document / Ideas Sandbox  
**Purpose:** A structured scratchpad for exploring, vetting, and refining architectural proposals before promoting them to [`IMPLEMENTATION.md`](file:///Users/nachiketa/code/something/silo/IMPLEMENTATION.md).

---

## 1. Cloud Deployment & One-Click Hosting Strategy

Goal: Make Silo effortlessly deployable anywhere—from local Docker environments to AWS (EC2/Lambda/App Runner) and 1-click cloud PaaS platforms.

### 1.1 AWS CloudFormation "Launch Stack" Button
- **Idea:** Provide a native AWS CloudFormation template (`aws-cloudformation-template.yaml`) and embed a standard AWS Launch Stack URL button in the `README.md`.
- **Target Architecture:**
  - **Option A (Lightweight EC2):** Provisions an EC2 t4g.micro instance with Docker pre-installed via `UserData`, mounting a persistent EBS volume to `/data`.
  - **Option B (App Runner / ECS Fargate):** Spins up AWS App Runner or ECS Fargate pointing to the Silo Docker container, mounting AWS EFS for storage.
- **Pros:** Native AWS 1-click experience for AWS users without needing external tools.
- **Cons:** CloudFormation templates require maintenance as AWS services evolve.

### 1.2 PaaS One-Click Deploy Buttons (Render, Railway, Fly.io)
- **Idea:** Include `Deploy to Render`, `Deploy to Railway`, and `Deploy to Fly.io` buttons.
- **Why these over Netlify/Vercel:** Render, Railway, and Fly.io natively support Docker containers with persistent disk volumes mounted at `SILO_STORAGE_PATH=/data`.
- **Status:** Requires minimal config files (`render.yaml`, `railway.json`, `fly.toml`).

---

## 2. Decoupled State & Remote Storage Adapters

Goal: Enable Silo to run in stateless serverless environments (AWS Lambda, Netlify Functions, Cloud Run) by decoupling the storage layer from local disk files (`/data`).

### 2.1 Managed Cloud SQLite / libSQL Adapter (Turso) ⭐ *(High Priority)*
- **Idea:** Add a Turso/libSQL driver (`libsql://`) to the existing SQLite storage adapter ([`server/adapters/storage/sqlite/sqlite-store.ts`](file:///Users/nachiketa/code/something/silo/server/adapters/storage/sqlite/sqlite-store.ts)).
- **Mechanism:** Uses `@libsql/client` over HTTP/WebSockets instead of local `bun:sqlite` disk files.
- **Pros:**
  - Zero changes to SQL queries or schema validation logic.
  - Generous free tier (9GB DB, 1B read rows/mo).
  - Unlocks instant stateless serverless deployments (AWS Lambda, Vercel, Netlify).
- **Triggers:** `SILO_STORAGE_DRIVER=turso` with `TURSO_URL` & `TURSO_TOKEN`.

### 2.2 S3 / Cloudflare R2 Object Storage Adapter
- **Idea:** Implement an S3-compatible driver (`server/adapters/storage/s3/s3-store.ts`) implementing the [`Storage`](file:///Users/nachiketa/code/something/silo/server/core/ports/storage.ts#L5-L22) interface.
- **Mechanism:**
  - Maps collections and entry IDs to object keys (`${collection}/${id}.json`).
  - `put` $\rightarrow$ `s3.putObject()`, `get` $\rightarrow$ `s3.getObject()`, `list` $\rightarrow$ `s3.listObjectsV2()`.
- **Pros:** Works with AWS S3, Cloudflare R2 (zero egress fees), MinIO, or DigitalOcean Spaces.
- **Cons:** S3 `list` queries can be slower than relational indexes without an in-memory or metadata index cache.

### 2.3 Serverless PostgreSQL Adapter (Neon / Supabase)
- **Idea:** Create a PostgreSQL adapter for high-concurrency enterprise deployments.
- **Mechanism:** Uses HTTP serverless drivers like `@neondatabase/serverless` to bypass connection pooling limits in serverless functions.

### 2.4 Dynamic Storage Adapter Factory Pattern
- **Idea:** Unify driver selection in `server/adapters/storage/storage-factory.ts`.
- **Behavior:**
  - Default: `sqlite` (Local disk file `./silo_data/silo.db` — fast dev experience).
  - Production Overrides: `turso`, `s3`, `postgres`, `fs` via `SILO_STORAGE_DRIVER`.

---

## 3. Serverless & AWS Lambda Compatibility

Goal: Evaluate execution models for running Silo on serverless compute.

### 3.1 Hono Serverless Adapters
- **Idea:** Hono has built-in adapters for `@hono/aws-lambda`, `@hono/netlify`, and `@hono/vite-dev-server`.
- **Requirement:** Must be coupled with a decoupled state backend (§2.1 Turso or §2.2 S3/R2), because Lambda functions are ephemeral and lose local disk storage on cold starts.
- **Trade-offs:**
  - **Pros:** Scale-to-zero pricing, automatic global distribution.
  - **Cons:** Cold-start latency; background sync operations cannot run indefinitely.

---

## 4. Evaluation Matrix: Storage Backends vs Deployment Targets

| Storage Driver | Local Dev | Docker / EC2 | AWS App Runner | AWS Lambda | Netlify / Vercel |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `sqlite` (Local file) | ✅ Default | ✅ Volume | ⚠️ Needs EFS | ❌ No persistent disk | ❌ No persistent disk |
| `fs` (Filesystem) | ✅ Supported | ✅ Volume | ⚠️ Needs EFS | ❌ No persistent disk | ❌ No persistent disk |
| `turso` (Cloud SQLite)| ✅ Supported | ✅ Supported | ✅ Supported | ✅ Ideal | ✅ Ideal |
| `s3` (R2 / AWS S3) | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Ideal | ✅ Ideal |
| `postgres` (Neon) | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Ideal | ✅ Ideal |

---

## 5. Plugin System — promoted

Explored here, then promoted to **D31** and **§13** of
[IMPLEMENTATION.md](IMPLEMENTATION.md) once the open questions were resolved:
worker isolation by default (a one-way door), no separate plugin API version,
no installer, no `seq` cursor, no UI field in the manifest, and no plugin
provenance in the export archive. The feasibility spikes that decided the shape
— dynamic import, virtual modules and `Worker` isolation inside a
`bun build --compile` binary, with measurements — live in §13.10 there.

Remaining plugin ideas that are *not* decided are tracked as roadmap item 8
(§12.8), not here.
