import Database from "@tauri-apps/plugin-sql";

/* ---------------- Types ---------------- */
export type CourseStatus = "pending" | "current" | "completed";

export type Course = {
  id: number;
  code: string;
  title: string;
  status: CourseStatus;
  credits: number;
  instructor: string | null;
  created_at: string | null;
};

export type AssessmentStatus = "not_started" | "in_progress" | "submitted" | "graded";

export type Assessment = {
  id: number;
  course_id: number;
  title: string;
  due_time: string | null; // ISO
  weight: number; // %
  status: AssessmentStatus;
  score: number | null;
  out_of: number | null;
};

export type TaskPriority = 1 | 2 | 3;

export type Task = {
  id: number;
  course_id: number | null;
  title: string;
  due_time: string | null; // ISO
  priority: TaskPriority;
  done: number; // 0/1
};

export type ClassType = "lecture" | "lab" | "tutorial" | "other";

export type ClassSession = {
  id: number;
  course_id: number;
  start_time: string; // ISO
  end_time: string | null; // ISO
  location: string | null;
  type: ClassType;
  attended: number; // 0/1
  notes: string | null;
};

export type Settings = {
  id: number;
  notifications_on: number; // 0/1
  week_starts_monday: number; // 0/1
  accent: string; // hex
  updated_at: string | null;
};

export type AssessmentRow = Assessment & {
  course_code: string;
  course_title: string;
};

export type SessionRow = ClassSession & { course_code: string; course_title: string };

export type CourseGradeSummary = {
  course_id: number;
  code: string;
  title: string;
  credits: number;
  graded_weight: number;
  current_percent: number | null;
  projected_overall: number | null;
};

let db: Database | null = null;

/* ---------------- Helpers ---------------- */
function isoOrNullFromDatetimeLocal(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export const dt = {
  toIso: isoOrNullFromDatetimeLocal,
};

function ensureDB(): Database {
  if (!db) throw new Error("DB not initialized. Did initDB() run?");
  return db;
}

/* ---------------- Init ---------------- */
export async function initDB() {
  console.log("[DB] Loading sqlite:unios.db ...");
  db = await Database.load("sqlite:unios.db");
  console.log("[DB] Loaded ✅");

  const d = ensureDB();

  // Ensure FK constraints are respected
  await d.execute("PRAGMA foreign_keys = ON;");

  await d.execute(`
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'current',
      credits INTEGER NOT NULL DEFAULT 0,
      instructor TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await d.execute(`
    CREATE TABLE IF NOT EXISTS assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      due_time TEXT,
      weight REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'not_started',
      score REAL,
      out_of REAL,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);

  await d.execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER,
      title TEXT NOT NULL,
      due_time TEXT,
      priority INTEGER NOT NULL DEFAULT 2,
      done INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL
    );
  `);

  await d.execute(`
    CREATE TABLE IF NOT EXISTS class_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      location TEXT,
      type TEXT NOT NULL DEFAULT 'lecture',
      attended INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);

  await d.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      notifications_on INTEGER NOT NULL DEFAULT 1,
      week_starts_monday INTEGER NOT NULL DEFAULT 1,
      accent TEXT NOT NULL DEFAULT '#7c5cff',
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await d.execute(`INSERT OR IGNORE INTO settings (id) VALUES (1);`);

  await d.execute(`CREATE INDEX IF NOT EXISTS idx_assess_due ON assessments(due_time);`);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_time);`);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_sessions_start ON class_sessions(start_time);`);

  console.log("[DB] Tables ensured ✅");
}

/* ---------------- Health Check ---------------- */
export async function dbHealthCheck(): Promise<string> {
  const d = ensureDB();
  const rows = (await d.select("SELECT 1 AS ok")) as any[];
  return rows?.[0]?.ok === 1 ? "OK" : "FAILED";
}

/* ---------------- Courses ---------------- */
export async function listCourses(): Promise<Course[]> {
  const d = ensureDB();
  const rows = await d.select(
    "SELECT * FROM courses ORDER BY CASE status WHEN 'current' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, code"
  );
  return rows as Course[];
}

