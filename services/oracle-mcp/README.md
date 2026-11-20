# oracle-mcp

Read-only access to curated Oracle reporting views, exposed to the agents as an
MCP server over streamable HTTP.

## Why it is shaped this way

The platform already has everything needed to govern an external tool: the
`tenant_mcp_servers` table is tenant-scoped with a per-tenant enable flag, and
`_tenant_mcp_tool_groups` in `app/gateway/routers/agents.py` feeds the
fail-closed tool whitelist. Registering Oracle access as an MCP server means it
inherits the capability model, the per-tenant isolation and that whitelist
without any of it being reimplemented. Building a database connector into the
gateway instead would have duplicated all of it and created a second path for
credentials to travel.

It runs as its own container rather than as a `stdio` MCP server inside the
gateway. A `stdio` server would put the Oracle driver and the database password
into the gateway image and its process tree; `http` keeps both here.

The driver is **python-oracledb in thin mode** — pure Python, no Oracle Instant
Client, no `LD_LIBRARY_PATH`. Thick mode is only needed for Oracle Wallet /
mTLS and Advanced Queuing, none of which this server uses.

## Security model

Four controls, in order of how much they matter.

**1. The Oracle grant.** The account connects with `SELECT` on the listed views
and `CREATE SESSION`, nothing else. A language model writes the SQL here, so
assume that one day something gets past the parser — the grant is what makes
that harmless. `sql/01_create_reader.sql` ends with four statements to run as
the new account to prove it cannot write, cannot reach the base tables and
cannot create anything. Run them.

**2. Curated views.** `sql/02_example_views.sql` shows the shape: joins
pre-made so the model does not have to get a five-table join right, sensitive
columns masked *in the view* so they never leave the database, and a `COMMENT`
on every column because `describe_view` returns them and they are the
difference between the model knowing what `STATUS = 'A'` means and guessing.

**3. The SQL parser.** `sql_guard.py` refuses anything that is not a single
`SELECT`. It parses with sqlglot rather than matching patterns, because a
keyword scan is wrong in both directions: `SELECT 'delete me'` is a read and
`/* select */ DELETE FROM x` is a write. It also refuses semicolon batches,
`FOR UPDATE` (it reads, but takes locks a production writer needs), and
references to objects outside the profile's allow-list.

**4. Resource limits.** A profile with `CPU_PER_CALL` and
`LOGICAL_READS_PER_CALL`, enforced by Oracle whatever this server does, plus a
`call_timeout` and a row cap here.

### What is not protected

- **The token is stored in plaintext by the platform.**
  `tenant_mcp_servers.headers` is a plain JSON column in Postgres. Treat the
  token as readable by anyone who can read the platform database. That is the
  reason the Oracle password is not there: leaking a token grants the access
  that tenant already had, and nothing more.
- **Timing of token comparison is handled, but not tested.** `resolve_token`
  uses `hmac.compare_digest` against every profile. No functional test can
  detect its removal, so if you change that function, the tests will not tell
  you.
- **The Oracle round trip is untested.** Everything up to and including the
  driver call is verified (see below); no test here has ever talked to a real
  Oracle instance. Run the four verification statements in
  `sql/01_create_reader.sql` and one real query before trusting it.

## Setup

### 1. Oracle side, once per tenant

```sql
-- as a DBA, editing the <<...>> names
@sql/01_create_reader.sql
@sql/02_example_views.sql   -- replace with your real views
```

Then run the four verification statements at the bottom of
`01_create_reader.sql` **as the new account**. If any of the three that should
fail succeeds, fix the grants before going further.

### 2. The profile file

Copy `profiles.example.json` to somewhere outside this repository, one entry
per tenant:

```bash
cp profiles.example.json /etc/opsinvnpt/oracle-mcp-profiles.json
python -c "import secrets; print(secrets.token_urlsafe(32))"   # per tenant
```

It holds Oracle passwords. `.gitignore` covers `profiles.json` here, but the
file belongs outside the repository anyway.

### 3. Start it

```bash
export ORACLE_MCP_PROFILES_FILE=/etc/opsinvnpt/oracle-mcp-profiles.json
docker compose -p opsinvnpt --profile oracle up -d oracle-mcp
```

It is not published on a host port and nginx does not proxy it — only the
gateway needs to reach it, over the internal network. It refuses to start if
the profile file is missing or malformed, rather than coming up healthy and
answering every request with a 401.

### 4. Register it in the platform

Once per tenant, as that tenant's admin, under **Tools → register**:

| field | value |
|---|---|
| name | `oracle` |
| type | `http` |
| url | `http://vnpt-oracle-mcp:8900/mcp` |
| headers | `{"Authorization": "Bearer <that tenant's token>"}` |

One registration per tenant, each with its own token and therefore its own
Oracle account. Do **not** build a shared registration that passes a tenant id
as a tool argument: a request naming its own tenant and being believed is
exactly the bug class fixed in commit `3085816`, and the whole point of the
token is that nothing a caller says changes which account its query runs under.

## Tools

| tool | what it does |
|---|---|
| `list_views` | the objects this connection may read |
| `describe_view(object_name)` | columns, types and comments, read from Oracle's own dictionary so it cannot drift |
| `run_query(sql)` | one `SELECT`, capped, with a statement timeout |

A truncated result says so, and says to narrow the query rather than to page
through it.

## Tests

```bash
uv venv .venv
uv pip install --python .venv/Scripts/python.exe "sqlglot>=27,<29" pytest
.venv/Scripts/python.exe -m pytest -q
```

79 tests, covering the guard and the profile loader. They deliberately do not
import `db.py`, so they run without the Oracle driver installed.

The guard and loader tests were checked by mutation — breaking each control in
turn and confirming a test goes red. One mutation was *not* caught and is worth
knowing about: deleting the `_FORBIDDEN_NODES` scan changed nothing, because
every write and DDL form sqlglot parses from Oracle SQL appears at the root of
the tree, where `_ALLOWED_ROOTS` already rejects it. The scan is kept as a
guard against a future sqlglot release nesting one, and is tested directly on a
constructed tree since no SQL string can reach it.

## What has been verified

End to end against the running container, with no Oracle behind it:

- it exits non-zero with a clear message when the profile file is absent
- `/healthz` → 204 without a token
- `/mcp` → 401 with no token, a wrong token, and a token one character short
- `/mcp` → 200 with the right token; the three tools are discoverable
- `run_query("DELETE ...")` → refused, naming `DELETE`
- `run_query("SELECT * FROM core.billing")` → refused, naming the unlisted object
- a legitimate `SELECT` reaches the driver and fails on connection, reporting a
  generic message to the caller while the container log keeps the profile, DSN
  and traceback

That last one started as a leak: a DSN that does not resolve raises
`socket.gaierror`, not `oracledb.Error`, so the original narrow `except` let
the internal hostname through to the model. Both the connect and statement
paths now catch broadly and report generically.
