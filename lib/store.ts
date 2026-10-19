import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { initialProject, isActiveJob, type Project } from "./domain";

export function cloudStorage() {
  return process.env.STUDIO_STORAGE === "cloud";
}
export function dataDir() {
  if (process.env.VERCEL && !cloudStorage())
    throw new Error(
      "Configure STUDIO_STORAGE=cloud, Neon and Blob before deploying.",
    );
  const directory =
    process.env.STUDIO_DATA_DIR ||
    (cloudStorage()
      ? path.join(tmpdir(), "minimax-studio")
      : path.resolve(".studio"));
  if (!path.isAbsolute(directory))
    throw new Error("STUDIO_DATA_DIR must be absolute.");
  return directory;
}
export function mediaDir() {
  const dir = path.join(dataDir(), "media");
  mkdirSync(dir, { recursive: true });
  return dir;
}
export function mediaPath(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid asset ID.");
  return path.join(mediaDir(), id);
}
let database: DatabaseSync | undefined;
function db() {
  if (!database) {
    mkdirSync(dataDir(), { recursive: true });
    database = new DatabaseSync(path.join(dataDir(), "studio.sqlite"));
    database.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, document TEXT NOT NULL)",
    );
  }
  return database;
}
let pool: Pool | undefined;
export function postgresPool() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required for hosted storage.");
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 5000,
    });
    if (process.env.VERCEL) attachDatabasePool(pool);
  }
  return pool;
}
function usePostgres() {
  if(cloudStorage() && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for hosted storage.");
  return Boolean(process.env.DATABASE_URL);
}
function projectId() {
  return process.env.STUDIO_PROJECT_ID || "m31-launch";
}
function localRead(database: DatabaseSync): Project {
  const row = database
    .prepare("SELECT document FROM projects WHERE id = ?")
    .get(projectId()) as { document: string } | undefined;
  return row ? JSON.parse(row.document) : initialProject();
}
export async function getProject(): Promise<Project> {
  if (!usePostgres()) return localRead(db());
  const pool = postgresPool();
  await pool.query(
    "INSERT INTO studio_projects (id, document) VALUES ($1,$2::jsonb) ON CONFLICT (id) DO NOTHING",
    [projectId(), JSON.stringify(initialProject())],
  );
  const result = await pool.query(
    "SELECT document FROM studio_projects WHERE id=$1",
    [projectId()],
  );
  return result.rows[0].document as Project;
}
function applyChange<T>(change: (project: Project) => T, project: Project) {
  const previousUpdatedAt = Date.parse(project.updatedAt);
  const result = change(project);
  if (result && typeof (result as { then?: unknown }).then === "function")
    throw new Error("Project mutation callbacks must be synchronous.");
  project.updatedAt = new Date(
    Math.max(
      Date.now(),
      Number.isFinite(previousUpdatedAt) ? previousUpdatedAt + 1 : 0,
    ),
  ).toISOString();
  return result;
}
async function transaction<T>(
  change: (project: Project) => T,
  archive = false,
): Promise<T> {
  if (usePostgres()) {
    const client = await postgresPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO studio_projects (id,document) VALUES ($1,$2::jsonb) ON CONFLICT (id) DO NOTHING",
        [projectId(), JSON.stringify(initialProject())],
      );
      const selected = await client.query(
        "SELECT document FROM studio_projects WHERE id=$1 FOR UPDATE",
        [projectId()],
      );
      const project = selected.rows[0].document as Project;
      const previous = archive ? JSON.stringify(project) : undefined;
      const result = applyChange(change, project);
      if (previous)
        await client.query(
          "INSERT INTO studio_campaign_archives (id,project_id,document) VALUES ($1,$2,$3::jsonb)",
          [randomUUID(), projectId(), previous],
        );
      await client.query(
        "UPDATE studio_projects SET document=$2::jsonb, updated_at=now() WHERE id=$1",
        [projectId(), JSON.stringify(project)],
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const project = localRead(database);
    const previous = archive ? JSON.stringify(project) : undefined;
    const result = applyChange(change, project);
    if (previous) {
      database.exec(
        "CREATE TABLE IF NOT EXISTS campaign_archives (id TEXT PRIMARY KEY, document TEXT NOT NULL, created_at TEXT NOT NULL)",
      );
      database
        .prepare(
          "INSERT INTO campaign_archives (id,document,created_at) VALUES (?,?,?)",
        )
        .run(randomUUID(), previous, new Date().toISOString());
    }
    database
      .prepare(
        "INSERT INTO projects (id,document) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
      )
      .run(projectId(), JSON.stringify(project));
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
export async function mutateProject<T>(
  change: (project: Project) => T,
): Promise<T> {
  return transaction(change);
}
export async function startNewCampaign(expectedUpdatedAt: string) {
  return transaction((previous) => {
    if (previous.updatedAt !== expectedUpdatedAt)
      throw new Error(
        "The campaign just changed. Refresh before starting a new one.",
      );
    if (previous.jobs.some(isActiveJob))
      throw new Error(
        "Finish or resolve the current render before starting a new campaign.",
      );
    const fresh = initialProject();
    fresh.name = "New campaign";
    fresh.brief = "";
    for (const [index, shot] of fresh.shots.entries()) {
      if (shot.kind === "title") continue;
      shot.kind = "generated";
      shot.title = ["Opening", "Build", "Payoff", "Closing"][index];
      shot.description = "To be planned from your brief.";
      shot.prompt = "";
    }
    for (const key of Object.keys(previous))
      delete (previous as unknown as Record<string, unknown>)[key];
    Object.assign(previous, fresh);
    return previous;
  }, true);
}
export function event(project: Project, type: string, message: string) {
  project.events.push({
    id: randomUUID(),
    type,
    message,
    at: new Date().toISOString(),
  });
}