export async function createCourse(input: Omit<Course, "id" | "created_at">): Promise<void> {
  const d = ensureDB();
  console.log("[DB] createCourse", input);
  await d.execute(
    "INSERT INTO courses (code, title, status, credits, instructor) VALUES (?, ?, ?, ?, ?)",
    [input.code, input.title, input.status, input.credits, input.instructor ?? null]
  );
}

export async function updateCourse(id: number, patch: Partial<Omit<Course, "id">>): Promise<void> {
  const d = ensureDB();
  const current = (await d.select("SELECT * FROM courses WHERE id = ?", [id])) as Course[];
  if (!current.length) return;

  const next = { ...current[0], ...patch };
  await d.execute("UPDATE courses SET code=?, title=?, status=?, credits=?, instructor=? WHERE id=?", [
    next.code,
    next.title,
    next.status,
    next.credits,
    next.instructor ?? null,
    id,
  ]);
}

export async function deleteCourse(id: number): Promise<void> {
  const d = ensureDB();
  await d.execute("DELETE FROM courses WHERE id = ?", [id]);
}

/* ---------------- Assessments ---------------- */
export async function listAssessments(): Promise<AssessmentRow[]> {
  const d = ensureDB();
  const rows = await d.select(`
    SELECT a.*, c.code AS course_code, c.title AS course_title
    FROM assessments a
    JOIN courses c ON c.id = a.course_id
    ORDER BY (a.due_time IS NULL), a.due_time ASC
  `);
  return rows as AssessmentRow[];
}

export async function createAssessment(a: Omit<Assessment, "id">): Promise<void> {
  const d = ensureDB();
  await d.execute(
    "INSERT INTO assessments (course_id, title, due_time, weight, status, score, out_of) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [a.course_id, a.title, a.due_time, a.weight, a.status, a.score, a.out_of]
  );
}

export async function updateAssessment(id: number, patch: Partial<Omit<Assessment, "id">>): Promise<void> {
  const d = ensureDB();
  const current = (await d.select("SELECT * FROM assessments WHERE id = ?", [id])) as Assessment[];
  if (!current.length) return;

  const next = { ...current[0], ...patch };
  await d.execute(
    "UPDATE assessments SET course_id=?, title=?, due_time=?, weight=?, status=?, score=?, out_of=? WHERE id=?",
    [next.course_id, next.title, next.due_time, next.weight, next.status, next.score, next.out_of, id]
  );
}

export async function deleteAssessment(id: number): Promise<void> {
  const d = ensureDB();
  await d.execute("DELETE FROM assessments WHERE id = ?", [id]);
}

/* ---------------- Tasks ---------------- */
export async function listTasks(): Promise<(Task & { course_code: string | null })[]> {
  const d = ensureDB();
  const rows = await d.select(`
    SELECT t.*, c.code AS course_code
    FROM tasks t
    LEFT JOIN courses c ON c.id = t.course_id
    ORDER BY t.done ASC, (t.due_time IS NULL), t.due_time ASC, t.priority ASC
  `);
  return rows as any;
}

export async function createTask(t: Omit<Task, "id">): Promise<void> {
  const d = ensureDB();
  console.log("[DB] createTask", t);
  await d.execute("INSERT INTO tasks (course_id, title, due_time, priority, done) VALUES (?, ?, ?, ?, ?)", [
    t.course_id,
    t.title,
    t.due_time,
    t.priority,
    t.done,
  ]);
}

export async function updateTask(id: number, patch: Partial<Omit<Task, "id">>): Promise<void> {
  const d = ensureDB();
  const current = (await d.select("SELECT * FROM tasks WHERE id = ?", [id])) as Task[];
  if (!current.length) return;

  const next = { ...current[0], ...patch };
  await d.execute("UPDATE tasks SET course_id=?, title=?, due_time=?, priority=?, done=? WHERE id=?", [
    next.course_id,
    next.title,
    next.due_time,
    next.priority,
    next.done,
    id,
  ]);
}

