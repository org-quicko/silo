# Silo Plugins 🔌📖
*The ultimate guide to extending Silo without losing your mind.*

---

## 🧭 The 30-Second Elevator Pitch

Imagine Silo is a high-security smartphone operating system:
* **The Core (Silo)** is the phone itself: it stores contacts, takes photos, handles calls, and enforces security.
* **A Plugin** is an app you install from the app store.
* **Permissions** are the popups asking: *"Allow this app to access your contacts?"*

In Silo, **a plugin is an API key with code attached**. It lets you hook into data changes, add custom API endpoints, run background tasks, embed UI screens into the admin dashboard, or even plug in custom database engines.

```
                  ┌──────────────────────────────────────────────┐
                  │                 SILO SERVER                  │
                  │                                              │
                  │  ┌───────────────┐     ┌──────────────────┐  │
HTTP Requests ───►│  │   Hono App    │────►│   Core Storage   │  │
                  │  │  (HTTP / API) │     │ (SQLite / Data)  │  │
                  │  └───────┬───────┘     └────────┬─────────┘  │
                  │          │                      │            │
                  │          ▼                      ▼            │
                  │     In-Process             Hook Events       │
                  │     ctx.fetch              (afterWrite, etc) │
                  │          │                      │            │
                  └──────────┼──────────────────────┼────────────┘
                             │                      │
                             ▼                      ▼
                  ┌──────────────────────────────────────────────┐
                  │           ISOLATED WORKER THREAD             │
                  │                                              │
                  │             YOUR PLUGIN CODE                 │
                  │       (Hooks, Routes, Runtime, Panel)        │
                  └──────────────────────────────────────────────┘
```

---

## 1. 💡 Core Philosophy: 5 Big Ideas You Must Know

Before writing a single line of code, understand these five fundamental rules of Silo's plugin design:

### 1. "Zero Runtime Dependencies" (`silo:api`)
When building a Silo plugin, you don't install `@silo/core` or `@silo/shared` in `node_modules`. 
Silo automatically provides a magical built-in virtual module called `silo:api`. 
```ts
import { defineSiloPlugin, ValidationError } from "silo:api";
```
* **Why?** It prevents version conflicts ("dependency hell") and ensures plugins stay lightweight and byte-identical across environments.

### 2. Registration vs. Authorization (The Twin Guardrails)
* **Registration (`silo.toml`)**: Tells Silo *which* plugins to load and in what order. Owned by the server operator.
* **Authorization (`_system/_plugins` database)**: Tells Silo *what* the plugin is allowed to do (its active grant).
* **The Magic Rule**: 
  > *If permissions were in the config file, revoking access would require restarting the server. If plugin registration were in the database, anyone with database write access could run arbitrary code.*

### 3. Workers Bound Faults, Not Malice
Extension plugins run in their own dedicated **Bun Worker thread** (one worker per plugin):
* If your plugin gets stuck in an infinite loop (`while(true) {}`) or runs out of memory, **Silo doesn't crash**. Silo's watchdog timer terminates the runaway worker while the main server continues serving traffic.
* *Note:* Installing a plugin is still a trust boundary. Code in a worker can still make network requests or read files if you let it.

### 4. You Never Hear About Writes You Caused (The Anti-Ping-Pong Rule)
Suppose Plugin A updates a post whenever a post is edited. 
Does Plugin A trigger itself in an infinite loop? **No!**
Silo attaches a causal chain (`cause: ["plugin-a"]`) to every database operation. If an event was initiated by Plugin A, Silo silently skips Plugin A when broadcasting that event. Cycles like `A → B → A` are structurally impossible.

### 5. Static Manifests First
Silo reads what a plugin does (`package.json`) **before running any of its code**. Silo will never execute mystery code just to inspect what hooks or routes a package offers.

---

## 2. 🧩 What Can a Plugin Actually Do? (`contributes`)

Unlike older systems where a plugin could only be one thing, Silo uses a flexible **contribution model**. A single plugin can contribute any combination of these **5 capabilities**:

```
                       ┌───────────────────────────────┐
                       │       A Silo Plugin Can       │
                       │           Contribute          │
                       └───────────────┬───────────────┘
                                       │
        ┌──────────────┬───────────────┼───────────────┬──────────────┐
        ▼              ▼               ▼               ▼              ▼
   🪝 Hooks       🌐 Routes       ⚡ Runtime       🖼️ UI Panel    💾 Providers
 (Event Guards)  (Custom APIs)   (Background)   (Admin Screen)  (Custom DB/S3)
```

