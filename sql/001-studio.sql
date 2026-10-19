CREATE TABLE IF NOT EXISTS studio_projects (
  id text PRIMARY KEY,
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studio_campaign_archives (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES studio_projects(id),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
