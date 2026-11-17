# OpsinTech Platform

[中文](./README_zh.md) | English

[![Python](https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white)](./backend/pyproject.toml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](./Makefile)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Built on DeerFlow](https://img.shields.io/badge/Built_on-DeerFlow-8A2BE2)](https://github.com/bytedance/deer-flow)

OpsinTech is an **AI-Native Operations Platform for production environments**. v1.0 is built on [DeerFlow](https://github.com/bytedance/deer-flow)'s Agent runtime (ByteDance, GitHub Trending #1), with multi-tenancy, RBAC, audit logging, visual admin dashboards, and database-driven configuration layered on top.

> **Our mission: turn AI Agents from impressive demos into governed, enterprise-ready platforms.**

## Table of Contents

- [Platform Features](#platform-features)
- [Why OpsinTech Exists](#why-opsintech-exists)
- [What We've Built](#what-weve-built)
- [Our Vision](#our-vision)
- [Roadmap](#roadmap)
- [Quick Start](#quick-start)
- [Supported Models](#supported-models)
- [Internationalization](#internationalization)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgments](#acknowledgments)

## Platform Features

OpsinTech transforms AI Agents into a governed production platform with the following capabilities:

### 🏠 Multi-Tenancy Workspace
A unified workspace with three-tier resource isolation (`user → tenant → global`). Each user gets a personal tenant on registration, and tenant admins manage members, models, tools, and skills independently.

**Modules:**
- **Overview** — Dashboard with key metrics and quick actions
- **Agent Gallery** — Browse and select AI agents for different tasks
- **Chat Workspace** — Conversational AI interface with artifact management
- **Terminal Agent** — Governed terminal with AI-assisted command execution, asset management, and approval workflows
- **Knowledge Base** — Per-tenant document ingestion with hybrid retrieval, searchable by agents
- **Files** — Folder-organized file storage with upload, preview, and download
- **Skill Editor** — Create, edit, and test AI Skills with sandbox testing and AI-assisted instruction generation
- **Incident Management** — Alert ingestion, signal analysis, and incident lifecycle tracking

### 🤖 Agent Capabilities

| Capability | Description |
|---|---|
| **Chat Agent** | Conversational AI with task decomposition, sub-agent parallelism, and artifact generation |
| **Terminal Agent** | AI-assisted terminal with security governance, command approval, and multi-host asset management |
| **Knowledge Base** | Per-tenant document ingestion (PDF · DOCX · MD · HTML · CSV · JSON · YAML · TXT · LOG) with hybrid BM25 + vector retrieval, exposed to agents as a search tool |
| **IM Channels** | Reach agents from Feishu/Lark, Slack, or Telegram — outbound connections only, no public IP required |
| **Skill System** | Reusable AI Skill templates with sandbox testing environment |
| **MCP Servers** | Configurable MCP servers per tenant (stdio/SSE/HTTP transports) |
| **Sandbox Execution** | Isolated code execution (local / Docker / Kubernetes modes) |

### 🔐 Security & Governance

| Feature | Description |
|---|---|
| **RBAC** | Three-tier roles: `platform_admin` / `tenant_admin` / `tenant_member` |
| **Audit Trail** | Full operation audit logging with per-tenant isolation |
| **Terminal Security** | Command approval workflows, credential management, execution audit |
| **User Management** | Status management (active / suspended), mandatory password rotation |

### 🌐 Platform Administration

| Dashboard | Scope |
|---|---|
| **Platform Admin** | Users, tenants, global audit, model templates, announcements |
| **Tenant Admin** | Members, models, tools, skills, MCP servers, custom agents, alert sources & rules, IM channels |

### 🎨 User Experience

- **5-Language i18n**: English · 中文 · 日本語 · 한국어 · Tiếng Việt
- **Model Provider Templates**: 20+ pre-configured providers with auto-filled settings
- **Docker One-Click Deploy**: `make up` to get everything running
- **Hot-Reload Dev Mode**: `make dev` for local development

---

## Why OpsinTech Exists

### DeerFlow: A Proven Agent Runtime

DeerFlow proved that AI Agents can go beyond chat — they can plan, decompose tasks, execute code in isolated sandboxes, and produce real files and deliverables. Sub-agent parallelism, persistent memory, sandbox isolation — these capabilities earned it 37K+ GitHub stars, and deservedly so.

### From Agent Runtime to Production Platform

DeerFlow excels as an Agent runtime and developer toolkit. OpsinTech builds on top of it to address what teams need when moving from evaluation to production:

| Scenario | DeerFlow | OpsinTech Enhancement |
|---|---|---|
| **Team Collaboration** | Single-user mode | Multi-tenancy with `user → tenant → global` isolation |
| **Access Control** | No role-based permissions | RBAC with `platform_admin` / `tenant_admin` / `tenant_member` |
| **Model Configuration** | Hand-edited YAML files | 20+ provider templates in admin UI, database-backed, per-tenant assignment |
| **Administration** | Command-line scripts only | Visual admin dashboards for both platform and tenant levels |
| **Audit & Compliance** | No operation traceability | Full audit trail for all operations, per-tenant isolation |
| **Skills & MCP** | Functional runtime, manual setup | Per-tenant management via admin UI, lifecycle tracking |
| **Security Governance** | Basic sandbox isolation | User status management, mandatory password rotation, operation audit |
| **Onboarding** | Configuration-heavy, steep learning curve | Docker one-command deploy, admin UI-driven setup |

### Our Approach

We're not starting from scratch. DeerFlow's Agent runtime is one of the most mature in open source, and for v1.0 we chose to inherit it — then layer on what teams need to use it in production.

**Short-term (v1.x)**: Keep DeerFlow's runtime, add the governance layer — multi-tenancy, RBAC, audit, admin dashboards, database-backed config, model provider templates.

**Long-term (v2.x+)**: Gradually replace DeerFlow internal dependencies with our own architecture, incorporating real operations scenarios — alert ingestion, incident management, workflow orchestration, governed terminals — to form a true AI-Native Operations Platform.

## What We've Built

### Multi-Tenancy & RBAC

- **Three-tier resource isolation**: `user → tenant → global`, strict data separation
- **Two admin dashboards**: Platform admin (users, tenants, audit, model templates) + Tenant admin (members, models, tools, skills)
- **Auto-created personal tenant** on registration, zero manual setup
- Roles: `platform_admin` / `tenant_admin` / `tenant_member`

### Model Management, Done Right

- **20+ provider templates** in the admin UI — dropdown to select, auto-fills provider class, base URL, and capability flags. No LangChain class paths to memorize
- Models stored in database, assigned per-tenant, with active / deprecated / retired lifecycle
- Providers: OpenAI · Anthropic · DeepSeek · Azure OpenAI · Gemini · Ollama · OpenRouter · Groq · Together AI · SiliconFlow · DashScope · Zhipu · Moonshot · MiniMax · Baichuan · 01.AI · Volcengine Ark · Novita AI

### Terminal Agent

- **Governed Terminal Execution**: AI-assisted command execution with security policies
- **Multi-Host Asset Management**: Register and manage multiple target hosts
- **Command Approval Workflow**: Security review and approval before execution
- **Audit Trail**: Every command and its output is logged and auditable
- **Skill Integration**: Save terminal sessions as reusable Skills

### Skill System

- **Skill Editor**: Full-featured editor with Markdown instruction editing
- **AI-Assisted Generation**: Describe what you want, AI generates structured instructions
- **Sandbox Testing**: Test Skills in a safe mock environment before production use
- **Per-Tenant Management**: Skills scoped to personal, tenant, or global levels

### Incident Management

- **Alert Ingestion**: Prometheus Alertmanager · Grafana · Datadog · CloudWatch · generic webhook, each source authenticated by its own token
- **Signal Analysis**: Raw alerts normalized into signals, deduplicated by fingerprint
- **Incident Lifecycle**: Aggregate signals into incidents, then claim / assign / suppress / resolve
- **Alert Rules**: Per-tenant rules evaluated against signals, with escalation and source health monitoring
- **AI Analysis**: Automated context assembly, root cause analysis, and streaming diagnosis over SSE
- **Change Correlation**: Ingest CI/CD change events to correlate deploys with incidents
- **Ticketing**: Push an incident to an external ticket system

### Knowledge Base

- **Document Ingestion**: PDF · DOCX · Markdown · HTML · CSV · JSON · YAML · TXT · LOG, chunked paragraph- and sentence-aware
- **Hybrid Retrieval**: BM25 lexical scoring plus vector cosine similarity; embeddings are optional, so lexical search works with no extra service
- **Agent Integration**: Exposed to agents as a tenant-scoped search tool
- **Per-Tenant Isolation**: Knowledge bases, documents, and chunks scoped to the tenant

### IM Channels

- **Feishu/Lark** (WebSocket), **Slack** (Socket Mode), **Telegram** (long polling) — all outbound, no public IP or inbound webhook needed
- Messages bridge to agent threads through an async message bus, with chat-to-thread mappings persisted
- Managed per tenant from the admin UI, with restart and test-notification actions

### Audit & Security

- Full audit trail for all operations, per-tenant isolation
- User status management (active / suspended)
- Mandatory password change on first login

### Internationalization

- UI supports 5 languages: English, 中文, 日本語, 한국어, Tiếng Việt
- Auto-detects browser language preference with manual switcher
- Restrict the set offered to users with `NEXT_PUBLIC_SUPPORTED_LOCALES` (e.g. `en-US,vi`)

### Deployment & Operations

- **Docker one-command deploy**: `docker compose up -d`
- Artifact management: browse, preview, download all agent-generated files
- Platform announcement system with tenant/role targeting

## Our Vision

OpsinTech is not "DeerFlow with a dashboard." We're building a **secure, governed, AI-Native Operations Platform for production environments**.

On this platform, Agents don't just chat and generate code — they operate within boundaries: permission controls, audit records, execution approvals. Starting from Agent conversations, progressively extending into alerting, incidents, workflows, and terminal execution, ultimately forming a complete chain:

> **Discover → Understand → Decide → Execute → Audit**

This space is almost entirely vacant in open source. That's why we need community voices.

**Who we're looking for**: If you work in operations, security, compliance, or platform engineering, and you're excited by AI Agents but can't use them in production because of missing governance and security — you're exactly who we're building for. Your pain points and suggestions are OpsinTech's roadmap.

## Roadmap

```
✅ v1.0 — Governable AI Agent Platform
  ├─ Multi-tenancy + RBAC + Audit
  ├─ 20+ model provider templates, database-backed
  ├─ Visual admin dashboards (platform + tenant)
  ├─ Terminal Agent with security governance and audit trail
  ├─ Skill System with sandbox testing
  └─ Docker one-command deploy

✅ v1.1 (Current) — Smart Alerting, Knowledge & IM
  ├─ Alertmanager / Grafana / Datadog / CloudWatch / webhook ingestion
  ├─ Raw Alert → Signal → Incident pipeline with fingerprint dedup
  ├─ Alert rules, escalation, source health monitoring, external ticketing
  ├─ AI incident analysis + streaming diagnosis (SSE)
  ├─ Knowledge Base: hybrid BM25 + vector retrieval, searchable by agents
  └─ IM channels: Feishu/Lark, Slack, Telegram

🔜 v1.2 — Workflows
  ├─ Event-driven workflow engine
  ├─ SOP templates (service restart, log collection, health checks)
  └─ Full closed loop: Alert → Incident → Workflow → Terminal → Audit

📋 v2.0 — Digital Operators & Ecosystem
  ├─ Custom Agents: SOUL.md + tool_groups whitelist + Skill/Workflow binding
  ├─ Auto-route alerts to agent operators
  ├─ Skill marketplace: community contributions + official scenarios
  ├─ AI Analysis Workbench: data analysis, reports, PPT generation
  └─ Gradual replacement of DeerFlow internals with our own architecture
```

## Quick Start

1. **Clone and configure**

   ```bash
   git clone https://github.com/opsintech/opsintech-platform.git
   cd opsintech-platform
   make config
   ```

   Generates `config.yaml` with platform-level settings (database, sandbox, checkpointer). **No model configuration needed.**

2. **Start and log in**

   ```bash
   make up
   ```

   Open http://localhost:2026. On first visit, you'll be redirected to the Setup Wizard to set your admin email and password.

   > You can also use `docker compose up -d`, but `make up` handles config initialization and secret generation automatically.

3. **Add models via admin UI**

   Log in as platform admin, go to **Settings → Models**, pick from 20+ provider templates, enter your API key.

   > Models are stored in the database. Do **not** configure models in `config.yaml` for production.

### Running Options

**Docker production**:
```bash
make up              # Build images and start all services (recommended for first deploy)
make up-nobuild      # Start services without rebuilding images
make down            # Stop and remove containers
make rebuild-images  # Remove all OpsinTech images and rebuild from scratch
```

**Local development**:
```bash
make check           # Verify prerequisites (Node.js 22+, pnpm, uv, nginx)
make install         # Install dependencies
make dev             # Start dev servers (with hot-reload)
make stop            # Stop all services
```

**Docker development**:
```bash
make docker-init     # Pull sandbox image
make docker-start    # Start Docker dev services
make docker-stop     # Stop Docker dev services
make docker-logs     # View all logs
```

Access: http://localhost:2026

### China Users: Preparing Images

In China, pulling base images during Docker builds may fail due to network issues. Pre-pull before building:

```bash
# Required images
docker pull python:3.12-slim
docker pull node:22-alpine
docker pull nginx:alpine
docker pull docker:cli

# Build-stage dependency
docker pull ghcr.io/astral-sh/uv:0.9.26

# Optional images
docker pull postgres:16-alpine          # PostgreSQL mode
docker pull enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest  # Sandbox
```

For mirror accelerator setup, see the [Quick Start Guide](QUICKSTART.md#china-users-preparing-images-for-local-builds).

### Advanced

#### Database

SQLite is the zero-dependency default. For production, switch `database` (and `checkpointer`) in `config.yaml` to PostgreSQL and start the bundled instance with its compose profile:

```bash
docker compose --profile postgres up -d
```

See [Configuration Guide](backend/docs/CONFIGURATION.md).

#### Knowledge Base Embeddings

Hybrid retrieval falls back to BM25 lexical search when no embedding endpoint is configured. To enable vector search, point these at any OpenAI-compatible `/embeddings` endpoint:

```bash
RAG_EMBEDDING_BASE_URL=https://api.openai.com/v1
RAG_EMBEDDING_API_KEY=sk-...
RAG_EMBEDDING_MODEL=text-embedding-3-small
```

#### Sandbox Mode

Three execution modes: Local / Docker containers / Docker + Kubernetes. See [Sandbox Guide](backend/docs/CONFIGURATION.md#sandbox).

#### MCP Server

Configurable MCP servers (managed per-tenant via admin UI). Supports stdio/SSE/HTTP transports with OAuth token flows.

## Supported Models

| Category | Providers |
|---|---|
| **Global Leaders** | OpenAI · Anthropic · DeepSeek · Azure OpenAI · Gemini |
| **Aggregators** | OpenRouter · Groq · Together AI |
| **Self-Hosted** | Ollama |
| **China-Based** | DashScope · Zhipu · Moonshot · MiniMax · Baichuan · 01.AI · Volcengine Ark · SiliconFlow |
| **Other** | Novita AI · Any OpenAI-compatible provider |


## Documentation

- [5-Minute Quick Start](QUICKSTART.md)
- [Configuration Guide](backend/docs/CONFIGURATION.md)
- [Architecture Overview](backend/docs/ARCHITECTURE.md)
- [API Reference](backend/docs/API.md)
- [Contributing Guide](CONTRIBUTING.md)

## Contributing

We welcome contributions — code, documentation, scenario suggestions, or real-world pain points. Open an Issue or PR.

## License

MIT License. See [LICENSE](./LICENSE).

## Acknowledgments

### DeerFlow

v1.0 is built on [DeerFlow](https://github.com/bytedance/deer-flow) (by ByteDance). DeerFlow's Agent runtime — LangGraph orchestration, sub-agent parallelism, sandboxed execution, persistent memory — is one of the best Agent infrastructures in open source. Deep gratitude to the DeerFlow team and community.

**Our relationship with DeerFlow**: In v1.x, we inherit DeerFlow's Agent runtime and add governance. As we evolve, we'll gradually replace internal dependencies and form our own architecture. OpsinTech's long-term identity is not a DeerFlow fork — it's an independent, operations-focused AI-Native platform.

### Open-Source Community

- [LangChain](https://github.com/langchain-ai/langchain)
- [LangGraph](https://github.com/langchain-ai/langgraph)
- [Next.js](https://nextjs.org/)
