# Architecture Overview

## System Architecture

```
                              ┌─────────────────────┐
                              │   Browser / Client   │
                              └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │   Nginx (Port 2026) │
                              │  Reverse Proxy       │
                              │  /api/langgraph/* → LangGraph (2024) │
                              │  /api/*           → Gateway (8001)   │
                              │  /*               → Frontend (3000)  │
                              └──┬────────────┬──┘
                                 │            │
                    ┌────────────▼──┐  ┌──────▼──────────┐
                    │ Gateway API   │  │ LangGraph Server │
                    │ (FastAPI:8001)│  │ (Port 2024)      │
                    └──┬───┬───┬───┘  └──────┬───────────┘
                       │   │   │             │
          ┌────────────┘   │   └───────┐     │
          ▼                ▼           ▼     ▼
    ┌──────────┐  ┌───────────────┐  ┌──────────────────────────┐
    │ Auth DB  │  │  Tenant DB    │  │  File / Object Storage   │
    │──────────│  │───────────────│  │──────────────────────────│
    │ Better   │  │  SQLModel     │  │  v1.0: Local FS          │
    │ Auth     │  │  SQLAlchemy   │  │  .opsintech/threads/     │
    │ ──────── │  │  + Alembic    │  │  .opsintech/data/        │
    │ user     │  │  ──────────   │  │                          │
    │ account  │  │  tenants      │  │  📋 v2.0: MinIO (S3)     │
    │ session  │  │  memberships  │  │  tn-{id}/ → per-tenant   │
    │          │  │  model_configs│  │  bucket isolation        │
    │          │  │  mcp_servers  │  │  user/ prefix scoping    │
    │          │  │  skills       │  │  quota at bucket level   │
    │          │  │  user_configs │  │  presigned URL access    │
    │          │  │  announcements│  │                          │
    └──────────┘  └───────────────┘  └──────────────────────────┘
```