| Contribution | What It Does | Where It Runs | Example Use Case |
| :--- | :--- | :--- | :--- |
| **Hooks** | Intercepts, modifies, validates, or observes database writes and deletions. | Worker | Auto-generating URL slugs, validating custom business rules, auditing changes. |
| **Routes** | Exposes custom HTTP endpoints mounted under `/api/ext/{plugin-name}/*`. | Worker | Receiving Stripe webhooks, triggering data syncs, CSV downloads. |
| **Runtime** | Runs setup (`activate`) and cleanup (`deactivate`) when the plugin starts/stops. | Worker | Starting internal timers, warming up caches, running one-time migrations. |
| **UI (`ui`)** | Embeds custom HTML/JS screens directly into the Silo Admin Dashboard. | Sandboxed iframe | Importer wizard, analytics chart, custom config screen. |
| **Providers** | Replaces Silo's internal storage engine (`Storage`) or blob storage (`BlobStorage`). | Host (Inline) | Custom database drivers (Postgres, Turso), custom blob stores (Google Cloud Storage). |

---

## 3. 🪝 Lifecycle Hooks: The 6 Interceptors

Silo has **6 lifecycle hooks**. They follow a strict timeline during database operations:

```
[ HTTP Request / API Call ]
         │
         ▼
 1. entry.beforeValidate   ──► ✏️ MUTATING: Can rewrite event data or reject.
         │
 [ Schema Validation & Media Reference Checks ]
         │
         ▼
 2. entry.beforeWrite      ──► 🛑 VETO-ONLY: Can reject (400/403), cannot change data.
         │
 [ Acquire Write Lock & Commit to SQLite Database ]
         │
         ▼
 [ Release Write Lock ]
         │
         ▼
 3. entry.afterWrite       ──► 👁️ OBSERVE: Best-effort, runs after data is safely saved.
```

### The 6 Hooks at a Glance

| Hook Name | Role | Can Modify Data? | Can Abort/Reject? | When It Runs |
| :--- | :--- | :---: | :---: | :--- |
| `entry.beforeValidate` | **Mutating** | ✅ Yes (`return { data }`) | ✅ Yes (`throw new ValidationError()`) | Before schema validation. Best for auto-filling fields (like slugs or timestamps). |
| `entry.beforeWrite` | **Veto-Only** | ❌ No | ✅ Yes | After schema passes, right before database write. Best for final business checks. |
| `entry.afterWrite` | **Observe** | ❌ No | ❌ No (errors ignored) | After commit. Best for sending webhooks, notifications, or cache busting. |
| `entry.beforeDelete` | **Veto-Only** | ❌ No | ✅ Yes | Before deleting an individual entry. |
| `entry.afterDelete` | **Observe** | ❌ No | ❌ No | After an entry is deleted. |
| `collection.afterDelete` | **Observe** | ❌ No | ❌ No | After a whole collection is deleted (receives count of erased rows). |

> [!IMPORTANT]
> **Golden Rule of Hooks**:
> Mutating hooks run *before* validation so Silo's schema validator checks the *final* data. Plugins shape the `data`; core Silo owns the envelope (`id`, `rev`, `seq`, timestamps).

---

## 4. 🌐 Custom Routes: Adding Your Own HTTP Endpoints

Plugins can define their own API routes! They are automatically mounted under `/api/ext/{plugin-name}/*`.

### Key Rules for Routes:
1. **Isolated Namespace**: You can never overwrite or shadow Silo's built-in routes. Your routes always start with `/api/ext/<your-plugin-name>/`.
2. **Authority & Credentials**: When a client calls your route, your handler executes with **your plugin's granted permissions** (not the caller's). For security, client credentials (`Authorization`, cookies) are stripped before reaching your handler.
3. **Receiving Files (Binary Payloads)**: Need to upload a SQLite file, image, or CSV? Routes can declare binary body handling up to 64 MB:
   ```jsonc
   {
     "method": "POST",
     "path": "/upload",
     "body": { "kind": "bytes", "max_bytes": 67108864 }
   }
   ```

---

## 5. 🖼️ Admin UI Panels: Safe Visual Screens

Want to show a visual UI inside Silo's web admin? Declare a UI panel:

```jsonc
"contributes": {
  "ui": {
    "entry": "./panel.html",
    "title": "My Import Wizard"
  }
}
```

