-- Create the account oracle-mcp connects with, for ONE tenant.
--
-- Run this once per tenant, changing the names marked <<...>>. Each tenant
-- gets its own account: the MCP server decides which account a request runs
-- under from the bearer token, and nothing a caller can say changes that. One
-- shared account taking a tenant parameter would put that decision back in the
-- request, which is the thing being avoided.
--
-- Run as a DBA. The grants below are the control that actually holds -- the
-- server's SQL parser is a second layer that gives a fast, clear refusal, but
-- a language model writes the queries, so assume one day something gets past
-- it and make sure that statement still cannot write.

-- ---------------------------------------------------------------------------
-- A resource profile, so one bad query cannot take the database with it.
-- ---------------------------------------------------------------------------
-- These are enforced by Oracle regardless of what the MCP server does, which
-- is the point: the server's own call_timeout only stops it from *waiting*.
--
-- Requires RESOURCE_LIMIT=TRUE on the instance:
--   ALTER SYSTEM SET resource_limit = TRUE SCOPE = BOTH;
CREATE PROFILE mcp_reader_profile LIMIT
  -- Hundredths of a second of CPU per call. ~30s: generous for a report,
  -- fatal to a runaway cartesian join.
  CPU_PER_CALL            3000
  -- Blocks read per call. The number to tune first if legitimate reports get
  -- killed; raise it before raising CPU_PER_CALL.
  LOGICAL_READS_PER_CALL  1000000
  SESSIONS_PER_USER       8
  IDLE_TIME               15
  CONNECT_TIME            120
  PASSWORD_LIFE_TIME      90
  FAILED_LOGIN_ATTEMPTS   10;

-- ---------------------------------------------------------------------------
-- The account.
-- ---------------------------------------------------------------------------
-- Note what is NOT granted: no CREATE SESSION on anything beyond this, no
-- quota on any tablespace (so it cannot create a table even if it somehow got
-- the privilege), and no RESOURCE or CONNECT role. CREATE SESSION is the only
-- system privilege it needs.
CREATE USER <<TENANT_A_READER>>
  IDENTIFIED BY "<<put-a-generated-password-here>>"
  DEFAULT TABLESPACE users
  QUOTA 0 ON users
  PROFILE mcp_reader_profile
  PASSWORD EXPIRE AT NEXT LOGIN DISABLE;

GRANT CREATE SESSION TO <<TENANT_A_READER>>;

-- ---------------------------------------------------------------------------
-- Read access, object by object.
-- ---------------------------------------------------------------------------
-- Grant on the curated views from 02_example_views.sql, never on base tables.
-- A view is where joins and masking live, which means the model writes simpler
-- SQL (so it gets the answer right more often) and the columns it must not see
-- never leave the database.
GRANT SELECT ON rpt.v_subscriber TO <<TENANT_A_READER>>;
GRANT SELECT ON rpt.v_invoice    TO <<TENANT_A_READER>>;

-- Optional: let the account describe its own readable objects, which is what
-- the describe_view tool uses. ALL_TAB_COLUMNS and ALL_COL_COMMENTS are
-- already visible to any session, restricted by Oracle to objects the account
-- has privileges on, so this needs no grant. It is called out because it looks
-- like it should: there is no "GRANT SELECT ON all_tab_columns" here, and its
-- absence is not an oversight.

-- ---------------------------------------------------------------------------
-- Verify, before handing the credentials to the server.
-- ---------------------------------------------------------------------------
-- Connect as the new account and confirm all four of these:
--
--   -- 1. the read works
--   SELECT COUNT(*) FROM rpt.v_subscriber;
--
--   -- 2. a write does not. Expect ORA-01031 or ORA-00942.
--   DELETE FROM rpt.v_subscriber WHERE 1 = 0;
--
--   -- 3. the base table is not reachable. Expect ORA-00942.
--   SELECT COUNT(*) FROM core.subscriber;
--
--   -- 4. it cannot create anything. Expect ORA-01031.
--   CREATE TABLE scratch (x NUMBER);
--
-- If any of 2-4 succeeds, stop and fix the grants. Do not rely on the server
-- to compensate.
