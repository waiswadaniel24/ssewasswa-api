module.exports = {
  up: (pgm) => {
    pgm.sql(`
      CREATE TABLE IF NOT EXISTS pages (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        slug VARCHAR(100) NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
        is_published BOOLEAN DEFAULT false,
        published_at TIMESTAMPTZ,
        page_type TEXT DEFAULT 'custom' CHECK (page_type IN ('custom', 'landing', 'transparency', 'fundraising', 'about')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT uq_pages_tenant_slug UNIQUE (tenant_id, slug)
      );
    `);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_pages_tenant ON pages(tenant_id, is_published)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug) WHERE is_published = true`);
  },
  down: (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS pages`);
  },
};