```
┌──────────────────────────────────────────────────────────┐
│ Silo Admin Dashboard                                     │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Sandboxed iframe (No cookies, No localStorage)     │  │
│  │                                                    │  │
│  │  [ Upload Button ]  ──► window.silo.fetch(...)     │  │
│  │                             │ (via postMessage)    │  │
│  │                             ▼                      │  │
│  │                Calls /api/ext/my-plugin/*          │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Why It's Ultra-Secure:
* It renders in a sandboxed `<iframe>` (`sandbox="allow-scripts"` with **no** `allow-same-origin`).
* It has **no access** to the browser's cookies or `localStorage` (where admin API keys are stored).
* It communicates solely through a helper `window.silo` using secure browser message passing, allowing it to call only its *own* plugin routes.

---

## 6. 🔐 The Permission System: Required vs. Optional Claims

Silo uses fine-grained permissions. When authoring a plugin, you must declare what you need in `package.json`, split into:

1. **`required`**: Without these, the plugin cannot do its primary job. (Approved by default).
2. **`optional`**: Nice-to-have features that can be turned off without crashing the plugin.
3. **`reason`**: **Mandatory for every single claim.** A blank reason causes Silo to reject the plugin!

```jsonc
"permissions": {
  "required": [
    {
      "claim": "collections:*/*/*:entries:create",
      "reason": "To create imported articles in your target collection."
    }
  ],
  "optional": [
    {
      "claim": "media:create",
      "reason": "To upload embedded images to the media library."
    }
  ]
}
```

### Automatically Derived Claims:
You don't need to manually type hook permissions or route permissions. Silo automatically generates:
* `hooks:*/*/*:<hook-name>` for any hook you declare.
* `http:route` if you declare routes.

---

## 7. 🛠️ Step-by-Step: Creating Your First Plugin

Let's build a practical plugin: **Auto-Slugger** (generates a URL slug from the title before saving an article).

### Step 1: Scaffold the Plugin
Run the official scaffolding tool:
```bash
bun create silo-plugin silo-plugin-slugger
# or with npm:
# npx create-silo-plugin silo-plugin-slugger
```

This creates a clean project directory:
```
silo-plugin-slugger/
├── package.json       # Manifest (metadata, contributions, permissions)
├── index.ts           # Plugin code
├── silo-api.d.ts      # TypeScript types for silo:api
├── tsconfig.json      # TypeScript configuration
└── README.md          # Documentation
```

### Step 2: Configure the Manifest (`package.json`)
Open `package.json` and customize the `"silo"` section:

```jsonc
{
  "name": "silo-plugin-slugger",
  "version": "1.0.0",
  "type": "module",
  "main": "index.ts",
  "silo": {
    "silo": "^0.2",
    "contributes": {
      "hooks": ["entry.beforeValidate"]
    },
    "permissions": {
      "required": [
        {
          "claim": "collections:*/*/*:entries:read",
          "reason": "To check existing slugs and prevent duplicates."
        }
      ]
    },
    "config": {
      "type": "object",
      "properties": {
        "sourceField": { "type": "string", "default": "title" },
        "targetField": { "type": "string", "default": "slug" }
      }
    }
  }
}
```

### Step 3: Write the Code (`index.ts`)
```ts
import { defineSiloPlugin } from "silo:api";
import type { SiloContext, SiloHookEvent } from "silo:api";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default defineSiloPlugin({
  async "entry.beforeValidate"(event: SiloHookEvent, ctx: SiloContext) {
    // Only apply to posts collection
    if (event.collection !== "posts") return;

    const sourceField = ctx.config.sourceField || "title";
    const targetField = ctx.config.targetField || "slug";

    const title = event.data?.[sourceField];
    if (title && !event.data?.[targetField]) {
      const generatedSlug = slugify(title);
      ctx.log.info("Generated slug for entry", { slug: generatedSlug });

      // Return the updated data payload
      return {
        data: {
          ...event.data,
          [targetField]: generatedSlug,
        },
      };
    }
  },
});
```

---

## 8. 🎛️ How Silo Manages Plugins (Operator's Guide)

### Installing a Plugin
You can install plugins from local paths, npm, git, or tarballs:
```bash
# From a local folder
silo add ./silo-plugin-slugger

# From npm
silo add silo-plugin-slugger@^1.0.0

# From git
silo add git+https://github.com/org/silo-plugin-slugger.git
```

When you run `silo add`:
1. Silo validates the archive and verifies integrity.
2. Silo extracts it safely into `<data-dir>/plugins/<name>/`.
3. Silo presents requested permissions and asks for operator confirmation.
4. Silo appends a `[[plugins]]` block to `silo.toml`.

### Managing via CLI

```bash
# 1. List installed plugins & their permission state
silo plugin list

# 2. Inspect a plugin's manifest & requested claims
silo plugin info silo-plugin-slugger

# 3. Approve permissions (Offline / CI-friendly)
silo plugin grant silo-plugin-slugger

# 4. Revoke permissions
silo plugin revoke silo-plugin-slugger

# 5. Doctor: Test if all plugins load cleanly without booting the server
silo plugin doctor
```

### Managing via Admin UI & Live Supervisor
Silo features a dynamic **Supervisor**. You don't have to restart the server to manage plugins!
In the Admin Dashboard (`/admin/#/plugins`) or via API, you can live:
* **Enable / Disable** any plugin.
* **Approve / Narrow / Revoke** grants instantly.
* **Reconfigure** plugin settings on the fly.
* **Restart** a failed worker.
* **Rescan** `silo.toml` to pick up newly added packages.

---

## 9. 🧠 The Plugin Context (`ctx`): What Your Code Can Do

Inside your hooks and routes, you receive `ctx` (`SiloContext`). 
`ctx` lets you interact with Silo's database through Silo's own authenticated API:

```ts
// 1. Logging
ctx.log.info("Something happened", { userId: 123 });
ctx.log.warn("Warning message");
ctx.log.error("Something went wrong");

// 2. Read Configuration
const apiKey = ctx.config.myApiKey;

// 3. Manage Entries (CRUD + Search)
const scope = { project: "default", env: "prod" };
const page = await ctx.entries.list(scope, "posts", { limit: 10 });
const post = await ctx.entries.get(scope, "posts", "entry-id-123");
const created = await ctx.entries.create(scope, "posts", { title: "Hello World" });
await ctx.entries.update(scope, "posts", "entry-id-123", { title: "Updated" }, rev);
await ctx.entries.delete(scope, "posts", "entry-id-123", rev);
const searchResults = await ctx.entries.search(scope, "posts", { q: "javascript" });

// 4. Inspect Collections & Schemas
const collections = await ctx.collections.list(scope);
const schema = await ctx.collections.schema(scope, "posts");

// 5. Inspect Projects
const projects = await ctx.projects.list();

// 6. Media Catalog
const mediaList = await ctx.media.list();
const mediaMeta = await ctx.media.get("media-id-123");

// 7. General API Fetch (for anything else under /api/)
const res = await ctx.fetch("/api/health");
const json = res.json();
```

---

## 10. ⚠️ Common Gotchas & Pro Tips

> [!TIP]
> **Pro Tip 1: Throw `ValidationError` for clean 400 errors**
> If you want to reject an entry write with a friendly error message to the user, throw `ValidationError` (imported from `silo:api`). Don't throw a generic `Error` (which is treated as an unexpected crash).

> [!WARNING]
> **Gotcha 1: Modifying data in `beforeWrite` does nothing**
> `entry.beforeWrite` is **veto-only**. You can inspect data and reject, but returning `{ data: ... }` will be ignored. If you want to alter data, use `entry.beforeValidate`.

> [!NOTE]
> **Pro Tip 2: Bulk Imports Skip Hooks by Design**
> High-performance bulk data imports (`silo import`) bypass hooks on purpose to maintain speed and deterministic restores. Don't rely on hooks for mandatory schema defaults during archive imports.

> [!CAUTION]
> **Gotcha 2: Don't block the thread**
> Every hook and route dispatch has a timeout (default 5000ms). If your worker hangs, Silo will kill it and mark it `failed`. Keep synchronous operations quick and snappy!

---

## 📚 Quick Glossary

* **`silo:api`**: The built-in virtual module exposing types and runtime helper classes to your plugin.
* **Worker**: An isolated background execution thread running your plugin JavaScript.
* **Claim**: A string representing a specific permission (e.g. `collections:*/*/*:entries:create`).
* **Grant**: The approved list of claims an operator has given to a plugin.
* **Causal Chain**: The breadcrumb trail Silo tracks to prevent recursive event loops between plugins.
* **Supervisor**: Silo's internal manager that handles live loading, restarting, enabling, and revoking plugins without downtime.
