import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { initialProject, isActiveJob, type Project } from "./domain";

export function dataDir() {
  if (process.env.VERCEL)
    throw new Error(
      "This private studio uses local storage. Configure shared persistent storage before deploying.",
    );
  const directory =
    process.env.STUDIO_DATA_DIR || path.join(process.cwd(), ".studio");
  if (!path.isAbsolute(directory))
    throw new Error(
      "STUDIO_DATA_DIR must be an absolute path shared by Next.js and eve.",
    );
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
function read(database: DatabaseSync): Project {
  const row = database
    .prepare("SELECT document FROM projects WHERE id = ?")
    .get("m31-launch") as { document: string } | undefined;
  return row ? (JSON.parse(row.document) as Project) : initialProject();
}
export function getProject() {
  return read(db());
}
export function startNewCampaign(expectedUpdatedAt: string) {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const previous = read(database);
    if (previous.updatedAt !== expectedUpdatedAt)
      throw new Error(
        "The campaign just changed. Refresh before starting a new one.",
      );
    if (previous.jobs.some(isActiveJob))
      throw new Error(
        "Finish or resolve the current render before starting a new campaign.",
      );
    database.exec(
      "CREATE TABLE IF NOT EXISTS campaign_archives (id TEXT PRIMARY KEY, document TEXT NOT NULL, created_at TEXT NOT NULL)",
    );
    database
      .prepare(
        "INSERT INTO campaign_archives (id, document, created_at) VALUES (?, ?, ?)",
      )
      .run(randomUUID(), JSON.stringify(previous), new Date().toISOString());
    const fresh = initialProject();
    fresh.name = "New campaign";
    fresh.brief = "";
    for (const [index, shot] of fresh.shots.entries()) {
      if (shot.kind === "title") continue;
      shot.kind = "generated";
      shot.title = ["Opening", "Build", "Payoff"][index];
      shot.description = "To be planned from your brief.";
      shot.prompt = "";
    }
    database
      .prepare(
        "INSERT INTO projects (id, document) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document = excluded.document",
      )
      .run(fresh.id, JSON.stringify(fresh));
    database.exec("COMMIT");
    return fresh;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
export function mutateProject<T>(change: (project: Project) => T): T {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const project = read(database);
    const result = change(project);
    project.updatedAt = new Date().toISOString();
    database
      .prepare(
        "INSERT INTO projects (id, document) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document = excluded.document",
      )
      .run(project.id, JSON.stringify(project));
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
export function event(project: Project, type: string, message: string) {
  project.events.push({
    id: randomUUID(),
    type,
    message,
    at: new Date().toISOString(),
  });
}
