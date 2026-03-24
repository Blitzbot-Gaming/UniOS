import { useEffect, useMemo, useState } from "react";
import "./styles/unios.css";
import {
  initDB,
  listCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  type Course,
  type CourseStatus,
  listAssessments,
  createAssessment,
  updateAssessment,
  deleteAssessment,
  type AssessmentStatus,
  type AssessmentRow,
  listTasks,
  createTask,
  updateTask,
  toggleTask,
  deleteTask,
  type TaskPriority,
  listUpcomingSessions,
  listSessions,
  createSession,
  updateSession,
  deleteSession,
  toggleAttended,
  type SessionRow,
  type ClassType,
  getCourseGradeSummaries,
  type CourseGradeSummary,
  getSettings,
  updateSettings,
  exportBackup,
  importBackup,
  wipeAllData,
  dt,
} from "./db/db";

type Page = "dashboard" | "courses" | "assessments" | "schedule" | "grades" | "tasks" | "settings";

/* ---------------- Helpers ---------------- */
function prettyStatus(s: string) {
  return s.split("_").join(" ");
}

function toDatetimeLocal(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfWeek(d: Date, weekStartsMonday: boolean) {
  const x = startOfDay(d);
  const dow = x.getDay(); // 0 = Sun, 1 = Mon...
  const shift = weekStartsMonday ? (dow === 0 ? 6 : dow - 1) : dow;
  return addDays(x, -shift);
}

function startOfMonth(d: Date) {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

function endOfMonth(d: Date) {
  const x = startOfMonth(d);
  x.setMonth(x.getMonth() + 1);
  x.setDate(0);
  x.setHours(23, 59, 59, 999);
  return x;
}

function monthLabel(d: Date) {
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

/**
 * Status color coding (requested):
 * Completed = Green
 * Pending = Yellow
 * Current = Blue
 */
function statusDotStyle(s: CourseStatus) {
  if (s === "completed") return { background: "var(--good)" };
  if (s === "pending") return { background: "var(--warn)" };
  return { background: "var(--accent2)" }; // current
}

function pillStatusLabel(s: CourseStatus) {
  if (s === "completed") return "Completed";
  if (s === "pending") return "Pending";
  return "Current";
}

function assessmentDotStyle(s: AssessmentStatus) {
  if (s === "graded") return { background: "var(--good)" };
  if (s === "submitted") return { background: "var(--warn)" };
  return { background: "var(--accent2)" };
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/* ---------------- UI Components ---------------- */
function Modal(props: { open: boolean; title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  if (!props.open) return null;
  return (
    <div className="modalOverlay" onMouseDown={props.onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <h3>{props.title}</h3>
            {props.subtitle ? <p>{props.subtitle}</p> : null}
          </div>
          <button className="btn ghost" onClick={props.onClose}>
            Close
          </button>
        </div>
        <hr className="sep" />
        {props.children}
      </div>
    </div>
  );
}

function StatCard(props: { title: string; value: string; hint: string; dotStyle?: React.CSSProperties }) {
  return (
    <div className="card">
      <div className="row spread">
        <h3 style={{ margin: 0 }}>{props.title}</h3>
        <span className="pill">
          <span className="dot" style={props.dotStyle ?? { background: "var(--accent2)" }} /> Live
        </span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{props.value}</div>
      <div className="muted small" style={{ marginTop: 6 }}>
        {props.hint}
      </div>
    </div>
  );
}

/* ---------------- Calendar Event Types ---------------- */
type UniEvent =
  | { kind: "class"; id: number; title: string; when: string; meta: string; color: "blue" | "yellow" | "green" }
  | { kind: "deadline"; id: number; title: string; when: string; meta: string; color: "blue" | "yellow" | "green" };

function eventDotColor(c: UniEvent["color"]) {
  if (c === "green") return "var(--good)";
  if (c === "yellow") return "var(--warn)";
  return "var(--accent2)";
}

function weekdayHeaders(weekStartsMonday: boolean) {
  return weekStartsMonday ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
}

/* ---------------- App ---------------- */
export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [toast, setToast] = useState<string>("");

  const [courses, setCourses] = useState<Course[]>([]);
  const [assessments, setAssessments] = useState<AssessmentRow[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [upcoming, setUpcoming] = useState<SessionRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [gradeSummaries, setGradeSummaries] = useState<CourseGradeSummary[]>([]);
  const [settings, setSettings] = useState<any>(null);

  const weekStartsMonday = !!settings?.week_starts_monday;

  const [query, setQuery] = useState("");

  // Dashboard quick add
  const [qCode, setQCode] = useState("");
  const [qTitle, setQTitle] = useState("");
  const [qCredits, setQCredits] = useState(6);
  const [qStatus, setQStatus] = useState<CourseStatus>("current");

  const [qTaskTitle, setQTaskTitle] = useState("");
  const [qTaskDue, setQTaskDue] = useState("");

  // Courses form
  const [cCode, setCCode] = useState("");
  const [cTitle, setCTitle] = useState("");
  const [cCredits, setCCredits] = useState(6);
  const [cStatus, setCStatus] = useState<CourseStatus>("current");
  const [cInstructor, setCInstructor] = useState("");

  // Assessments form
  const [aCourseId, setACourseId] = useState<number | "">("");
  const [aTitle, setATitle] = useState("");
  const [aDue, setADue] = useState("");
  const [aWeight, setAWeight] = useState(10);
  const [aStatus, setAStatus] = useState<AssessmentStatus>("not_started");
  const [aScore, setAScore] = useState<number | "">("");
  const [aOutOf, setAOutOf] = useState<number | "">("");

  // Tasks form
  const [tCourseId, setTCourseId] = useState<number | "">("");
  const [tTitle, setTTitle] = useState("");
  const [tDue, setTDue] = useState("");
  const [tPriority, setTPriority] = useState<TaskPriority>(2);

  // Sessions form
  const [sCourseId, setSCourseId] = useState<number | "">("");
  const [sStart, setSStart] = useState("");
  const [sEnd, setSEnd] = useState("");
  const [sLoc, setSLoc] = useState("");
  const [sType, setSType] = useState<ClassType>("lecture");
  const [sNotes, setSNotes] = useState("");

  // Grades what-if
  const [targetOverall, setTargetOverall] = useState(85);

  // Edit modals
  const [editCourseOpen, setEditCourseOpen] = useState(false);
  const [editCourse, setEditCourse] = useState<Course | null>(null);

  const [editAssessmentOpen, setEditAssessmentOpen] = useState(false);
  const [editAssessment, setEditAssessment] = useState<AssessmentRow | null>(null);

  const [editTaskOpen, setEditTaskOpen] = useState(false);
  const [editTask, setEditTask] = useState<any>(null);

  const [editSessionOpen, setEditSessionOpen] = useState(false);
  const [editSession, setEditSession] = useState<SessionRow | null>(null);

  // Schedule calendar controls
  const [scheduleView, setScheduleView] = useState<"list" | "calendar">("calendar");
  const [calendarMode, setCalendarMode] = useState<"month" | "week">("month");
  const [calCursor, setCalCursor] = useState<Date>(() => startOfDay(new Date()));
  const [dayModalOpen, setDayModalOpen] = useState(false);
  const [dayModalDate, setDayModalDate] = useState<Date>(() => startOfDay(new Date()));

  function ping(msg: string) {
    setToast(msg);
    window.clearTimeout((ping as any)._t);
    (ping as any)._t = window.setTimeout(() => setToast(""), 2400);
  }

  async function refreshAll() {
    const [c, a, t, u, ss, gs, st] = await Promise.all([
      listCourses(),
      listAssessments(),
      listTasks(),
      listUpcomingSessions(6),
      listSessions(),
      getCourseGradeSummaries(),
      getSettings(),
    ]);

    setCourses(c);
    setAssessments(a);
    setTasks(t);
    setUpcoming(u);
    setSessions(ss);
    setGradeSummaries(gs);
    setSettings(st);

    if (st?.accent) document.documentElement.style.setProperty("--accent", st.accent);
  }

  useEffect(() => {
    (async () => {
      await initDB();
      await refreshAll();
      ping("UniOS loaded ✅");
    })();
  }, []);

  const filteredCourses = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((c) => `${c.code} ${c.title} ${c.instructor ?? ""} ${c.status}`.toLowerCase().includes(q));
  }, [courses, query]);

  const filteredAssessments = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assessments;
    return assessments.filter((a) => `${a.title} ${a.course_code} ${a.course_title} ${a.status}`.toLowerCase().includes(q));
  }, [assessments, query]);

  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t: any) => `${t.title} ${t.course_code ?? ""}`.toLowerCase().includes(q));
  }, [tasks, query]);

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => `${s.course_code} ${s.course_title} ${s.type} ${s.location ?? ""} ${s.notes ?? ""}`.toLowerCase().includes(q));
  }, [sessions, query]);

  const summary = useMemo(() => {
    const current = courses.filter((c) => c.status === "current").length;
    const pending = courses.filter((c) => c.status === "pending").length;
    const completed = courses.filter((c) => c.status === "completed").length;
    const openTasks = tasks.filter((t: any) => t.done === 0).length;

    const dueSoon = assessments
      .filter((a) => a.due_time)
      .slice()
      .sort((x, y) => (x.due_time ?? "").localeCompare(y.due_time ?? ""))
      .slice(0, 6);

    const upcomingClasses = upcoming.slice(0, 6);

    return { current, pending, completed, openTasks, dueSoon, upcomingClasses };
  }, [courses, tasks, assessments, upcoming]);

  const title = useMemo(() => {
    if (page === "dashboard") return ["Dashboard", "Your uni life — clean, fast, tracked."];
    if (page === "courses") return ["Courses", "Track pending → current → completed."];
    if (page === "assessments") return ["Assessments", "Deadlines, weight %, scores and status."];
    if (page === "schedule") return ["Schedule", "Sessions, attendance, and calendar view."];
    if (page === "grades") return ["Grades", "Weighted grade tracking + what-if calculator."];
    if (page === "tasks") return ["Tasks", "Keep momentum. Stack small wins."];
    return ["Settings", "Theme + backup/restore."];
  }, [page]);

  function openDayModal(d: Date) {
    setDayModalDate(startOfDay(d));
    setDayModalOpen(true);
  }

  function openEditCourse(c: Course) {
    setEditCourse(c);
    setEditCourseOpen(true);
  }

  function openEditAssessment(a: AssessmentRow) {
    setEditAssessment(a);
    setEditAssessmentOpen(true);
  }

  function openEditTask(t: any) {
    setEditTask(t);
    setEditTaskOpen(true);
  }

  function openEditSession(s: SessionRow) {
    setEditSession(s);
    setEditSessionOpen(true);
  }

  // What-if calculator: needed score on remaining
  function neededOnRemaining(g: CourseGradeSummary) {
    const gradedW = g.graded_weight;
    const remainingW = Math.max(0, 100 - gradedW);
    if (!g.projected_overall || gradedW === 0) return targetOverall;
    if (remainingW <= 0) return null;

    const contributionSoFar = g.projected_overall;
    const needed = ((targetOverall - contributionSoFar) / remainingW) * 100;
    return Number(needed.toFixed(2));
  }

  // Unified events for calendar
  const events: UniEvent[] = useMemo(() => {
    const e: UniEvent[] = [];

    for (const s of sessions) {
      e.push({
        kind: "class",
        id: s.id,
        title: `${s.course_code} • ${s.type}`,
        when: s.start_time,
        meta: `${s.course_title}${s.location ? ` • ${s.location}` : ""}`,
        color: "blue",
      });
    }

    for (const a of assessments) {
      if (!a.due_time) continue;
      const col: UniEvent["color"] = a.status === "graded" ? "green" : "yellow";
      e.push({
        kind: "deadline",
        id: a.id,
        title: `🧾 ${a.title}`,
        when: a.due_time,
        meta: `${a.course_code} • weight ${a.weight}% • ${prettyStatus(a.status)}`,
        color: col,
      });
    }

    return e.sort((x, y) => x.when.localeCompare(y.when));
  }, [sessions, assessments]);

  const eventsByDay = useMemo(() => {
    const map: Record<string, UniEvent[]> = {};
    for (const ev of events) {
      const k = dateKey(new Date(ev.when));
      (map[k] ??= []).push(ev);
    }
    return map;
  }, [events]);

  const dayModalEvents = useMemo(() => {
    const k = dateKey(dayModalDate);
    return eventsByDay[k] ?? [];
  }, [eventsByDay, dayModalDate]);

  /* ---------------- Calendar Renderers ---------------- */
  function renderMonthCalendar() {
    const monthStart = startOfMonth(calCursor);
    const monthEnd = endOfMonth(calCursor);
    const gridStart = startOfWeek(monthStart, weekStartsMonday);

    const days: Date[] = [];
    let d = gridStart;
    for (let i = 0; i < 42; i++) {
      days.push(d);
      d = addDays(d, 1);
    }

    const headers = weekdayHeaders(weekStartsMonday);

    return (
      <div className="card">
        <div className="row spread wrap">
          <div>
            <h3 style={{ margin: 0 }}>Calendar • Month</h3>
            <p className="muted small" style={{ marginTop: 6 }}>
              Click a day to view classes + deadlines.
            </p>
          </div>

          <div className="row wrap">
            <button className="btn ghost" onClick={() => setCalCursor(addDays(monthStart, -1))}>
              ◀ Prev
            </button>
            <span className="pill">
              <span className="dot" style={{ background: "var(--accent2)" }} /> {monthLabel(calCursor)}
            </span>
            <button className="btn ghost" onClick={() => setCalCursor(addDays(monthEnd, 1))}>
              Next ▶
            </button>
            <button className="btn" onClick={() => setCalCursor(startOfDay(new Date()))}>
              Today
            </button>
          </div>
        </div>

        <hr className="sep" />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10, marginBottom: 10 }}>
          {headers.map((h) => (
            <div key={h} className="muted small" style={{ fontWeight: 900, paddingLeft: 6 }}>
              {h}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10 }}>
          {days.map((day) => {
            const k = dateKey(day);
            const list = eventsByDay[k] ?? [];
            const isThisMonth = day.getMonth() === calCursor.getMonth();
            const isToday = isSameDay(day, new Date());

            return (
              <button
                key={k}
                className="card"
                style={{
                  textAlign: "left",
                  padding: 12,
                  border: "1px solid rgba(255,255,255,0.06)",
                  opacity: isThisMonth ? 1 : 0.35,
                  cursor: "pointer",
                  background: isToday ? "rgba(124, 92, 255, 0.12)" : undefined,
                }}
                onClick={() => openDayModal(day)}
              >
                <div className="row spread">
                  <div style={{ fontWeight: 950 }}>{day.getDate()}</div>
                  {list.length ? (
                    <span className="pill">
                      <span className="dot" style={{ background: "var(--warn)" }} /> {list.length}
                    </span>
                  ) : (
                    <span className="muted small">—</span>
                  )}
                </div>

                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {list.slice(0, 3).map((ev) => (
                    <div key={`${ev.kind}-${ev.id}`} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                      <span className="dot" style={{ background: eventDotColor(ev.color) }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.title}</span>
                    </div>
                  ))}
                  {list.length > 3 ? <div className="muted small">+{list.length - 3} more</div> : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderWeekCalendar() {
    const start = startOfWeek(calCursor, weekStartsMonday);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const label = `${days[0].toLocaleDateString()} → ${days[6].toLocaleDateString()}`;

    return (
      <div className="card">
        <div className="row spread wrap">
          <div>
            <h3 style={{ margin: 0 }}>Calendar • Week</h3>
            <p className="muted small" style={{ marginTop: 6 }}>
              Focus view: next 7 days of classes + deadlines.
            </p>
          </div>

          <div className="row wrap">
            <button className="btn ghost" onClick={() => setCalCursor(addDays(calCursor, -7))}>
              ◀ Prev
            </button>
            <span className="pill">
              <span className="dot" style={{ background: "var(--accent2)" }} /> {label}
            </span>
            <button className="btn ghost" onClick={() => setCalCursor(addDays(calCursor, 7))}>
              Next ▶
            </button>
            <button className="btn" onClick={() => setCalCursor(startOfDay(new Date()))}>
              Today
            </button>
          </div>
        </div>

        <hr className="sep" />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10 }}>
          {days.map((day) => {
            const k = dateKey(day);
            const list = eventsByDay[k] ?? [];
            const isToday = isSameDay(day, new Date());

            return (
              <div
                key={k}
                className="card"
                style={{
                  padding: 12,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: isToday ? "rgba(124, 92, 255, 0.12)" : undefined,
                }}
              >
                <div className="row spread">
                  <div>
                    <div style={{ fontWeight: 950 }}>{day.toLocaleString(undefined, { weekday: "short" })}</div>
                    <div className="muted small">{day.toLocaleDateString()}</div>
                  </div>
                  <button className="btn ghost" onClick={() => openDayModal(day)}>
                    View
                  </button>
                </div>

                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  {list.length === 0 ? (
                    <div className="muted small">No events</div>
                  ) : (
                    list.slice(0, 8).map((ev) => (
                      <div key={`${ev.kind}-${ev.id}`} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <span className="dot" style={{ background: eventDotColor(ev.color), marginTop: 4 }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 900, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {ev.title}
                          </div>
                          <div className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {new Date(ev.when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} • {ev.meta}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  {list.length > 8 ? <div className="muted small">+{list.length - 8} more</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ---------------- Render ---------------- */
  return (
    <div className="shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-badge">U</div>
          <div>
            <h1>UniOS</h1>
            <p>Offline • Fast • Yours</p>
          </div>
        </div>

        <div className="nav">
          <button className={page === "dashboard" ? "active" : ""} onClick={() => setPage("dashboard")}>
            🧭 Dashboard
          </button>
          <button className={page === "courses" ? "active" : ""} onClick={() => setPage("courses")}>
            📚 Courses
          </button>
          <button className={page === "assessments" ? "active" : ""} onClick={() => setPage("assessments")}>
            🧾 Assessments
          </button>
          <button className={page === "schedule" ? "active" : ""} onClick={() => setPage("schedule")}>
            📅 Schedule
          </button>
          <button className={page === "grades" ? "active" : ""} onClick={() => setPage("grades")}>
            📊 Grades
          </button>
          <button className={page === "tasks" ? "active" : ""} onClick={() => setPage("tasks")}>
            ✅ Tasks
          </button>
          <button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}>
            ⚙️ Settings
          </button>
        </div>

        <hr className="sep" />

        <div className="muted small">
          <div className="row spread">
            <span>Status Colors</span>
            <span className="pill">
              <span className="dot" style={{ background: "var(--good)" }} /> Completed
            </span>
          </div>
          <div className="row spread" style={{ marginTop: 8 }}>
            <span />
            <span className="pill">
              <span className="dot" style={{ background: "var(--warn)" }} /> Pending
            </span>
          </div>
          <div className="row spread" style={{ marginTop: 8 }}>
            <span />
            <span className="pill">
              <span className="dot" style={{ background: "var(--accent2)" }} /> Current
            </span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="main">
        <div className="topbar">
          <div className="title">
            <h2>{title[0]}</h2>
            <p>{title[1]}</p>
          </div>

          <div className="badges">
            <span className="pill">
              <span className="dot" style={{ background: "var(--accent2)" }} /> Current: {summary.current}
            </span>
            <span className="pill">
              <span className="dot" style={{ background: "var(--warn)" }} /> Pending: {summary.pending}
            </span>
            <span className="pill">
              <span className="dot" style={{ background: "var(--good)" }} /> Completed: {summary.completed}
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row spread wrap">
            <div>
              <div style={{ fontWeight: 900 }}>Search</div>
              <div className="muted small">Search across the current page.</div>
            </div>
            <div className="row" style={{ minWidth: 360, width: "min(520px, 100%)" }}>
              <input
                className="input"
                placeholder="Try: CSIT127, quiz, lab, pending, graded…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="btn ghost" onClick={() => setQuery("")}>
                Clear
              </button>
            </div>
          </div>
        </div>

        {/* Toast */}
        {toast ? (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="row spread">
              <div style={{ fontWeight: 900 }}>Status</div>
              <span className="pill">
                <span className="dot" style={{ background: "var(--good)" }} /> OK
              </span>
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              {toast}
            </div>
          </div>
        ) : null}

        {/* ---------------- Dashboard ---------------- */}
        {page === "dashboard" && (
          <>
            <div className="grid" style={{ marginBottom: 16 }}>
              <StatCard
                title="Courses"
                value={`${courses.length}`}
                hint={`${summary.current} current • ${summary.pending} pending • ${summary.completed} completed`}
                dotStyle={{ background: "var(--accent2)" }}
              />
              <StatCard title="Open Tasks" value={`${summary.openTasks}`} hint="Tasks not marked done yet." dotStyle={{ background: "var(--warn)" }} />
            </div>

            <div className="grid">
              <section className="card">
                <div className="row spread wrap">
                  <h3 style={{ margin: 0 }}>Deadlines Soon</h3>
                  <span className="muted small">Top 6 by due date</span>
                </div>

                {summary.dueSoon.length === 0 ? (
                  <p className="muted" style={{ marginTop: 12 }}>
                    No deadlines yet. Add assessments.
                  </p>
                ) : (
                  <table className="table">
                    <tbody>
                      {summary.dueSoon.map((a) => (
                        <tr className="tr" key={a.id}>
                          <td>
                            <div className="row spread wrap">
                              <div>
                                <div style={{ fontWeight: 950 }}>{a.title}</div>
                                <div className="muted small">
                                  {a.course_code} • weight {a.weight}%
                                </div>
                              </div>
                              <span className="pill">
                                <span className="dot" style={assessmentDotStyle(a.status)} />
                                {prettyStatus(a.status)}
                              </span>
                            </div>
                          </td>
                          <td className="muted" style={{ width: 240 }}>
                            {a.due_time ? new Date(a.due_time).toLocaleString() : "No due date"}
                          </td>
                          <td style={{ width: 140, textAlign: "right" }}>
                            <button className="btn ghost" onClick={() => openEditAssessment(a)}>
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <hr className="sep" />

                <div className="row spread wrap">
                  <h3 style={{ margin: 0 }}>Upcoming Classes</h3>
                  <span className="muted small">Next 6 sessions</span>
                </div>

                {summary.upcomingClasses.length === 0 ? (
                  <p className="muted" style={{ marginTop: 12 }}>
                    No sessions yet. Add them in Schedule.
                  </p>
                ) : (
                  <table className="table">
                    <tbody>
                      {summary.upcomingClasses.map((s) => (
                        <tr className="tr" key={s.id}>
                          <td>
                            <div style={{ fontWeight: 950 }}>
                              {s.course_code} • {s.type}
                            </div>
                            <div className="muted small">{s.location ?? "—"}</div>
                          </td>
                          <td className="muted" style={{ width: 240 }}>
                            {new Date(s.start_time).toLocaleString()}
                          </td>
                          <td style={{ width: 140, textAlign: "right" }}>
                            <button className="btn ghost" onClick={() => openEditSession(s)}>
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="card">
                <h3>Quick Add</h3>
                <p className="muted small">Fast entry so you actually use it daily.</p>

                <hr className="sep" />
                <h3 style={{ marginTop: 0 }}>Add Course</h3>

                <div className="row" style={{ marginTop: 10 }}>
                  <input className="input" placeholder="Code (CSIT127)" value={qCode} onChange={(e) => setQCode(e.target.value)} />
                  <input className="input" placeholder="Title" value={qTitle} onChange={(e) => setQTitle(e.target.value)} />
                </div>

                <div className="row" style={{ marginTop: 10 }}>
                  <select className="select" value={qStatus} onChange={(e) => setQStatus(e.target.value as CourseStatus)}>
                    <option value="pending">pending</option>
                    <option value="current">current</option>
                    <option value="completed">completed</option>
                  </select>
                  <input className="input" type="number" value={qCredits} onChange={(e) => setQCredits(Number(e.target.value))} />
                </div>

                <div className="row right" style={{ marginTop: 12 }}>
                  <button
                    className="btn"
                    onClick={async () => {
                      if (!qCode.trim() || !qTitle.trim()) return;
                      await createCourse({
                        code: qCode.trim().toUpperCase(),
                        title: qTitle.trim(),
                        status: qStatus,
                        credits: qCredits,
                        instructor: null,
                      });
                      setQCode("");
                      setQTitle("");
                      await refreshAll();
                      ping("Course added ✅");
                    }}
                  >
                    Add Course
                  </button>
                </div>

                <hr className="sep" />
                <h3 style={{ marginTop: 0 }}>Add Task</h3>

                <div className="row" style={{ marginTop: 10 }}>
                  <input className="input" placeholder="Task title" value={qTaskTitle} onChange={(e) => setQTaskTitle(e.target.value)} />
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <input className="input" type="datetime-local" value={qTaskDue} onChange={(e) => setQTaskDue(e.target.value)} />
                </div>
                <div className="row right" style={{ marginTop: 12 }}>
                  <button
                    className="btn"
                    onClick={async () => {
                      if (!qTaskTitle.trim()) return;
                      await createTask({
                        course_id: null,
                        title: qTaskTitle.trim(),
                        due_time: dt.toIso(qTaskDue),
                        priority: 2,
                        done: 0,
                      });
                      setQTaskTitle("");
                      setQTaskDue("");
                      await refreshAll();
                      ping("Task added ✅");
                    }}
                  >
                    Add Task
                  </button>
                </div>
              </section>
            </div>
          </>
        )}

        {/* ---------------- Courses ---------------- */}
        {page === "courses" && (
          <div className="grid">
            <section className="card">
              <h3>Add Course</h3>

              <div className="row" style={{ marginTop: 10 }}>
                <input className="input" placeholder="Code (CSIT127)" value={cCode} onChange={(e) => setCCode(e.target.value)} />
                <input className="input" placeholder="Title" value={cTitle} onChange={(e) => setCTitle(e.target.value)} />
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <select className="select" value={cStatus} onChange={(e) => setCStatus(e.target.value as CourseStatus)}>
                  <option value="pending">pending</option>
                  <option value="current">current</option>
                  <option value="completed">completed</option>
                </select>
                <input className="input" type="number" value={cCredits} onChange={(e) => setCCredits(Number(e.target.value))} />
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <input className="input" placeholder="Instructor (optional)" value={cInstructor} onChange={(e) => setCInstructor(e.target.value)} />
              </div>

              <div className="row right" style={{ marginTop: 12 }}>
                <button
                  className="btn"
                  onClick={async () => {
                    if (!cCode.trim() || !cTitle.trim()) return;
                    await createCourse({
                      code: cCode.trim().toUpperCase(),
                      title: cTitle.trim(),
                      status: cStatus,
                      credits: cCredits,
                      instructor: cInstructor.trim() || null,
                    });
                    setCCode("");
                    setCTitle("");
                    setCInstructor("");
                    await refreshAll();
                    ping("Course added ✅");
                  }}
                >
                  Add
                </button>
              </div>
            </section>

            <section className="card">
              <h3>All Courses</h3>

              {filteredCourses.length === 0 ? (
                <p className="muted">No courses match your search.</p>
              ) : (
                <table className="table">
                  <tbody>
                    {filteredCourses.map((c) => (
                      <tr className="tr" key={c.id}>
                        <td style={{ width: 180 }}>
                          <span className="pill">
                            <span className="dot" style={statusDotStyle(c.status)} />
                            {pillStatusLabel(c.status)}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 950 }}>{c.code}</div>
                          <div className="muted small">{c.title}</div>
                        </td>
                        <td className="muted" style={{ width: 100 }}>
                          {c.credits} cr
                        </td>
                        <td className="muted" style={{ width: 220 }}>
                          {c.instructor ?? "—"}
                        </td>
                        <td style={{ width: 260, textAlign: "right" }}>
                          <button className="btn ghost" onClick={() => openEditCourse(c)}>
                            Edit
                          </button>{" "}
                          <button
                            className="btn danger"
                            onClick={async () => {
                              await deleteCourse(c.id);
                              await refreshAll();
                              ping("Course deleted");
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}

        {/* ---------------- Assessments ---------------- */}
        {page === "assessments" && (
          <div className="grid">
            <section className="card">
              <h3>Add Assessment</h3>

              <div className="row" style={{ marginTop: 10 }}>
                <select className="select" value={aCourseId} onChange={(e) => setACourseId(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">Select course…</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <input className="input" placeholder="Assessment title" value={aTitle} onChange={(e) => setATitle(e.target.value)} />
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <input className="input" type="datetime-local" value={aDue} onChange={(e) => setADue(e.target.value)} />
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <input className="input" type="number" value={aWeight} onChange={(e) => setAWeight(Number(e.target.value))} />
                <select className="select" value={aStatus} onChange={(e) => setAStatus(e.target.value as AssessmentStatus)}>
                  <option value="not_started">not started</option>
                  <option value="in_progress">in progress</option>
                  <option value="submitted">submitted</option>
                  <option value="graded">graded</option>
                </select>
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <input className="input" type="number" placeholder="Score (optional)" value={aScore} onChange={(e) => setAScore(e.target.value ? Number(e.target.value) : "")} />
                <input className="input" type="number" placeholder="Out of (optional)" value={aOutOf} onChange={(e) => setAOutOf(e.target.value ? Number(e.target.value) : "")} />
              </div>

              <div className="row right" style={{ marginTop: 12 }}>
                <button
                  className="btn"
                  onClick={async () => {
                    if (aCourseId === "" || !aTitle.trim()) return;
                    await createAssessment({
                      course_id: aCourseId,
                      title: aTitle.trim(),
                      due_time: dt.toIso(aDue),
                      weight: aWeight,
                      status: aStatus,
                      score: aScore === "" ? null : aScore,
                      out_of: aOutOf === "" ? null : aOutOf,
                    });
                    setATitle("");
                    setADue("");
                    setAWeight(10);
                    setAStatus("not_started");
                    setAScore("");
                    setAOutOf("");
                    await refreshAll();
                    ping("Assessment added ✅");
                  }}
                >
                  Add
                </button>
              </div>
            </section>

            <section className="card">
              <h3>All Assessments</h3>

              {filteredAssessments.length === 0 ? (
                <p className="muted">No assessments match your search.</p>
              ) : (
                <table className="table">
                  <tbody>
                    {filteredAssessments.map((a) => (
                      <tr className="tr" key={a.id}>
                        <td>
                          <div style={{ fontWeight: 950 }}>{a.title}</div>
                          <div className="muted small">
                            {a.course_code} • weight {a.weight}%
                          </div>
                          <div className="muted small">{a.score != null && a.out_of != null ? `Score: ${a.score}/${a.out_of}` : "No score yet"}</div>
                        </td>
                        <td className="muted" style={{ width: 240 }}>
                          {a.due_time ? new Date(a.due_time).toLocaleString() : "No due date"}
                        </td>
                        <td style={{ width: 180 }}>
                          <span className="pill">
                            <span className="dot" style={assessmentDotStyle(a.status)} />
                            {prettyStatus(a.status)}
                          </span>
                        </td>
                        <td style={{ width: 260, textAlign: "right" }}>
                          <button className="btn ghost" onClick={() => openEditAssessment(a)}>
                            Edit
                          </button>{" "}
                          <button
                            className="btn danger"
                            onClick={async () => {
                              await deleteAssessment(a.id);
                              await refreshAll();
                              ping("Assessment deleted");
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}

        {/* ---------------- Schedule ---------------- */}
        {page === "schedule" && (
          <div className="grid">
            <section className="card">
              <div className="row spread wrap">
                <div>
                  <h3 style={{ margin: 0 }}>Schedule</h3>
                  <p className="muted small" style={{ marginTop: 6 }}>
                    Switch between List and Calendar. Calendar includes deadlines + classes.
                  </p>
                </div>

                <div className="row wrap">
                  <button className={scheduleView === "list" ? "btn" : "btn ghost"} onClick={() => setScheduleView("list")}>
                    List
                  </button>
                  <button className={scheduleView === "calendar" ? "btn" : "btn ghost"} onClick={() => setScheduleView("calendar")}>
                    Calendar
                  </button>

                  {scheduleView === "calendar" ? (
                    <>
                      <button className={calendarMode === "month" ? "btn" : "btn ghost"} onClick={() => setCalendarMode("month")}>
                        Month
                      </button>
                      <button className={calendarMode === "week" ? "btn" : "btn ghost"} onClick={() => setCalendarMode("week")}>
                        Week
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <hr className="sep" />

              {scheduleView === "calendar" ? (calendarMode === "month" ? renderMonthCalendar() : renderWeekCalendar()) : (
                <div className="card" style={{ marginTop: 12 }}>
                  <h3 style={{ marginTop: 0 }}>All Sessions (List View)</h3>
                  {filteredSessions.length === 0 ? (
                    <p className="muted">No sessions match your search.</p>
                  ) : (
                    <table className="table">
                      <tbody>
                        {filteredSessions.map((s) => (
                          <tr className="tr" key={s.id}>
                            <td>
                              <div className="row spread wrap">
                                <div>
                                  <div style={{ fontWeight: 950 }}>
                                    {s.course_code} • {s.type}
                                  </div>
                                  <div className="muted small">
                                    {new Date(s.start_time).toLocaleString()}
                                    {s.end_time ? ` → ${new Date(s.end_time).toLocaleString()}` : ""}
                                  </div>
                                  <div className="muted small">
                                    {s.location ?? "—"} {s.notes ? `• ${s.notes}` : ""}
                                  </div>
                                </div>
                                <span className="pill">
                                  <span className="dot" style={{ background: s.attended ? "var(--good)" : "var(--warn)" }} />
                                  {s.attended ? "Attended" : "Pending"}
                                </span>
                              </div>
                            </td>

                            <td style={{ width: 420, textAlign: "right" }}>
                              <button
                                className="btn ghost"
                                onClick={async () => {
                                  await toggleAttended(s.id, s.attended ? 0 : 1);
                                  await refreshAll();
                                  ping("Attendance updated");
                                }}
                              >
                                {s.attended ? "Mark pending" : "Mark attended"}
                              </button>{" "}
                              <button className="btn ghost" onClick={() => openEditSession(s)}>
                                Edit
                              </button>{" "}
                              <button
                                className="btn danger"
                                onClick={async () => {
                                  await deleteSession(s.id);
                                  await refreshAll();
                                  ping("Session deleted");
                                }}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </section>

            <section className="card">
              <h3>Add Class Session</h3>

              <div className="row" style={{ marginTop: 10 }}>
                <select className="select" value={sCourseId} onChange={(e) => setSCourseId(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">Select course…</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <input className="input" type="datetime-local" value={sStart} onChange={(e) => setSStart(e.target.value)} />
                <input className="input" type="datetime-local" value={sEnd} onChange={(e) => setSEnd(e.target.value)} />
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <select className="select" value={sType} onChange={(e) => setSType(e.target.value as ClassType)}>
                  <option value="lecture">lecture</option>
                  <option value="lab">lab</option>
                  <option value="tutorial">tutorial</option>
                  <option value="other">other</option>
                </select>
                <input className="input" placeholder="Location (optional)" value={sLoc} onChange={(e) => setSLoc(e.target.value)} />
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <input className="input" placeholder="Notes (optional)" value={sNotes} onChange={(e) => setSNotes(e.target.value)} />
              </div>

              <div className="row right" style={{ marginTop: 12 }}>
                <button
                  className="btn"
                  onClick={async () => {
                    if (sCourseId === "" || !sStart) return;
                    await createSession({
                      course_id: sCourseId,
                      start_time: dt.toIso(sStart) ?? new Date().toISOString(),
                      end_time: dt.toIso(sEnd),
                      location: sLoc.trim() || null,
                      type: sType,
                      attended: 0,
                      notes: sNotes.trim() || null,
                    });
                    setSCourseId("");
                    setSStart("");
                    setSEnd("");
                    setSLoc("");
                    setSType("lecture");
                    setSNotes("");
                    await refreshAll();
                    ping("Session added ✅");
                  }}
                >
                  Add
                </button>
              </div>

              <hr className="sep" />
              <div className="muted small">
                Calendar shows both <b>classes</b> and <b>assessment deadlines</b>. Add deadlines in Assessments.
              </div>
            </section>
          </div>
        )}

        {/* ---------------- Grades ---------------- */}
        {page === "grades" && (
          <div className="grid">
            <section className="card">
              <h3>What-if Calculator</h3>
              <p className="muted small">Set a target overall grade. UniOS estimates what you need on remaining assessments (per course).</p>

              <div className="row" style={{ marginTop: 10 }}>
                <input className="input" type="number" min={0} max={100} value={targetOverall} onChange={(e) => setTargetOverall(Number(e.target.value))} />
                <span className="pill">
                  <span className="dot" style={{ background: "var(--accent2)" }} /> Target %
                </span>
              </div>

              <hr className="sep" />
              <div className="muted small">
                Tip: mark assessments as <b>graded</b> + add score/out-of for accurate tracking.
              </div>
            </section>

            <section className="card">
              <h3>Course Grade Summary</h3>

              {gradeSummaries.length === 0 ? (
                <p className="muted">No courses yet.</p>
              ) : (
                <table className="table">
                  <tbody>
                    {gradeSummaries.map((g) => {
                      const need = neededOnRemaining(g);
                      const remaining = Math.max(0, 100 - g.graded_weight);
                      return (
                        <tr className="tr" key={g.course_id}>
                          <td>
                            <div style={{ fontWeight: 950 }}>{g.code}</div>
                            <div className="muted small">{g.title}</div>
                          </td>
                          <td className="muted" style={{ width: 260 }}>
                            <div>
                              Graded weight: <b>{g.graded_weight.toFixed(2)}%</b>
                            </div>
                            <div>
                              Remaining: <b>{remaining.toFixed(2)}%</b>
                            </div>
                          </td>
                          <td style={{ width: 320 }}>
                            <div className="row wrap">
                              <span className="pill">
                                <span className="dot" style={{ background: "var(--accent2)" }} />
                                Current on graded: {g.current_percent ?? "—"}%
                              </span>
                              <span className="pill">
                                <span className="dot" style={{ background: "var(--good)" }} />
                                Overall so far: {g.projected_overall ?? "—"}%
                              </span>
                            </div>
                          </td>
                          <td style={{ width: 260 }}>
                            <span className="pill">
                              <span className="dot" style={{ background: need == null ? "var(--warn)" : need <= 100 ? "var(--good)" : "var(--bad)" }} />
                              Need on remaining: {need == null ? "—" : `${need}%`}
                            </span>
                            <div className="muted small" style={{ marginTop: 6 }}>
                              If need &gt; 100%, your target is impossible with remaining weight.
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}

        {/* ---------------- Tasks ---------------- */}
        {page === "tasks" && (
          <div className="grid">
            <section className="card">
              <h3>Add Task</h3>

              <div className="row" style={{ marginTop: 10 }}>
                <select className="select" value={tCourseId} onChange={(e) => setTCourseId(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">No course (general)</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <input className="input" placeholder="Task title" value={tTitle} onChange={(e) => setTTitle(e.target.value)} />
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <input className="input" type="datetime-local" value={tDue} onChange={(e) => setTDue(e.target.value)} />
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <select className="select" value={tPriority} onChange={(e) => setTPriority(Number(e.target.value) as TaskPriority)}>
                  <option value={1}>High</option>
                  <option value={2}>Medium</option>
                  <option value={3}>Low</option>
                </select>
              </div>

              <div className="row right" style={{ marginTop: 12 }}>
                <button
                  className="btn"
                  onClick={async () => {
                    if (!tTitle.trim()) return;
                    await createTask({
                      course_id: tCourseId === "" ? null : tCourseId,
                      title: tTitle.trim(),
                      due_time: dt.toIso(tDue),
                      priority: tPriority,
                      done: 0,
                    });
                    setTCourseId("");
                    setTTitle("");
                    setTDue("");
                    setTPriority(2);
                    await refreshAll();
                    ping("Task added ✅");
                  }}
                >
                  Add
                </button>
              </div>
            </section>

            <section className="card">
              <h3>Tasks</h3>

              {filteredTasks.length === 0 ? (
                <p className="muted">No tasks match your search.</p>
              ) : (
                <table className="table">
                  <tbody>
                    {filteredTasks.map((t: any) => (
                      <tr className="tr" key={t.id}>
                        <td>
                          <div style={{ fontWeight: 950, textDecoration: t.done ? "line-through" : "none" }}>{t.title}</div>
                          <div className="muted small">
                            {t.course_code ? `${t.course_code} • ` : ""}
                            {t.due_time ? new Date(t.due_time).toLocaleString() : "No due date"} • Priority {t.priority}
                          </div>
                        </td>
                        <td style={{ width: 360, textAlign: "right" }}>
                          <button
                            className="btn ghost"
                            onClick={async () => {
                              await toggleTask(t.id, t.done ? 0 : 1);
                              await refreshAll();
                              ping("Task updated");
                            }}
                          >
                            {t.done ? "Mark open" : "Mark done"}
                          </button>{" "}
                          <button className="btn ghost" onClick={() => openEditTask(t)}>
                            Edit
                          </button>{" "}
                          <button
                            className="btn danger"
                            onClick={async () => {
                              await deleteTask(t.id);
                              await refreshAll();
                              ping("Task deleted");
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}

        {/* ---------------- Settings ---------------- */}
        {page === "settings" && (
          <div className="grid">
            <section className="card">
              <h3>Personalization</h3>

              {!settings ? (
                <p className="muted">Loading settings…</p>
              ) : (
                <>
                  <div className="row" style={{ marginTop: 10 }}>
                    <span className="pill">
                      <span className="dot" style={{ background: settings.notifications_on ? "var(--good)" : "var(--bad)" }} />
                      In-app notifications: {settings.notifications_on ? "On" : "Off"}
                    </span>
                    <button
                      className="btn ghost"
                      onClick={async () => {
                        await updateSettings({ notifications_on: settings.notifications_on ? 0 : 1 });
                        await refreshAll();
                        ping("Settings updated");
                      }}
                    >
                      Toggle
                    </button>
                  </div>

                  <div className="row" style={{ marginTop: 10 }}>
                    <span className="pill">
                      <span className="dot" style={{ background: "var(--warn)" }} />
                      Week starts: {settings.week_starts_monday ? "Monday" : "Sunday"}
                    </span>
                    <button
                      className="btn ghost"
                      onClick={async () => {
                        await updateSettings({ week_starts_monday: settings.week_starts_monday ? 0 : 1 });
                        await refreshAll();
                        ping("Settings updated");
                      }}
                    >
                      Toggle
                    </button>
                  </div>

                  <div className="row" style={{ marginTop: 10 }}>
                    <input
                      className="input"
                      type="text"
                      value={settings.accent}
                      onChange={(e) => setSettings({ ...settings, accent: e.target.value })}
                      placeholder="#7c5cff"
                    />
                    <button
                      className="btn"
                      onClick={async () => {
                        await updateSettings({ accent: settings.accent });
                        await refreshAll();
                        ping("Accent applied ✅");
                      }}
                    >
                      Apply Accent
                    </button>
                  </div>

                  <p className="muted small" style={{ marginTop: 10 }}>
                    Try: <b>#23c4ff</b> (blue), <b>#7c5cff</b> (purple), <b>#2be38b</b> (green).
                  </p>
                </>
              )}
            </section>

            <section className="card">
              <h3>Backup & Restore</h3>
              <p className="muted small">Export everything to JSON. Paste it somewhere safe. Import restores everything.</p>

              <div className="row wrap" style={{ marginTop: 10 }}>
                <button
                  className="btn"
                  onClick={async () => {
                    const payload = await exportBackup();
                    const text = JSON.stringify(payload, null, 2);
                    await navigator.clipboard.writeText(text);
                    ping("Backup copied to clipboard ✅");
                  }}
                >
                  Export (Copy JSON)
                </button>

                <button
                  className="btn ghost"
                  onClick={async () => {
                    const raw = prompt("Paste your UniOS backup JSON here:");
                    if (!raw) return;
                    const payload = JSON.parse(raw);
                    await importBackup(payload);
                    await refreshAll();
                    ping("Import complete ✅");
                  }}
                >
                  Import (Paste JSON)
                </button>

                <button
                  className="btn danger"
                  onClick={async () => {
                    const ok = confirm("This will DELETE ALL UniOS data. Are you sure?");
                    if (!ok) return;
                    await wipeAllData();
                    await refreshAll();
                    ping("All data wiped");
                  }}
                >
                  Wipe All Data
                </button>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* ---------------- Day Modal ---------------- */}
      <Modal
        open={dayModalOpen}
        title={`Events • ${dayModalDate.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`}
        subtitle="Classes + deadlines for this day."
        onClose={() => setDayModalOpen(false)}
      >
        {dayModalEvents.length === 0 ? (
          <p className="muted">No events on this day.</p>
        ) : (
          <table className="table">
            <tbody>
              {dayModalEvents.map((ev) => (
                <tr key={`${ev.kind}-${ev.id}`} className="tr">
                  <td>
                    <div className="row spread wrap">
                      <div>
                        <div style={{ fontWeight: 950 }}>{ev.title}</div>
                        <div className="muted small">{ev.meta}</div>
                        <div className="muted small">{new Date(ev.when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                      </div>
                      <span className="pill">
                        <span className="dot" style={{ background: eventDotColor(ev.color) }} /> {ev.kind}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>

      {/* ---------------- Edit Modals ---------------- */}
      <Modal
        open={editCourseOpen}
        title="Edit Course"
        subtitle="Update code/title/status/credits/instructor."
        onClose={() => {
          setEditCourseOpen(false);
          setEditCourse(null);
        }}
      >
        {editCourse ? (
          <CourseEditor
            course={editCourse}
            onSave={async (patch) => {
              await updateCourse(editCourse.id, patch);
              await refreshAll();
              setEditCourseOpen(false);
              setEditCourse(null);
              ping("Course updated ✅");
            }}
          />
        ) : null}
      </Modal>

      <Modal
        open={editAssessmentOpen}
        title="Edit Assessment"
        subtitle="Update due date, weight, status and score."
        onClose={() => {
          setEditAssessmentOpen(false);
          setEditAssessment(null);
        }}
      >
        {editAssessment ? (
          <AssessmentEditor
            assessment={editAssessment}
            courses={courses}
            onSave={async (patch) => {
              await updateAssessment(editAssessment.id, patch);
              await refreshAll();
              setEditAssessmentOpen(false);
              setEditAssessment(null);
              ping("Assessment updated ✅");
            }}
          />
        ) : null}
      </Modal>

      <Modal
        open={editTaskOpen}
        title="Edit Task"
        subtitle="Update title, due date, priority, course and done."
        onClose={() => {
          setEditTaskOpen(false);
          setEditTask(null);
        }}
      >
        {editTask ? (
          <TaskEditor
            task={editTask}
            courses={courses}
            onSave={async (patch) => {
              await updateTask(editTask.id, patch);
              await refreshAll();
              setEditTaskOpen(false);
              setEditTask(null);
              ping("Task updated ✅");
            }}
          />
        ) : null}
      </Modal>

      <Modal
        open={editSessionOpen}
        title="Edit Class Session"
        subtitle="Update time, type, location, notes, and attendance."
        onClose={() => {
          setEditSessionOpen(false);
          setEditSession(null);
        }}
      >
        {editSession ? (
          <SessionEditor
            session={editSession}
            courses={courses}
            onSave={async (patch) => {
              await updateSession(editSession.id, patch);
              await refreshAll();
              setEditSessionOpen(false);
              setEditSession(null);
              ping("Session updated ✅");
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

/* ---------------- Editors ---------------- */
function CourseEditor(props: { course: Course; onSave: (patch: Partial<Course>) => void }) {
  const [code, setCode] = useState(props.course.code);
  const [title, setTitle] = useState(props.course.title);
  const [status, setStatus] = useState<CourseStatus>(props.course.status);
  const [credits, setCredits] = useState<number>(props.course.credits);
  const [instructor, setInstructor] = useState(props.course.instructor ?? "");

  return (
    <>
      <div className="row">
        <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" />
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value as CourseStatus)}>
          <option value="pending">pending</option>
          <option value="current">current</option>
          <option value="completed">completed</option>
        </select>
        <input className="input" type="number" value={credits} onChange={(e) => setCredits(Number(e.target.value))} />
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <input className="input" value={instructor} onChange={(e) => setInstructor(e.target.value)} placeholder="Instructor (optional)" />
      </div>

      <div className="row right" style={{ marginTop: 12 }}>
        <button
          className="btn"
          onClick={() =>
            props.onSave({
              code: code.trim().toUpperCase(),
              title: title.trim(),
              status,
              credits,
              instructor: instructor.trim() || null,
            })
          }
        >
          Save
        </button>
      </div>
    </>
  );
}

function AssessmentEditor(props: { assessment: AssessmentRow; courses: Course[]; onSave: (patch: any) => void }) {
  const a = props.assessment;
  const [courseId, setCourseId] = useState<number>(a.course_id);
  const [title, setTitle] = useState<string>(a.title);
  const [due, setDue] = useState<string>(toDatetimeLocal(a.due_time));
  const [weight, setWeight] = useState<number>(Number(a.weight ?? 0));
  const [status, setStatus] = useState<AssessmentStatus>(a.status);
  const [score, setScore] = useState<number | "">(a.score ?? "");
  const [outOf, setOutOf] = useState<number | "">(a.out_of ?? "");

  return (
    <>
      <div className="row">
        <select className="select" value={courseId} onChange={(e) => setCourseId(Number(e.target.value))}>
          {props.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.title}
            </option>
          ))}
        </select>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <input className="input" type="number" value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value as AssessmentStatus)}>
          <option value="not_started">not started</option>
          <option value="in_progress">in progress</option>
          <option value="submitted">submitted</option>
          <option value="graded">graded</option>
        </select>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <input className="input" type="number" placeholder="Score" value={score} onChange={(e) => setScore(e.target.value ? Number(e.target.value) : "")} />
        <input className="input" type="number" placeholder="Out of" value={outOf} onChange={(e) => setOutOf(e.target.value ? Number(e.target.value) : "")} />
      </div>

      <div className="row right" style={{ marginTop: 12 }}>
        <button
          className="btn"
          onClick={() =>
            props.onSave({
              course_id: courseId,
              title: title.trim(),
              due_time: dt.toIso(due),
              weight,
              status,
              score: score === "" ? null : score,
              out_of: outOf === "" ? null : outOf,
            })
          }
        >
          Save
        </button>
      </div>
    </>
  );
}

function TaskEditor(props: { task: any; courses: Course[]; onSave: (patch: any) => void }) {
  const t = props.task;
  const [courseId, setCourseId] = useState<number | "">(t.course_id ?? "");
  const [title, setTitle] = useState<string>(t.title);
  const [due, setDue] = useState<string>(toDatetimeLocal(t.due_time));
  const [priority, setPriority] = useState<TaskPriority>(t.priority ?? 2);
  const [done, setDone] = useState<number>(t.done ?? 0);

  return (
    <>
      <div className="row">
        <select className="select" value={courseId} onChange={(e) => setCourseId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">No course (general)</option>
          {props.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.title}
            </option>
          ))}
        </select>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" />
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <select className="select" value={priority} onChange={(e) => setPriority(Number(e.target.value) as TaskPriority)}>
          <option value={1}>High</option>
          <option value={2}>Medium</option>
          <option value={3}>Low</option>
        </select>
        <select className="select" value={done} onChange={(e) => setDone(Number(e.target.value))}>
          <option value={0}>Open</option>
          <option value={1}>Done</option>
        </select>
      </div>

      <div className="row right" style={{ marginTop: 12 }}>
        <button
          className="btn"
          onClick={() =>
            props.onSave({
              course_id: courseId === "" ? null : courseId,
              title: title.trim(),
              due_time: dt.toIso(due),
              priority,
              done,
            })
          }
        >
          Save
        </button>
      </div>
    </>
  );
}

function SessionEditor(props: { session: SessionRow; courses: Course[]; onSave: (patch: any) => void }) {
  const s = props.session;
  const [courseId, setCourseId] = useState<number>(s.course_id);
  const [start, setStart] = useState<string>(toDatetimeLocal(s.start_time));
  const [end, setEnd] = useState<string>(toDatetimeLocal(s.end_time));
  const [location, setLocation] = useState<string>(s.location ?? "");
  const [type, setType] = useState<ClassType>(s.type);
  const [attended, setAttended] = useState<number>(s.attended ?? 0);
  const [notes, setNotes] = useState<string>(s.notes ?? "");

  return (
    <>
      <div className="row">
        <select className="select" value={courseId} onChange={(e) => setCourseId(Number(e.target.value))}>
          {props.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.title}
            </option>
          ))}
        </select>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <input className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        <input className="input" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <select className="select" value={type} onChange={(e) => setType(e.target.value as ClassType)}>
          <option value="lecture">lecture</option>
          <option value="lab">lab</option>
          <option value="tutorial">tutorial</option>
          <option value="other">other</option>
        </select>
        <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" />
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <select className="select" value={attended} onChange={(e) => setAttended(Number(e.target.value))}>
          <option value={0}>Pending</option>
          <option value={1}>Attended</option>
        </select>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
      </div>

      <div className="row right" style={{ marginTop: 12 }}>
        <button
          className="btn"
          onClick={() =>
            props.onSave({
              course_id: courseId,
              start_time: dt.toIso(start) ?? new Date().toISOString(),
              end_time: dt.toIso(end),
              location: location.trim() || null,
              type,
              attended,
              notes: notes.trim() || null,
            })
          }
        >
          Save
        </button>
      </div>
    </>
  );
}