/* Migration 003 – Billing: credits, plan tracking, top-up history
   Run once against the live database.
   Safe to re-run (all DDL is guarded with IF NOT EXISTS / column existence checks).
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* 1. Add PlanName + CreditBalance columns to Subscriptions (if not present) */
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Subscriptions') AND name = 'PlanName'
)
  ALTER TABLE dbo.Subscriptions ADD PlanName NVARCHAR(64) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Subscriptions') AND name = 'CreditBalance'
)
  ALTER TABLE dbo.Subscriptions ADD CreditBalance INT NOT NULL DEFAULT 0;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Subscriptions') AND name = 'CancelAtPeriodEnd'
)
  ALTER TABLE dbo.Subscriptions ADD CancelAtPeriodEnd BIT NOT NULL DEFAULT 0;
GO

/* 2. CreditTopUps – records every credit purchase (one-time payment) */
IF OBJECT_ID('dbo.CreditTopUps','U') IS NULL
BEGIN
  CREATE TABLE dbo.CreditTopUps (
    TopUpId           INT IDENTITY(1,1) PRIMARY KEY,
    TenantId          INT NOT NULL REFERENCES dbo.Tenants(TenantId) ON DELETE CASCADE,
    StripeSessionId   NVARCHAR(256) NULL,
    StripePaymentIntent NVARCHAR(256) NULL,
    Credits           INT NOT NULL,           -- credits added
    AmountCents       INT NOT NULL,           -- amount charged in cents
    Currency          NVARCHAR(16) NOT NULL DEFAULT 'usd',
    Status            NVARCHAR(32) NOT NULL DEFAULT 'pending',  -- pending | paid | refunded
    CreatedAt         DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_CreditTopUps_Tenant ON dbo.CreditTopUps(TenantId, CreatedAt DESC);
END
GO

/* 3. CreditUsage – debit log (optional but useful for auditing) */
IF OBJECT_ID('dbo.CreditUsage','U') IS NULL
BEGIN
  CREATE TABLE dbo.CreditUsage (
    UsageId     INT IDENTITY(1,1) PRIMARY KEY,
    TenantId    INT NOT NULL REFERENCES dbo.Tenants(TenantId) ON DELETE CASCADE,
    UserId      INT NULL REFERENCES dbo.Users(UserId),
    Credits     INT NOT NULL,        -- negative = debit, positive = manual credit
    Reason      NVARCHAR(256) NULL,
    CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_CreditUsage_Tenant ON dbo.CreditUsage(TenantId, CreatedAt DESC);
END
GO