> **Database layer** (left two) stores identity, configuration, and metadata — structured, queried via SQL. **File/Object storage** (right) stores thread artifacts, uploads, and agent workspace — blobs, accessed via filesystem or S3 API. v1.0 uses local FS; v2.0 introduces MinIO with per-tenant bucket isolation and user-level quotas. See [Storage Evolution](#storage-evolution) below.

## Core Components

### Gateway API (FastAPI, Port 8001)

Provides REST endpoints for management and non-agent operations. All business APIs pass through the Auth middleware which extracts user identity, tenant context, and role from the session token.

**Routers**:

| Router                | Prefix                                                                   | Purpose                                                              |
| --------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `admin`               | `GET /api/admin/*`                                                       | Platform admin: users, tenants, model templates, audit overview      |
| `tenants`             | `GET /api/tenants`                                                       | Tenant listing, current tenant, switch tenant                        |
| `agents`              | `GET /api/agents`                                                        | Custom agent CRUD (SOUL.md, tool\_groups, model binding)             |
| `models`              | `GET /api/models`                                                        | Available models from DB (per-tenant scope)                          |
| `mcp`                 | `GET /api/mcp/*`                                                         | MCP server configuration (per-tenant)                                |
| `skills`              | `GET /api/skills`                                                        | Skills management (per-tenant)                                       |
| `threads`             | `DELETE /api/threads/{id}`                                               | Thread cleanup after LangGraph deletion                              |
| `artifacts`           | `GET /api/threads/{id}/artifacts/*`                                      | Artifact serving and download                                        |
| `uploads`             | `POST /api/threads/{id}/uploads`                                         | File upload                                                          |
| `suggestions`         | `GET /api/threads/{id}/suggestions`                                      | Follow-up suggestions                                                |
| `memory`              | `GET /api/memory`                                                        | Memory management                                                    |
| `announcements`       | `GET /api/announcements`                                                 | Platform announcements                                               |
| `channels`            | `GET /api/channels` `GET /api/tenant-im`                                 | IM channel status / restart / test, per-tenant IM settings           |
| `alerts`              | `POST /api/alerts/ingest/{source_id}` `GET /api/incidents`               | Alert ingestion, incident lifecycle, alert sources, rules, changes   |
| `knowledge`           | `GET /api/knowledge/bases` `POST /api/knowledge/search`                  | Knowledge bases, document upload, hybrid retrieval                   |
| `terminal`            | `WS /api/v1/terminal/ws` `POST /api/v1/terminal/invoke`                  | Terminal sessions, AI invoke, approvals, security settings, audit    |
| `assets`              | `GET /api/v1/assets/local`                                               | Terminal target hosts, asset groups, credential keychains            |
| `files`               | `GET /api/files` `POST /api/files/upload`                                | Tenant file manager: folders, upload, preview, download              |
| `templates`           | `GET /api/templates`                                                     | Document/report template library                                     |
| `summarization`       | `GET /api/tenant-admin/settings/summarization`                           | Per-tenant context-reduction settings                                |
| `auth` (Auth helpers) | `POST /api/auth/login` `GET /api/auth/bootstrap-status`                  | Session login/signup/logout and initial admin setup                  |

### Auth Middleware

Every API request passes through `AuthMiddleware`, except the paths it excludes (`AuthMiddleware.exclude_paths` in `app/gateway/auth.py`):

| Excluded path                                           | Why                                             |
| ------------------------------------------------------- | ----------------------------------------------- |
| `/health` `/docs` `/redoc` `/openapi.json`              | Liveness probe and API docs                     |
| `/api/auth/login` `/api/auth/signup` `/api/auth/logout`  | Session establishment                           |
| `/api/auth/session`                                      | Returns `{session: null, user: null}` when anonymous |
| `/api/auth/bootstrap-status` `/api/auth/setup-bootstrap-admin` | First-run admin setup                     |
| `/api/alerts/ingest/` `/api/changes/ingest/`             | Authenticated per source by its own token, not a user session |

`OPTIONS` preflight requests pass unconditionally. For everything else the middleware:

1. Extracts the Better Auth session token from headers or cookies
2. Resolves `user_id`, `user_role`, and `must_change_password`
3. Determines the active tenant and membership role via `tenant_service`
4. Creates a personal tenant if the user has none (auto-bootstrap)
5. Injects tenant context into `contextvars` for transparent propagation to config loaders

### LangGraph Server (Port 2024)

The Agent runtime. Runs via `langgraph dev` (open-source CLI). Orchestrates sub-agents, manages thread state, executes tools in sandboxes, and streams responses via SSE.

**Entry Point**: `packages/harness/deerflow/agents/lead_agent/agent.py:make_lead_agent`

### Frontend (Next.js, Port 3000)

- Workspace (`/workspace`): Overview, Agents, Chats, Terminal, Knowledge, Files, Skills, Incidents, Announcements
- Platform admin (`/admin`): Users, Tenants, Models, Tools, Audit, Security, Announcements
- Tenant admin (`/tenant-admin`): Members, Models, Skills, Tools, Agents, Alerts, IM, Audit, Settings
- Auth / setup pages: `/sign-in`, `/sign-up`, `/setup`, `/change-password`
- User settings dialog: Models, Memory, Tools, Skills, Appearance, Notifications
- i18n: `en-US`, `zh-CN`, `ja`, `ko`, `vi` — the offered subset is narrowed by `NEXT_PUBLIC_SUPPORTED_LOCALES`

## Multi-Tenancy Architecture

### Three-Tier Resource Model

```
global (platform level)
  └── tenant (workspace level)
       ├── user-scoped resources (personal threads, memory)
       └── tenant-shared resources (models, skills, MCP)
```

### Database Tables (Tenant DB)

| Table                         | Purpose                                                               |
| ----------------------------- | --------------------------------------------------------------------- |
| `user_configs`                | Per-user runtime config (app\_config + extensions\_config JSON blobs) |
| `tenants`                     | Tenant containers (id, name, slug, status)                            |
| `tenant_memberships`          | User-to-tenant role bindings                                          |
| `tenant_model_configs`        | Models assigned to tenants                                            |
| `tenant_mcp_servers`          | MCP server configs per tenant                                         |
| `tenant_skills`               | Skill state per tenant                                                |
| `custom_agents`               | Custom agents (SOUL.md, tool\_groups whitelist, model binding)        |
| `platform_announcements`      | Operational announcements with role/tenant targeting                  |
| `platform_announcement_reads` | Per-user read/dismiss state                                           |

### Feature Domain Tables

| Domain            | Tables                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Alerting**      | `alert_sources` · `raw_alerts` · `signals` · `incidents` · `incident_signal_links` · `incident_context_snapshots` · `incident_actions` · `alert_rules` · `alerting_settings` · `change_events` |
| **Knowledge**     | `knowledge_bases` · `knowledge_documents` · `knowledge_chunks`                                                                                |
| **Terminal**      | `terminal_sessions` · `terminal_chat_sessions` · `terminal_audit_logs` · `terminal_security_settings`                                          |
| **Assets**        | `keychains` · `asset_groups` · `local_assets`                                                                                                 |
| **Files**         | `file_folders` · `file_objects`                                                                                                                |

Schema is managed by Alembic (`backend/alembic/versions/`). `db-init` runs `alembic upgrade head` before the gateway and LangGraph containers start.

### Database Engines

Both the tenant DB and the auth DB run on either SQLite or PostgreSQL, selected in `config.yaml`:

```yaml
database:
  type: postgres                                                              # sqlite | postgres
  url: postgresql+asyncpg://user:pass@postgres:5432/opsintech_tenant_db
  auth:
    type: postgres
    url: postgresql+asyncpg://user:pass@postgres:5432/opsintech_auth_db

checkpointer:
  type: postgres                                                              # memory | sqlite | postgres
  connection_string: postgresql://user:pass@postgres:5432/opsintech_checkpoints
```

SQLite keeps both files under `.opsintech/` with no extra services. PostgreSQL is the production path — `docker compose --profile postgres up -d` starts the bundled `postgres:16-alpine` and creates the three databases from `docker/postgres/init-databases.sql`.

### Auth DB (Better Auth)

Managed by Better Auth framework. Stores `user`, `account`, `session`, `verification` tables. The user table includes custom fields: `role`, `status`, `mustChangePassword`, `isBootstrapAdmin`.

### Config Loading: contextvars Transparent Proxy

User-scoped config is loaded through a `contextvars`-based proxy pattern:

1. `AuthMiddleware` sets `user_id`, `tenant_id`, and `tenant_role` into thread-local `contextvars`
2. `get_app_config()` checks `contextvars` for a current user
3. If a user is present: loads user-scoped config from DB (`user_configs` table), merges with platform-level model templates from `tenant_model_configs`
4. If no user (system startup): falls back to file-based `config.yaml`
5. Downstream code (`factory.py`, tool loaders) calls `get_app_config()` without knowing where the config came from

This means the core Agent runtime code (model factory, tool loading) was never modified for multi-tenancy.

## Alerting & Incident Pipeline

External monitoring systems post to a per-source ingest endpoint. Each source carries its own token, so ingest bypasses the user-session middleware.

```
Alertmanager / Grafana / Datadog / CloudWatch / generic webhook
  │  POST /api/alerts/ingest/{source_id}   (source token auth)
  ▼
raw_alerts          ← verbatim payload, kept for replay and audit
  │  provider parser normalizes vendor payload → common shape
  ▼
signals             ← normalized, fingerprinted (dedup.py)
  │  rule_engine.py evaluates alert_rules
  ▼
incidents           ← signals correlated into one incident (incident_manager.py)
  ├─ ai_analysis.py        async summary and root-cause interpretation
  ├─ diagnosis_sse.py      streaming diagnosis to the UI (AG-UI protocol over SSE)
  ├─ escalation.py         time-based escalation
  ├─ notify.py             IM notification via the channel layer
  ├─ ticket_provider.py    external ticket creation
  └─ incident_actions      claim / assign / suppress / resolve, each recorded
```

| Module                       | Responsibility                                                               |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `alerting/ingest.py`         | Ingest entry point — resolves the source, stores the raw alert, emits signals |
| `alerting/providers/`        | Per-vendor payload parsers: `alertmanager` · `grafana` · `datadog` · `cloudwatch` · `webhook` |
| `alerting/dedup.py`          | Fingerprint generation and dedup (alerta-style)                              |
| `alerting/rule_engine.py`    | Evaluates `alert_rules` against signals                                      |
| `alerting/incident_manager.py` | Signal aggregation and incident lifecycle                                  |
| `alerting/ai_analysis.py`    | Async, non-blocking AI interpretation                                        |
| `alerting/diagnosis_sse.py`  | SSE streaming for interactive diagnosis                                      |
| `alerting/escalation.py`     | Escalation policy evaluation                                                 |
| `alerting/notify.py`         | Sends incident notifications through IM channels                             |
| `alerting/health_monitor.py` | Watches alert sources for silence / failure                                  |
| `alerting/ticket_provider.py`| Creates tickets in an external system                                        |
| `alerting/cleanup.py`        | Per-tenant retention for `raw_alerts`, `signals`, and links                   |

**Correlation**: `dedup.py` computes a SHA-256 fingerprint over `source | service | env | severity | labels`. A signal joins an active incident sharing that correlation key within a 30-minute window; an alert rule's `aggregation_config` can override both the key fields and `window_minutes`. Escalation is duration-based — `min_duration_minutes` firing without acknowledgment bumps severity or notifies further.

`change_events` are ingested separately (`POST /api/changes/ingest/{source_id}`, also source-token authenticated) so deploys and config changes can be correlated against incident timelines.

## Knowledge Base (Native RAG)

Tenant-scoped document retrieval, implemented in `packages/harness/deerflow/rag/` with no external vector database.

```
Upload  POST /api/knowledge/bases/{kb_id}/documents
  │  extractor.py   PDF · DOCX · MD · HTML · CSV · JSON · YAML · TXT · LOG → text
  │  chunker.py     paragraph- and sentence-aware chunking
  │  embeddings.py  optional: OpenAI-compatible /embeddings call
  ▼
knowledge_chunks (text + optional vector, in the tenant DB)

Search  POST /api/knowledge/search  ·  or the agent's RAG tool
  │  retriever.py   BM25 lexical score + vector cosine similarity (hybrid)
  ▼
ranked chunks → agent context
```

| Aspect           | Behavior                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| **Embeddings**   | Optional. Configured by `RAG_EMBEDDING_BASE_URL`, `RAG_EMBEDDING_API_KEY`, `RAG_EMBEDDING_MODEL`. `embed_texts()` returns `None` when unset, so retrieval degrades cleanly to BM25 |
| **Storage**      | Chunks and vectors live in the tenant DB — no separate vector store to operate                          |
| **Isolation**    | `knowledge_bases` are tenant-scoped; the agent tool only searches the caller's tenant                   |
| **Agent access** | `rag/rag_tool.py` exposes retrieval as a LangChain tool bound to the request's tenant context           |

## IM Channels

Agents are reachable from chat apps. Every channel dials out — no inbound webhook or public IP is required.

```
Feishu/Lark (WebSocket)  ─┐
Slack (Socket Mode)      ─┼─► MessageBus (async pub/sub) ─► ChannelManager ─► LangGraph Server
Telegram (long polling)  ─┘           ▲                           │
                                      └──── agent reply ──────────┘
```

| Module                  | Responsibility                                                                 |
| ----------------------- | ------------------------------------------------------------------------------ |
| `channels/base.py`      | Abstract channel interface                                                     |
| `channels/service.py`   | `ChannelService` — lifecycle of all configured channels                        |
| `channels/message_bus.py` | Async pub/sub hub decoupling channels from the agent dispatcher              |
| `channels/manager.py`   | Consumes inbound messages, dispatches to the agent via the LangGraph Server    |
| `channels/store.py`     | Persists IM-chat → agent-thread mappings so conversations keep their context   |
| `channels/{feishu,slack,telegram}.py` | Transport implementations                                        |

Managed per tenant: `GET /api/channels` reports status, `POST /api/channels/{name}/restart` recycles one, `POST /api/channels/test` sends a test notification, and `/api/tenant-im` holds the per-tenant settings. The alerting layer reuses this path to deliver incident notifications.

## Storage Evolution

### v1.0: Local Filesystem (Current)

```
.opsintech/
├── threads/
│   └── {thread_id}/
│       └── user-data/
│           ├── workspace/    ← Agent working directory
│           ├── uploads/      ← User-uploaded files
│           └── outputs/      ← Agent-generated artifacts
├── data/
│   ├── auth.db              ← Better Auth (user/account/session)
│   └── tenant.db            ← SQLModel tenant configs
└── audit/
    └── events.jsonl         ← Audit log
```

Simple, zero-dependency. Suitable for single-node deployment. All tenants share the same filesystem with path-based isolation.

### Driver Abstraction (Implemented)

`packages/harness/deerflow/storage/` already defines the provider protocol and three drivers, so business logic never touches a filesystem path directly:

| Driver                  | Backend                          | Config (`StorageProviderConfig`)                                        |
| ----------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `LocalStorageDriver`    | Local filesystem                 | `local_root_path` (default `data/storage`)                              |
| `S3StorageDriver`       | MinIO or any S3-compatible store | `s3_endpoint_url` · `s3_access_key` · `s3_secret_key` · `s3_bucket_name` · `s3_region_name` · `s3_use_ssl` |
| `JuiceFSStorageDriver`  | Distributed POSIX volume         | `juicefs_mount_path` · `juicefs_subdir`                                 |

Status: the file manager (`routers/files.py`) resolves the local driver directly via `deerflow.storage.local.get_storage_driver`. Each row in `file_objects` records the `storage_backend` it landed on, so a later switch can be rolled out per file rather than as a flag day. Thread workspaces and artifacts still use plain filesystem paths.

### v2.0: Per-Tenant Bucket Isolation (Planned)

```
MinIO (S3-compatible)
├── tn-{tenant_a}/               ← Tenant A bucket
│   ├── user-{user_1}/           ← User-scoped prefix
│   │   ├── threads/{id}/workspace/
│   │   ├── threads/{id}/uploads/
│   │   └── artifacts/
│   ├── user-{user_2}/
│   │   └── ...
│   └── shared/                  ← Tenant-shared files
│       └── skills/
├── tn-{tenant_b}/               ← Tenant B bucket
│   └── ...
└── global/                      ← Platform-level assets
    └── skill-templates/
```

**Design principles:**

| Aspect               | Design                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bucket namespace** | `tn-{tenant_id}` per tenant, guaranteed isolation                                                                                                                 |
| **User prefix**      | `user-{user_id}/` within tenant bucket, scoped to member                                                                                                          |
| **Quota**            | Tenant-level quota configured by platform admin. User-level sub-quota managed by tenant admin. Enforced at the MinIO bucket policy level                          |
| **Lifecycle**        | Auto-expire old thread artifacts after configurable retention period via MinIO lifecycle rules                                                                    |
| **Access control**   | MinIO IAM policies bound to tenant context. Gateway proxies requests with presigned URLs — never exposes MinIO directly to the browser                            |
| **Migration**        | Existing local filesystem data can be backfilled into MinIO via `mc mirror`. Both backends coexist during transition — `config.yaml` controls the storage backend |

**Data flow with MinIO:**

```
User uploads file
  → Gateway validates + extracts tenant/user context
  → Writes to MinIO: tn-{tenant}/user-{user}/uploads/{thread}/{file}
  → Stores metadata in tenant DB (file path, size, checksum)
  → Sandbox mounts object via MinIO FUSE or S3-backed path

Agent generates artifact
  → Sandbox writes to virtual path /mnt/user-data/outputs/
  → Sandbox teardown syncs outputs to MinIO
  → Artifact URL served via Gateway presigned GET
```

**Why MinIO:**

- S3-compatible API — easy migration to AWS S3, GCS, or any S3 backend
- Self-hosted — fits OpsinTech's on-prem / private deployment positioning
- Per-tenant bucket isolation prevents cross-tenant data leakage at the storage layer (defense in depth, not just application-level)
- Quota enforcement at the storage layer prevents a single tenant from starving others
- Object versioning and lifecycle policies for compliance retention

**config.yaml (v2.0):**

```yaml
storage:
  backend: minio              # local | minio
  minio:
    endpoint: minio:9000
    access_key: $MINIO_ACCESS_KEY
    secret_key: $MINIO_SECRET_KEY
    use_ssl: false
    region: us-east-1
    default_tenant_quota_gb: 10
    artifact_retention_days: 90
```

## Agent Runtime (Inherited from DeerFlow)

### Lead Agent

Entry: `make_lead_agent(config)` in `packages/harness/deerflow/agents/lead_agent/agent.py`

Creates a LangGraph agent with:

- Model from the factory (DB-driven model selection)
- Tools filtered by the agent's `tool_groups` whitelist (empty whitelist = every tool)
- Middleware chain for uploads, sandbox, summarization, memory, etc.
- Skills injected into system prompt

### Middleware Chain

| Order | Middleware              | Function                                |
| ----- | ----------------------- | --------------------------------------- |
| 1     | ThreadDataMiddleware    | Set up per-thread directories           |
| 2     | UploadsMiddleware       | Inject uploaded file list into messages |
| 3     | SandboxMiddleware       | Acquire sandbox environment             |
| 4     | SummarizationMiddleware | Context reduction near token limits     |
| 5     | TitleMiddleware         | Auto-generate conversation titles       |
| 6     | TodoListMiddleware      | Task tracking (plan mode)               |
| 7     | ViewImageMiddleware     | Vision model image processing           |
| 8     | ClarificationMiddleware | Handle user clarifications              |

### Sandbox System

```
SandboxProvider (abstract)
  ├── LocalSandboxProvider (development)
  └── AioSandboxProvider (Docker/K8s, production)
```

Virtual path mapping:

| Virtual Path               | Physical Path                      |
| -------------------------- | ---------------------------------- |
| `/mnt/user-data/workspace` | `threads/{id}/user-data/workspace` |
| `/mnt/user-data/uploads`   | `threads/{id}/user-data/uploads`   |
| `/mnt/user-data/outputs`   | `threads/{id}/user-data/outputs`   |
| `/mnt/skills`              | `skills/`                          |

### Tool System

Tools come from three sources merged at runtime:

- **Built-in tools**: `present_file`, `ask_clarification`, `view_image`
- **Configured tools** (from DB): `web_search`, `web_fetch`, `bash`, `read_file`, `write_file`, `str_replace`, `ls`
- **MCP tools** (from DB per-tenant): External servers via stdio/SSE/HTTP transports

Tool groups are the unit of custom-agent whitelisting. The platform defines `web`, `file:read`, `file:write` and `bash` (`DEFAULT_TOOL_GROUPS` in `packages/harness/deerflow/config/tool_config.py`, extensible through `tools` / `tool_groups` in `config.yaml`); every MCP server name is also a group, covering the tools that server exposes. An agent whose `tool_groups` is empty gets all of them; a non-empty whitelist keeps only the named groups plus the ungrouped plumbing tools (`present_files`, `ask_clarification`, `task`, `view_image`, `tool_search`, `search_knowledge_base`), and when tool search is active only whitelisted MCP tools are discoverable. The gateway rejects a whitelist naming a group the tenant does not have (HTTP 422), so a tenant member cannot widen their own agent's reach.

## Configuration Flow

```
┌─────────────────────────────────────────────────────────┐
│ config.yaml (platform-level fallback only)               │
│  - Sandbox, Logging, Summarization, Tool Groups         │
│  - Database connection strings                           │
│  - Storage backend (local | minio)      -- v2.0          │
└───────────────────────┬─────────────────────────────────┘
                        │
                ┌───────▼───────┐
                │  Tenant DB     │
                │  ─────────────│
                │  Models        │ ← Platform/Tenant admin via UI
                │  MCP Servers   │
                │  Skills        │
                │  User Configs  │ ← Per-user runtime overrides
                └───────┬───────┘
                        │
                ┌───────▼───────┐
                │  contextvars   │
                │  Proxy Layer   │
                │  get_app_config│
                │  get_extensions│
                └───────┬───────┘
                        │
                ┌───────▼───────┐
                │  Agent Runtime │ (unchanged)
                │  factory.py    │
                │  tool loader   │
                │  skill loader  │
                └───────────────┘
```

## Deployment Model

### Philosophy

OpsinTech targets both quick onboarding and production-grade operations. We support dual deployment paths — not an either/or choice.

| Environment                 | Deployment        | Target Audience                                  |
| --------------------------- | ----------------- | ------------------------------------------------ |
| **Dev / Try-out**           | Docker Compose    | Individual developers, single-command evaluation |
| **PoC / Small team**        | Docker Compose    | Internal pilot, single-node deployment           |
| **Production / Enterprise** | Helm + Kubernetes | HA, rolling updates, horizontal scaling          |

**Docker Compose is the v1.0 default** because it minimizes friction: `docker compose up -d` gets you running. As OpsinTech matures toward v1.1, a Helm chart becomes the recommended production path.

### Configuration in Each Mode

| Aspect                     | Docker Compose                    | Helm + K8s                               |
| -------------------------- | --------------------------------- | ---------------------------------------- |
| Platform settings          | `config.yaml` (file mount)        | `values.yaml` → ConfigMap + Secret       |
| Model / MCP / Skill config | Database (unchanged across modes) | Database (unchanged)                     |
| Secrets                    | `.env` file                       | K8s Secret / External Secrets Operator   |
| Storage                    | Host volume bind                  | PVC / MinIO S3                           |
| Sandbox                    | Local or Docker socket mount      | Docker socket or K8s Pod via provisioner |

### Why Helm

- OpsinTech comprises 5+ services (nginx, frontend, gateway, langgraph, db-init, optionally postgres, provisioner, MinIO). Helm templates make this manageable.
- `values.yaml` maps naturally to the current `config.yaml` structure — migration is straightforward.
- Enterprise buyers expect Helm. Offering it signals production readiness.
- Helm's `--set` and values file overrides enable per-environment customization (staging vs prod) without config drift.