export async function toggleTask(id: number, done: number): Promise<void> {
  const d = ensureDB();
  await d.execute("UPDATE tasks SET done=? WHERE id=?", [done, id]);
}

export async function deleteTask(id: number): Promise<void> {
  const d = ensureDB();
  await d.execute("DELETE FROM tasks WHERE id=?", [id]);
}

/* ---------------- Sessions ---------------- */
export async function listSessions(): Promise<SessionRow[]> {
  const d = ensureDB();
  const rows = await d.select(`
    SELECT s.*, c.code AS course_code, c.title AS course_title
    FROM class_sessions s
    JOIN courses c ON c.id = s.course_id
    ORDER BY s.start_time ASC
  `);
  return rows as SessionRow[];
}

export async function listUpcomingSessions(limit = 6): Promise<SessionRow[]> {
  const d = ensureDB();
  const now = new Date().toISOString();
  const rows = await d.select(
    `
    SELECT s.*, c.code AS course_code, c.title AS course_title
    FROM class_sessions s
    JOIN courses c ON c.id = s.course_id
    WHERE s.start_time >= ?
    ORDER BY s.start_time ASC
    LIMIT ?
  `,
    [now, limit]
  );
  return rows as SessionRow[];
}

export async function createSession(s: Omit<ClassSession, "id">): Promise<void> {
  const d = ensureDB();
  await d.execute(
    "INSERT INTO class_sessions (course_id, start_time, end_time, location, type, attended, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [s.course_id, s.start_time, s.end_time, s.location, s.type, s.attended, s.notes]
  );
}

export async function updateSession(id: number, patch: Partial<Omit<ClassSession, "id">>): Promise<void> {
  const d = ensureDB();
  const current = (await d.select("SELECT * FROM class_sessions WHERE id = ?", [id])) as ClassSession[];
  if (!current.length) return;

  const next = { ...current[0], ...patch };
  await d.execute(
    "UPDATE class_sessions SET course_id=?, start_time=?, end_time=?, location=?, type=?, attended=?, notes=? WHERE id=?",
    [next.course_id, next.start_time, next.end_time, next.location, next.type, next.attended, next.notes, id]
  );
}

export async function toggleAttended(id: number, attended: number): Promise<void> {
  const d = ensureDB();
  await d.execute("UPDATE class_sessions SET attended=? WHERE id=?", [attended, id]);
}

export async function deleteSession(id: number): Promise<void> {
  const d = ensureDB();
  await d.execute("DELETE FROM class_sessions WHERE id=?", [id]);
}

/* ---------------- Grades ---------------- */
export async function getCourseGradeSummaries(): Promise<CourseGradeSummary[]> {
  const d = ensureDB();
  const rows = await d.select(`
    SELECT
      c.id AS course_id,
      c.code,
      c.title,
      c.credits,
      COALESCE(SUM(
        CASE
          WHEN a.status='graded' AND a.score IS NOT NULL AND a.out_of IS NOT NULL AND a.out_of > 0
          THEN a.weight
          ELSE 0
        END
      ), 0) AS graded_weight,
      COALESCE(SUM(
        CASE
          WHEN a.status='graded' AND a.score IS NOT NULL AND a.out_of IS NOT NULL AND a.out_of > 0
          THEN a.weight * (a.score / a.out_of)
          ELSE 0
        END
      ), 0) AS weighted_fraction
    FROM courses c
    LEFT JOIN assessments a ON a.course_id = c.id
    GROUP BY c.id
    ORDER BY CASE c.status WHEN 'current' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, c.code
  `);

  return (rows as any[]).map((r) => {
    const graded_weight = Number(r.graded_weight ?? 0);
    const weighted_fraction = Number(r.weighted_fraction ?? 0);
    const projected_overall = graded_weight > 0 ? Number((weighted_fraction * 100).toFixed(2)) : null;
    const current_percent = graded_weight > 0 ? Number(((weighted_fraction / (graded_weight / 100)) * 100).toFixed(2)) : null;

    return {
      course_id: r.course_id,
      code: r.code,
      title: r.title,
      credits: Number(r.credits ?? 0),
      graded_weight,
      current_percent,
      projected_overall,
    };
  });
}

