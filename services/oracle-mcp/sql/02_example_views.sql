-- Example curated views, to be replaced with the real ones.
--
-- The shape is what matters here, not the columns. Three things are being
-- demonstrated:
--
--   1. The view joins what a question needs, so the model does not have to
--      work out a five-table join. Wrong joins are the main source of
--      confidently wrong answers.
--   2. The view masks what the model must not see. Masking in the view means
--      the data never leaves Oracle; masking in the MCP server would mean it
--      crosses the network first and lands in a log.
--   3. Every column carries a COMMENT. describe_view returns these, and they
--      are the difference between the model guessing what STATUS = 'A' means
--      and knowing.

CREATE OR REPLACE VIEW rpt.v_subscriber AS
SELECT
    s.subscriber_id,
    -- Masked: the last four digits are enough to discuss an account, and a
    -- full subscriber list is the thing most worth not leaking.
    'xxxxxx' || SUBSTR(s.msisdn, -4)          AS msisdn_masked,
    s.status_code,
    -- Decoded on the way out. The model cannot be expected to know the
    -- internal code table, and asking it to join to one invites mistakes.
    CASE s.status_code
        WHEN 'A' THEN 'ACTIVE'
        WHEN 'S' THEN 'SUSPENDED'
        WHEN 'T' THEN 'TERMINATED'
        ELSE 'UNKNOWN'
    END                                       AS status,
    p.plan_name,
    p.monthly_fee,
    s.activated_on,
    s.province_code,
    pr.province_name
  FROM core.subscriber s
  JOIN core.plan      p  ON p.plan_id = s.plan_id
  LEFT JOIN core.province pr ON pr.province_code = s.province_code
 WHERE s.is_test_account = 0;

COMMENT ON TABLE  rpt.v_subscriber IS
  'One row per subscriber, excluding test accounts. MSISDN is masked to the last four digits.';
COMMENT ON COLUMN rpt.v_subscriber.subscriber_id  IS 'Primary key. Join key for v_invoice.';
COMMENT ON COLUMN rpt.v_subscriber.msisdn_masked  IS 'Phone number, masked. Last four digits only.';
COMMENT ON COLUMN rpt.v_subscriber.status_code    IS 'Raw code: A, S or T. Prefer the status column.';
COMMENT ON COLUMN rpt.v_subscriber.status         IS 'ACTIVE, SUSPENDED, TERMINATED or UNKNOWN.';
COMMENT ON COLUMN rpt.v_subscriber.plan_name      IS 'Tariff plan name.';
COMMENT ON COLUMN rpt.v_subscriber.monthly_fee    IS 'Plan monthly fee, VND.';
COMMENT ON COLUMN rpt.v_subscriber.activated_on   IS 'Date the line was activated.';
COMMENT ON COLUMN rpt.v_subscriber.province_code  IS 'Province code. Join key for reference data.';
COMMENT ON COLUMN rpt.v_subscriber.province_name  IS 'Province name in Vietnamese.';


CREATE OR REPLACE VIEW rpt.v_invoice AS
SELECT
    i.invoice_id,
    i.subscriber_id,
    i.billing_period,
    i.amount,
    i.currency,
    i.status            AS invoice_status,
    i.issued_on,
    i.due_on,
    i.settled_on
  FROM core.invoice i
 -- Bounded on purpose. Without this the view is an invitation to scan years of
 -- billing history to answer a question about last month, and the row cap then
 -- truncates the answer after the damage is done.
 WHERE i.issued_on >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -24);

COMMENT ON TABLE  rpt.v_invoice IS
  'Invoices issued in the last 24 months. Join to v_subscriber on subscriber_id.';
COMMENT ON COLUMN rpt.v_invoice.invoice_id      IS 'Primary key.';
COMMENT ON COLUMN rpt.v_invoice.subscriber_id   IS 'Join key to v_subscriber.';
COMMENT ON COLUMN rpt.v_invoice.billing_period  IS 'Billing month, YYYYMM.';
COMMENT ON COLUMN rpt.v_invoice.amount          IS 'Invoice total in the currency column.';
COMMENT ON COLUMN rpt.v_invoice.invoice_status  IS 'ISSUED, PAID, OVERDUE or CANCELLED.';
COMMENT ON COLUMN rpt.v_invoice.settled_on      IS 'Payment date, NULL while unpaid.';
