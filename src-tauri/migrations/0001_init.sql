-- semesters
CREATE TABLE IF NOT EXISTS semesters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,          -- e.g., "Spring 2026"
  start_date TEXT,
  end_date TEXT
);

-- courses
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,          -- e.g., "CSIT127"
  title TEXT NOT NULL,
  credits INTEGER DEFAULT 0,
  semester_id INTEGER,
  status TEXT NOT NULL DEFAULT 'current', -- pending | current | completed
  instructor TEXT,
  color TEXT,                  -- optional UI color tag
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (semester_id) REFERENCES semesters(id)
);

-- class sessions (for "pending classes", attendance, timetable)
CREATE TABLE IF NOT EXISTS class_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  start_time TEXT NOT NULL,    -- ISO string
  end_time TEXT,
  location TEXT,
  type TEXT,                   -- lecture | lab | tutorial
  attended INTEGER DEFAULT 0,  -- 0/1
  notes TEXT,
  FOREIGN KEY (course_id) REFERENCES courses(id)
);

-- assessments (assignments/quizzes/exams)
CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  due_time TEXT,               -- ISO string
  weight REAL DEFAULT 0,       -- %
  status TEXT NOT NULL DEFAULT 'not_started', -- not_started | in_progress | submitted | graded
  score REAL,                  -- points you got
  out_of REAL,                 -- total points
  feedback TEXT,
  FOREIGN KEY (course_id) REFERENCES courses(id)
);

-- tasks (smaller todo items per course)
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER,
  title TEXT NOT NULL,
  due_time TEXT,
  priority INTEGER DEFAULT 2,  -- 1 high, 2 med, 3 low
  done INTEGER DEFAULT 0,
  FOREIGN KEY (course_id) REFERENCES courses(id)
);

CREATE INDEX IF NOT EXISTS idx_assessments_due ON assessments(due_time);
CREATE INDEX IF NOT EXISTS idx_sessions_start ON class_sessions(start_time);