/* ---------------- Settings ---------------- */
export async function getSettings(): Promise<Settings> {
  const d = ensureDB();
  const rows = (await d.select("SELECT * FROM settings WHERE id=1")) as Settings[];
  return rows[0];
}

export async function updateSettings(patch: Partial<Omit<Settings, "id">>): Promise<void> {
  const d = ensureDB();
  const current = await getSettings();
  const next = { ...current, ...patch };
  await d.execute(
    "UPDATE settings SET notifications_on=?, week_starts_monday=?, accent=?, updated_at=datetime('now') WHERE id=1",
    [next.notifications_on, next.week_starts_monday, next.accent]
  );
}

/* ---------------- Backup / Restore ---------------- */
export type BackupPayload = {
  version: number;
  exported_at: string;
  data: {
    courses: Course[];
    assessments: Assessment[];
    tasks: Task[];
    class_sessions: ClassSession[];
    settings: Settings[];
  };
};

export async function exportBackup(): Promise<BackupPayload> {
  const d = ensureDB();
  const [courses, assessments, tasks, sessions, settings] = await Promise.all([
    d.select("SELECT * FROM courses"),
    d.select("SELECT * FROM assessments"),
    d.select("SELECT * FROM tasks"),
    d.select("SELECT * FROM class_sessions"),
    d.select("SELECT * FROM settings"),
  ]);

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    data: {
      courses: courses as Course[],
      assessments: assessments as Assessment[],
      tasks: tasks as Task[],
      class_sessions: sessions as ClassSession[],
      settings: settings as Settings[],
    },
  };
}

export async function wipeAllData(): Promise<void> {
  const d = ensureDB();
  await d.execute("DELETE FROM assessments");
  await d.execute("DELETE FROM tasks");
  await d.execute("DELETE FROM class_sessions");
  await d.execute("DELETE FROM courses");
  await d.execute(
    "UPDATE settings SET notifications_on=1, week_starts_monday=1, accent='#7c5cff', updated_at=datetime('now') WHERE id=1"
  );
}

export async function importBackup(payload: BackupPayload): Promise<void> {
  const d = ensureDB();
  if (!payload?.data) throw new Error("Invalid backup payload");

  await wipeAllData();

  for (const c of payload.data.courses ?? []) {
    await d.execute(
      "INSERT INTO courses (id, code, title, status, credits, instructor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [c.id, c.code, c.title, c.status, c.credits, c.instructor ?? null, c.created_at ?? null]
    );
  }

  for (const a of payload.data.assessments ?? []) {
    await d.execute(
      "INSERT INTO assessments (id, course_id, title, due_time, weight, status, score, out_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [a.id, a.course_id, a.title, a.due_time ?? null, a.weight, a.status, a.score ?? null, a.out_of ?? null]
    );
  }

  for (const t of payload.data.tasks ?? []) {
    await d.execute("INSERT INTO tasks (id, course_id, title, due_time, priority, done) VALUES (?, ?, ?, ?, ?, ?)", [
      t.id,
      t.course_id ?? null,
      t.title,
      t.due_time ?? null,
      t.priority,
      t.done,
    ]);
  }

  for (const s of payload.data.class_sessions ?? []) {
    await d.execute(
      "INSERT INTO class_sessions (id, course_id, start_time, end_time, location, type, attended, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [s.id, s.course_id, s.start_time, s.end_time ?? null, s.location ?? null, s.type, s.attended, s.notes ?? null]
    );
  }

  const set = (payload.data.settings?.[0] ?? null) as Settings | null;
  if (set) {
    await d.execute(
      "UPDATE settings SET notifications_on=?, week_starts_monday=?, accent=?, updated_at=datetime('now') WHERE id=1",
      [set.notifications_on, set.week_starts_monday, set.accent]
    );
  }
}