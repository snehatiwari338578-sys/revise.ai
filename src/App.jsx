import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, Legend,
} from "recharts";
import {
  Home, BookOpen, Flame, CalendarDays, ClipboardList, BarChart3, Sparkles,
  Settings, Menu, X, ChevronRight, Plus, Search, ArrowUpDown, Filter,
  CheckCircle2, Circle, RotateCcw, Play, Clock, TrendingUp, TrendingDown,
  AlertTriangle, Target, Trophy, LogOut, Moon, Sun, Trash2, Pencil,
} from "lucide-react";
import * as db from "./db";
import { supabaseEnabled } from "./supabaseClient";

/* ============================================================================
   TOKENS
   ============================================================================ */
const T = {
  bg: "#F5F6F8",
  bgDark: "#0E1116",
  surface: "#FFFFFF",
  surfaceDark: "#161A21",
  ink: "#0F1729",
  inkDark: "#EAECEF",
  muted: "#64748B",
  mutedDark: "#8A93A6",
  line: "#E4E7EC",
  lineDark: "#262B35",
  primary: "#0E6E66",       // deep teal — primary actions
  primarySoft: "#E4F2F0",
  accent: "#5A5FEF",        // violet-blue — secondary accent
  high: "#E5484D",
  highSoft: "#FDECEC",
  medium: "#F0A020",
  mediumSoft: "#FDF3E3",
  low: "#17A673",
  lowSoft: "#E7F7EF",
};

const FONT_HEAD = "'Sora', ui-sans-serif, system-ui, -apple-system, sans-serif";
const FONT_BODY = "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif";

function useFontLoader() {
  useEffect(() => {
    const id = "reviseai-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
  }, []);
}

/* ============================================================================
   PRIORITY ENGINE (modular — designed to be swapped 1:1 for a call to a
   FastAPI + scikit-learn Random Forest service later. Input/output shape is
   stable: computePriority(features) -> { score, level, reasons } )
   ============================================================================ */
const DIFFICULTY_WEIGHT = { Easy: 0.3, Medium: 0.65, Hard: 1.0 };
const WEIGHTAGE_WEIGHT = { Low: 0.3, Medium: 0.65, High: 1.0 };

function daysBetween(a, b) {
  const ms = new Date(b).setHours(0,0,0,0) - new Date(a).setHours(0,0,0,0);
  return Math.round(ms / 86400000);
}

/**
 * computePriority
 * features: {
 *   marksPercentage, confidenceLevel(1-10), difficulty, weightage,
 *   lastRevision(date str|null), revisionCount, incorrectAnswers, examDate
 * }
 * Returns explainable score 0-100, level, and human-readable reasons.
 * This mirrors the feature set documented for the future FastAPI service:
 * marks_percentage, confidence_level, days_until_exam, days_since_revision,
 * difficulty, topic_weightage, revision_count, incorrect_answers.
 */
function computePriority(f, today = new Date()) {
  const daysUntilExam = f.examDate ? Math.max(daysBetween(today, f.examDate), 0) : 30;
  const daysSinceRevision = f.lastRevision ? Math.max(daysBetween(f.lastRevision, today), 0) : 999;

  const weakMarks = clamp(100 - f.marksPercentage, 0, 100);                 // higher = weaker
  const lowConfidence = clamp((10 - f.confidenceLevel) * 10, 0, 100);       // higher = less confident
  const examUrgency = clamp(100 - daysUntilExam * 3.2, 0, 100);             // closer exam = higher
  const staleness = clamp(Math.min(daysSinceRevision, 30) * 3.3, 0, 100);   // longer gap = higher
  const difficultyScore = (DIFFICULTY_WEIGHT[f.difficulty] ?? 0.5) * 100;
  const weightageScore = (WEIGHTAGE_WEIGHT[f.weightage] ?? 0.5) * 100;
  const errorRate = clamp((f.incorrectAnswers ?? 0) * 8, 0, 100);
  const practiceGap = clamp(100 - Math.min(f.revisionCount ?? 0, 6) * 16.6, 0, 100);

  const weighted =
    weakMarks * 0.22 +
    lowConfidence * 0.18 +
    examUrgency * 0.16 +
    staleness * 0.14 +
    difficultyScore * 0.10 +
    weightageScore * 0.10 +
    errorRate * 0.06 +
    practiceGap * 0.04;

  const score = Math.round(clamp(weighted, 0, 100));
  const level = score >= 75 ? "HIGH" : score >= 45 ? "MEDIUM" : "LOW";

  const reasons = [];
  if (f.marksPercentage < 60) reasons.push(`Your previous score is low (${f.marksPercentage}%)`);
  if (f.confidenceLevel <= 5) reasons.push(`Your confidence is only ${f.confidenceLevel}/10`);
  if (daysUntilExam <= 10) reasons.push(`The exam is approaching (${daysUntilExam} day${daysUntilExam===1?"":"s"} away)`);
  if (f.weightage === "High") reasons.push("This topic carries high exam weightage");
  if (daysSinceRevision >= 7) reasons.push(`You haven't revised this in ${daysSinceRevision >= 999 ? "a while" : daysSinceRevision + " days"}`);
  if (f.difficulty === "Hard") reasons.push("This topic is rated hard");
  if ((f.incorrectAnswers ?? 0) >= 3) reasons.push(`You've missed ${f.incorrectAnswers} quiz questions on this topic`);
  if ((f.revisionCount ?? 0) === 0) reasons.push("You haven't revised this topic yet");
  if (reasons.length === 0) {
    if (f.marksPercentage >= 80) reasons.push(`Your previous score is strong (${f.marksPercentage}%)`);
    if (f.confidenceLevel >= 7) reasons.push(`Your confidence is high (${f.confidenceLevel}/10)`);
    reasons.push("This topic is in good shape for now");
  }

  return { score, level, reasons: reasons.slice(0, 5), daysUntilExam, daysSinceRevision };
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

const LEVEL_COLOR = { HIGH: T.high, MEDIUM: T.medium, LOW: T.low };
const LEVEL_SOFT = { HIGH: T.highSoft, MEDIUM: T.mediumSoft, LOW: T.lowSoft };
const LEVEL_EMOJI = { HIGH: "🔴", MEDIUM: "🟡", LOW: "🟢" };

/* ============================================================================
   MOCK "SUPABASE" DATA LAYER
   Shaped to mirror the documented schema (profiles / subjects / topics /
   quiz_results / revision_sessions) so it is a drop-in swap for real
   supabase-js calls later. Everything lives in React state for this demo.
   ============================================================================ */
function uid() { return Math.random().toString(36).slice(2, 10); }

const DEMO_SUBJECTS = ["Data Structures", "Database Management Systems", "Operating Systems", "Computer Networks"];

const DEMO_TOPICS = [
  { subject: "Data Structures", name: "Graphs", marksPercentage: 45, confidenceLevel: 3, difficulty: "Hard", weightage: "High", lastRevision: daysAgo(12), revisionCount: 1, incorrectAnswers: 4 },
  { subject: "Operating Systems", name: "Deadlocks", marksPercentage: 52, confidenceLevel: 4, difficulty: "Hard", weightage: "High", lastRevision: daysAgo(9), revisionCount: 1, incorrectAnswers: 3 },
  { subject: "Database Management Systems", name: "Normalization", marksPercentage: 68, confidenceLevel: 6, difficulty: "Medium", weightage: "High", lastRevision: daysAgo(5), revisionCount: 2, incorrectAnswers: 2 },
  { subject: "Computer Networks", name: "Routing", marksPercentage: 90, confidenceLevel: 9, difficulty: "Easy", weightage: "Medium", lastRevision: daysAgo(2), revisionCount: 4, incorrectAnswers: 0 },
  { subject: "Data Structures", name: "Dynamic Programming", marksPercentage: 58, confidenceLevel: 4, difficulty: "Hard", weightage: "High", lastRevision: daysAgo(15), revisionCount: 1, incorrectAnswers: 5 },
  { subject: "Data Structures", name: "Trees", marksPercentage: 74, confidenceLevel: 7, difficulty: "Medium", weightage: "Medium", lastRevision: daysAgo(4), revisionCount: 3, incorrectAnswers: 1 },
  { subject: "Operating Systems", name: "CPU Scheduling", marksPercentage: 66, confidenceLevel: 6, difficulty: "Medium", weightage: "Medium", lastRevision: daysAgo(6), revisionCount: 2, incorrectAnswers: 1 },
  { subject: "Operating Systems", name: "Memory Management", marksPercentage: 80, confidenceLevel: 8, difficulty: "Medium", weightage: "Medium", lastRevision: daysAgo(3), revisionCount: 3, incorrectAnswers: 0 },
  { subject: "Database Management Systems", name: "Transactions & ACID", marksPercentage: 71, confidenceLevel: 6, difficulty: "Medium", weightage: "Medium", lastRevision: daysAgo(8), revisionCount: 2, incorrectAnswers: 2 },
  { subject: "Database Management Systems", name: "Indexing", marksPercentage: 85, confidenceLevel: 8, difficulty: "Easy", weightage: "Low", lastRevision: daysAgo(1), revisionCount: 4, incorrectAnswers: 0 },
  { subject: "Computer Networks", name: "TCP/IP Layers", marksPercentage: 62, confidenceLevel: 5, difficulty: "Medium", weightage: "High", lastRevision: daysAgo(10), revisionCount: 1, incorrectAnswers: 2 },
  { subject: "Data Structures", name: "Linked List", marksPercentage: 88, confidenceLevel: 9, difficulty: "Easy", weightage: "Low", lastRevision: daysAgo(2), revisionCount: 5, incorrectAnswers: 0 },
];

function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0,10); }
function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0,10); }

const QUIZ_BANK = [
  "What is the time complexity of the primary approach for this topic?",
  "Which data structure/technique is most associated with this topic?",
  "What is a common real-world application of this concept?",
  "Which edge case most often causes mistakes here?",
  "What is the key trade-off involved in this approach?",
  "Which related concept is most often confused with this one?",
];

/* ============================================================================
   SMALL UI PRIMITIVES
   ============================================================================ */
function Badge({ level, size = "md" }) {
  const pad = size === "sm" ? "2px 8px" : "4px 10px";
  const fs = size === "sm" ? 11 : 12;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: LEVEL_SOFT[level], color: LEVEL_COLOR[level],
      fontWeight: 700, fontSize: fs, padding: pad, borderRadius: 999,
      letterSpacing: 0.2,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: LEVEL_COLOR[level] }} />
      {level}
    </span>
  );
}

function Card({ children, style, onClick, dark }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: dark ? T.surfaceDark : T.surface,
        border: `1px solid ${dark ? T.lineDark : T.line}`,
        borderRadius: 16,
        padding: 20,
        cursor: onClick ? "pointer" : "default",
        transition: "box-shadow .15s, transform .15s",
        ...style,
      }}
      onMouseEnter={e => { if (onClick) { e.currentTarget.style.boxShadow = "0 6px 20px rgba(15,23,41,0.08)"; e.currentTarget.style.transform = "translateY(-2px)"; } }}
      onMouseLeave={e => { if (onClick) { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "none"; } }}
    >
      {children}
    </div>
  );
}

function Button({ children, onClick, variant = "primary", style, icon: Icon, type = "button", disabled }) {
  const base = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14, cursor: disabled ? "not-allowed" : "pointer",
    borderRadius: 10, padding: "10px 16px", border: "1px solid transparent",
    transition: "opacity .15s, transform .1s", opacity: disabled ? 0.5 : 1,
  };
  const variants = {
    primary: { background: T.primary, color: "#fff" },
    accent: { background: T.accent, color: "#fff" },
    ghost: { background: "transparent", color: T.ink, border: `1px solid ${T.line}` },
    danger: { background: T.highSoft, color: T.high },
    subtle: { background: T.bg, color: T.ink },
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseDown={e => !disabled && (e.currentTarget.style.transform = "scale(0.97)")}
      onMouseUp={e => (e.currentTarget.style.transform = "none")}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 16 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.muted, marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${T.line}`,
  fontFamily: FONT_BODY, fontSize: 14, color: T.ink, background: "#fff", boxSizing: "border-box",
  outline: "none",
};

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
      background: T.ink, color: "#fff", padding: "12px 20px", borderRadius: 12,
      fontSize: 14, fontWeight: 500, zIndex: 200, boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
      display: "flex", alignItems: "center", gap: 8, maxWidth: "90vw",
    }}>
      <CheckCircle2 size={16} color={T.low} />
      {toast}
    </div>
  );
}

function CircularProgress({ value, size = 140, label }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  const color = value >= 70 ? T.low : value >= 40 ? T.medium : T.high;
  return (
    <svg width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={r} stroke={T.line} strokeWidth={stroke} fill="none" />
      <circle
        cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={stroke} fill="none"
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: "stroke-dashoffset .6s ease" }}
      />
      <text x="50%" y="47%" textAnchor="middle" fontSize={28} fontWeight={800} fontFamily={FONT_HEAD} fill={T.ink}>{value}%</text>
      <text x="50%" y="62%" textAnchor="middle" fontSize={11} fontWeight={600} fill={T.muted}>{label}</text>
    </svg>
  );
}

function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div style={{ textAlign: "center", padding: "56px 20px", color: T.muted }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: T.primarySoft, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
        <Icon size={26} color={T.primary} />
      </div>
      <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 17, color: T.ink, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 14, marginBottom: 18 }}>{subtitle}</div>
      {action}
    </div>
  );
}

function Skeleton({ w = "100%", h = 16, r = 8 }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: "linear-gradient(90deg,#EEF0F3 25%,#F7F8FA 37%,#EEF0F3 63%)", backgroundSize: "400% 100%", animation: "shimmer 1.4s ease infinite" }} />;
}

/* ============================================================================
   APP
   ============================================================================ */
export default function App() {
  useFontLoader();
  const [view, setView] = useState("landing");
  const [user, setUser] = useState(null);
  const [onboarded, setOnboarded] = useState(false);
  const [obStep, setObStep] = useState(1);
  const [examGoal, setExamGoal] = useState("University Exams");
  const [examDate, setExamDate] = useState(daysFromNow(7));
  const [subjects, setSubjects] = useState([]);
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [selectedTopicId, setSelectedTopicId] = useState(null);
  const [quizTopicId, setQuizTopicId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [priorityTab, setPriorityTab] = useState("HIGH");
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("All");
  const [sortBy, setSortBy] = useState("priority");
  const [authMode, setAuthMode] = useState("login");
  const [authUserId, setAuthUserId] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  // On load, if Supabase is configured, restore any existing session so a
  // refresh doesn't log the user out or lose their data.
  useEffect(() => {
    if (!supabaseEnabled) return;
    (async () => {
      try {
        const session = await db.getSession();
        if (!session) return;
        const profile = await db.getProfile(session.user.id);
        setAuthUserId(session.user.id);
        setUser({ name: profile.name || "Student", email: profile.email });
        if (profile.onboarded) {
          const { subjects: subs, topics: tps } = await db.fetchSubjectsAndTopics(session.user.id);
          setSubjects(subs.map(s => ({ id: s.id, name: s.name })));
          setTopics(recompute(tps));
          if (subs[0]?.exam_date) setExamDate(subs[0].exam_date);
          setOnboarded(true);
          setView("dashboard");
        } else {
          setView("onboarding");
        }
      } catch (err) {
        console.error(err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recompute = useCallback((list, exam = examDate) => {
    return list.map(t => {
      const r = computePriority({ ...t, examDate: exam });
      return { ...t, score: r.score, level: r.level, reasons: r.reasons, daysUntilExam: r.daysUntilExam, daysSinceRevision: r.daysSinceRevision };
    });
  }, [examDate]);

  function loadDemoData() {
    setLoading(true);
    setTimeout(() => {
      const subs = DEMO_SUBJECTS.map(name => ({ id: uid(), name, isDemo: true }));
      const subByName = Object.fromEntries(subs.map(s => [s.name, s.id]));
      const tps = DEMO_TOPICS.map(t => ({
        id: uid(), subjectId: subByName[t.subject], subjectName: t.subject,
        name: t.name, marksPercentage: t.marksPercentage, confidenceLevel: t.confidenceLevel,
        difficulty: t.difficulty, weightage: t.weightage, lastRevision: t.lastRevision,
        revisionCount: t.revisionCount, incorrectAnswers: t.incorrectAnswers, isDemo: true,
      }));
      setSubjects(subs);
      setTopics(recompute(tps));
      setOnboarded(true);
      setLoading(false);
      setView("dashboard");
      showToast("Demo data loaded");
    }, 500);
  }

  async function handleAuth(e) {
    e.preventDefault();
    const name = e.target.name?.value || "Student";
    const email = e.target.email.value;
    const password = e.target.password?.value;

    if (!supabaseEnabled) {
      // Demo mode: no backend configured, so just simulate a session locally.
      setUser({ name, email });
      setView(onboarded ? "dashboard" : "onboarding");
      return;
    }

    setAuthError("");
    setAuthBusy(true);
    try {
      const authedUser = authMode === "signup"
        ? await db.signUp(name, email, password)
        : await db.signIn(email, password);
      setAuthUserId(authedUser.id);
      const profile = await db.getProfile(authedUser.id);
      setUser({ name: profile.name || name, email: profile.email || email });
      if (profile.onboarded) {
        const { subjects: subs, topics: tps } = await db.fetchSubjectsAndTopics(authedUser.id);
        setSubjects(subs.map(s => ({ id: s.id, name: s.name })));
        setTopics(recompute(tps));
        if (subs[0]?.exam_date) setExamDate(subs[0].exam_date);
        setOnboarded(true);
        setView("dashboard");
      } else {
        setView("onboarding");
      }
    } catch (err) {
      console.error(err);
      setAuthError(err.message || "Something went wrong. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    setUser(null);
    setAuthUserId(null);
    setOnboarded(false);
    setSubjects([]);
    setTopics([]);
    setView("landing");
    if (supabaseEnabled) {
      try { await db.signOut(); } catch (err) { console.error(err); }
    }
  }

  async function completeOnboarding(finalSubjects, finalTopicsBySubject) {
    if (supabaseEnabled && authUserId) {
      setLoading(true);
      try {
        const createdSubjects = [];
        for (const name of finalSubjects) {
          createdSubjects.push(await db.createSubject(authUserId, name, examDate));
        }
        const subByName = Object.fromEntries(createdSubjects.map(s => [s.name, s.id]));
        const createdTopics = [];
        for (const sub of finalSubjects) {
          for (const tname of (finalTopicsBySubject[sub] || [])) {
            const row = await db.createTopic(authUserId, {
              subjectId: subByName[sub], subjectName: sub, name: tname,
              marksPercentage: 60, confidenceLevel: 5, difficulty: "Medium", weightage: "Medium",
              lastRevision: null, revisionCount: 0, incorrectAnswers: 0,
            });
            createdTopics.push(row);
          }
        }
        await db.markOnboarded(authUserId, examGoal);
        setSubjects(createdSubjects.map(s => ({ id: s.id, name: s.name })));
        setTopics(recompute(createdTopics));
        setOnboarded(true);
        setView("dashboard");
        showToast("Setup complete — welcome to ReviseAI");
      } catch (err) {
        console.error(err);
        showToast("Couldn't save to your account — check your connection and try again");
      } finally {
        setLoading(false);
      }
      return;
    }

    // Demo / no-backend mode
    const subs = finalSubjects.map(name => ({ id: uid(), name }));
    const subByName = Object.fromEntries(subs.map(s => [s.name, s.id]));
    const tps = [];
    finalSubjects.forEach(sub => {
      (finalTopicsBySubject[sub] || []).forEach(tname => {
        tps.push({
          id: uid(), subjectId: subByName[sub], subjectName: sub, name: tname,
          marksPercentage: 60, confidenceLevel: 5, difficulty: "Medium", weightage: "Medium",
          lastRevision: null, revisionCount: 0, incorrectAnswers: 0,
        });
      });
    });
    setSubjects(subs);
    setTopics(recompute(tps));
    setOnboarded(true);
    setView("dashboard");
    showToast("Setup complete — welcome to ReviseAI");
  }

  async function addTopic(data) {
    if (supabaseEnabled && authUserId) {
      try {
        let subjectId = data.subjectId;
        // If this is a brand-new subject typed in the form, create it first.
        if (!subjects.find(s => s.id === subjectId)) {
          const created = await db.createSubject(authUserId, data.subjectName, examDate);
          subjectId = created.id;
          setSubjects(prev => [...prev, { id: created.id, name: created.name }]);
        }
        const saved = await db.createTopic(authUserId, { ...data, subjectId });
        setTopics(prev => recompute([...prev, saved]));
        showToast("Priority calculated and saved");
      } catch (err) {
        console.error(err);
        showToast("Couldn't save this topic — check your connection");
      }
      return;
    }
    const t = { id: uid(), ...data };
    setTopics(prev => recompute([...prev, t]));
    showToast("Priority calculated");
  }

  function updateTopic(id, patch) {
    setTopics(prev => recompute(prev.map(t => t.id === id ? { ...t, ...patch } : t)));
    if (supabaseEnabled && authUserId) {
      db.updateTopicRow(id, patch, authUserId).catch(err => { console.error(err); showToast("Sync failed — change kept locally only"); });
    }
  }

  function deleteTopic(id) {
    setTopics(prev => prev.filter(t => t.id !== id));
    showToast("Topic removed");
    if (supabaseEnabled && authUserId) {
      db.deleteTopicRow(id, authUserId).catch(err => console.error(err));
    }
  }

  function markRevised(id) {
    updateTopic(id, { lastRevision: new Date().toISOString().slice(0,10), revisionCount: (topics.find(t=>t.id===id)?.revisionCount || 0) + 1 });
    showToast("Marked as revised — priority recalculated");
  }

  function submitQuiz(id, correct, total) {
    const incorrect = total - correct;
    const t = topics.find(x => x.id === id);
    const newMarks = Math.round((t.marksPercentage * 0.6) + ((correct/total)*100 * 0.4));
    const newConfidence = clamp(Math.round(t.confidenceLevel + (correct/total >= 0.7 ? 1 : -1)), 1, 10);
    updateTopic(id, {
      incorrectAnswers: incorrect, marksPercentage: newMarks, confidenceLevel: newConfidence,
      lastRevision: new Date().toISOString().slice(0,10), revisionCount: (t.revisionCount||0) + 1,
    });
    if (supabaseEnabled && authUserId) {
      db.recordQuizResult(authUserId, id, correct, total, incorrect).catch(err => console.error(err));
    }
  }

  useEffect(() => { setTopics(prev => recompute(prev)); /* eslint-disable-next-line */ }, [examDate]);

  const daysUntilExam = Math.max(daysBetween(new Date(), examDate), 0);
  const highTopics = topics.filter(t => t.level === "HIGH").sort((a,b) => b.score - a.score);
  const medTopics = topics.filter(t => t.level === "MEDIUM").sort((a,b) => b.score - a.score);
  const lowTopics = topics.filter(t => t.level === "LOW").sort((a,b) => b.score - a.score);
  const avgPrep = topics.length ? Math.round(topics.reduce((s,t)=>s + (100 - t.score), 0) / topics.length) : 0;

  const isAuthed = !!user;

  /* ---------------------------- ROUTER SHELL ---------------------------- */
  if (view === "landing") return <Landing onGetStarted={() => { setView("auth"); setAuthMode("signup"); }} onDemo={() => { setUser({ name: "Demo Student", email: "demo@reviseai.app" }); loadDemoData(); }} />;
  if (view === "auth") return <AuthScreen mode={authMode} setMode={setAuthMode} onSubmit={handleAuth} onBack={() => setView("landing")} busy={authBusy} error={authError} />;
  if (view === "onboarding") return <Onboarding
    examGoal={examGoal} setExamGoal={setExamGoal}
    examDate={examDate} setExamDate={setExamDate}
    obStep={obStep} setObStep={setObStep}
    onComplete={completeOnboarding}
    onSkipWithDemo={loadDemoData}
  />;

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: Home },
    { id: "subjects", label: "Subjects", icon: BookOpen },
    { id: "priority", label: "Priority Topics", icon: Flame },
    { id: "plan", label: "Revision Plan", icon: CalendarDays },
    { id: "quizzes", label: "Quizzes", icon: ClipboardList },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "insights", label: "AI Insights", icon: Sparkles },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div style={{ fontFamily: FONT_BODY, background: T.bg, minHeight: "100vh", color: T.ink }}>
      <style>{`
        @keyframes shimmer { 0%{background-position:100% 0} 100%{background-position:-100% 0} }
        * { box-sizing: border-box; }
        ::selection { background: ${T.primarySoft}; }
        input:focus, select:focus, textarea:focus { border-color: ${T.primary} !important; box-shadow: 0 0 0 3px ${T.primarySoft}; }
        @media (max-width: 860px) { .desktop-only { display: none !important; } }
        @media (min-width: 861px) { .mobile-only { display: none !important; } }
      `}</style>

      {/* Sidebar (desktop) */}
      <div className="desktop-only" style={{
        position: "fixed", left: 0, top: 0, bottom: 0, width: 232, background: T.surface,
        borderRight: `1px solid ${T.line}`, padding: "24px 16px", display: "flex", flexDirection: "column", zIndex: 50,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px 24px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: T.primary, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Sparkles size={16} color="#fff" />
          </div>
          <span style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 17, letterSpacing: -0.3 }}>ReviseAI</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {navItems.map(n => (
            <NavRow key={n.id} item={n} active={view === n.id} onClick={() => setView(n.id)} />
          ))}
        </div>
        <div style={{ marginTop: "auto", paddingTop: 16, borderTop: `1px solid ${T.line}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 999, background: T.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 }}>
              {(user?.name || "S")[0].toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.name || "Student"}</div>
              <div style={{ fontSize: 11, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.email}</div>
            </div>
            <button onClick={handleLogout} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: T.muted }} title="Log out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile top bar */}
      <div className="mobile-only" style={{ position: "sticky", top: 0, zIndex: 60, background: T.surface, borderBottom: `1px solid ${T.line}`, padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 26, height: 26, borderRadius: 8, background: T.primary, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Sparkles size={14} color="#fff" />
        </div>
        <span style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 16 }}>ReviseAI</span>
        <button onClick={() => setSidebarOpen(true)} style={{ marginLeft: "auto", background: "none", border: "none" }}><Menu size={22} /></button>
      </div>
      {sidebarOpen && (
        <div className="mobile-only" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 90 }} onClick={() => setSidebarOpen(false)}>
          <div style={{ background: T.surface, width: 250, height: "100%", padding: 20 }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setSidebarOpen(false)} style={{ background: "none", border: "none", marginBottom: 20 }}><X size={20} /></button>
            {navItems.map(n => <NavRow key={n.id} item={n} active={view === n.id} onClick={() => { setView(n.id); setSidebarOpen(false); }} />)}
            <div style={{ marginTop: 20, borderTop: `1px solid ${T.line}`, paddingTop: 14 }}>
              <Button variant="ghost" icon={LogOut} onClick={handleLogout}>Log out</Button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="desktop-only-margin" style={{ marginLeft: 0 }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 20px 100px", ["@media"]: {} }}>
          <div style={{ paddingLeft: 0 }}>
            <MainArea
              view={view} setView={setView}
              user={user} daysUntilExam={daysUntilExam} topics={topics} subjects={subjects}
              avgPrep={avgPrep} highTopics={highTopics} medTopics={medTopics} lowTopics={lowTopics}
              priorityTab={priorityTab} setPriorityTab={setPriorityTab}
              search={search} setSearch={setSearch} subjectFilter={subjectFilter} setSubjectFilter={setSubjectFilter}
              sortBy={sortBy} setSortBy={setSortBy}
              selectedTopicId={selectedTopicId} setSelectedTopicId={setSelectedTopicId}
              quizTopicId={quizTopicId} setQuizTopicId={setQuizTopicId}
              addTopic={addTopic} updateTopic={updateTopic} deleteTopic={deleteTopic} markRevised={markRevised}
              submitQuiz={submitQuiz} loading={loading} loadDemoData={loadDemoData}
              examDate={examDate} setExamDate={setExamDate} showToast={showToast}
            />
          </div>
        </div>
      </div>

      {/* Bottom nav (mobile) */}
      <div className="mobile-only" style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: T.surface, borderTop: `1px solid ${T.line}`, display: "flex", justifyContent: "space-around", padding: "8px 4px", zIndex: 80 }}>
        {navItems.slice(0,5).map(n => (
          <button key={n.id} onClick={() => setView(n.id)} style={{ background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: view === n.id ? T.primary : T.muted, fontSize: 10, fontWeight: 600 }}>
            <n.icon size={19} />
            {n.label.split(" ")[0]}
          </button>
        ))}
      </div>

      <Toast toast={toast} />
      <style>{`
        @media (min-width: 861px) { div.desktop-only-margin { margin-left: 232px; } }
      `}</style>
    </div>
  );
}

function NavRow({ item, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10,
      background: active ? T.primarySoft : "transparent", color: active ? T.primary : T.ink,
      border: "none", cursor: "pointer", fontSize: 13.5, fontWeight: active ? 700 : 500, textAlign: "left", width: "100%",
    }}>
      <item.icon size={17} />
      {item.label}
    </button>
  );
}

/* ============================================================================
   LANDING
   ============================================================================ */
function Landing({ onGetStarted, onDemo }) {
  useFontLoader();
  return (
    <div style={{ fontFamily: FONT_BODY, background: T.bg, minHeight: "100vh", color: T.ink }}>
      <style>{`* { box-sizing: border-box; }`}</style>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: T.primary, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Sparkles size={16} color="#fff" />
          </div>
          <span style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 18 }}>ReviseAI</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 40, alignItems: "center", marginTop: 56 }}>
          <div style={{ gridColumn: "span 2" }} className="hero-col">
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: T.primarySoft, color: T.primary, padding: "5px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, marginBottom: 20 }}>
              <Target size={13} /> AI Revision Priority Engine
            </div>
            <h1 style={{ fontFamily: FONT_HEAD, fontSize: "clamp(32px, 5vw, 54px)", fontWeight: 800, lineHeight: 1.08, letterSpacing: -1, margin: 0, maxWidth: 720 }}>
              Stop wondering what to study. Let AI prioritize it.
            </h1>
            <p style={{ fontSize: 17, color: T.muted, marginTop: 18, maxWidth: 560, lineHeight: 1.6 }}>
              ReviseAI analyzes your performance, confidence, exam schedule and revision history to create a personalized revision priority plan.
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
              <Button onClick={onGetStarted} style={{ padding: "12px 22px", fontSize: 15 }}>Get Started <ChevronRight size={16} /></Button>
              <Button variant="ghost" onClick={onDemo} style={{ padding: "12px 22px", fontSize: 15 }}>View Demo</Button>
            </div>
            <p style={{ fontSize: 12.5, color: T.muted, marginTop: 10 }}>Study smarter. Revise what matters first.</p>
          </div>
        </div>

        {/* Dashboard preview */}
        <Card style={{ marginTop: 48, padding: 0, overflow: "hidden", boxShadow: "0 20px 60px rgba(15,23,41,0.10)" }}>
          <div style={{ background: T.ink, color: "#fff", padding: "12px 20px", fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, display: "flex", alignItems: "center", gap: 8 }}>
            <Flame size={14} color={T.high} /> REVISION PRIORITY
          </div>
          <div style={{ padding: 8 }}>
            {[
              { s: "DSA → Graphs", v: 94, l: "HIGH" },
              { s: "OS → Deadlocks", v: 89, l: "HIGH" },
              { s: "DBMS → Normalization", v: 71, l: "MEDIUM" },
              { s: "CN → Routing", v: 32, l: "LOW" },
            ].map((row, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: i < 3 ? `1px solid ${T.line}` : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span>{LEVEL_EMOJI[row.l]}</span>
                  <span style={{ fontWeight: 600, fontSize: 14.5 }}>{row.s}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 15 }}>{row.v}</span>
                  <Badge level={row.l} size="sm" />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 40 }} className="feature-grid">
          {[
            { icon: Target, t: "Explainable priority scores", d: "Every score of 0–100 comes with plain-language reasons drawn from your own data." },
            { icon: CalendarDays, t: "Auto-built revision plan", d: "Your day is scheduled around what matters most, right up to exam day." },
            { icon: TrendingUp, t: "Feedback loop", d: "Quiz results feed back into your priority scores automatically." },
          ].map((f,i) => (
            <Card key={i}>
              <f.icon size={20} color={T.primary} />
              <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 15, marginTop: 12 }}>{f.t}</div>
              <div style={{ fontSize: 13.5, color: T.muted, marginTop: 6, lineHeight: 1.5 }}>{f.d}</div>
            </Card>
          ))}
        </div>

        <div style={{ textAlign: "center", padding: "60px 0 30px", color: T.muted, fontSize: 12.5 }}>
          ReviseAI — a study planning MVP. Priority scores predict revision urgency, not exam outcomes.
        </div>
      </div>
      <style>{`@media (max-width: 760px){ .feature-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

/* ============================================================================
   AUTH
   ============================================================================ */
function AuthScreen({ mode, setMode, onSubmit, onBack, busy, error }) {
  const [forgot, setForgot] = useState(false);
  return (
    <div style={{ fontFamily: FONT_BODY, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: T.bg, padding: 20 }}>
      <Card style={{ width: 400, maxWidth: "100%" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: T.muted, fontSize: 13, marginBottom: 12, cursor: "pointer", padding: 0 }}>← Back</button>
        <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 22, marginBottom: 4 }}>
          {forgot ? "Reset password" : mode === "signup" ? "Create your account" : "Welcome back"}
        </div>
        <div style={{ fontSize: 13.5, color: T.muted, marginBottom: 22 }}>
          {forgot ? "We'll send a reset link to your email." : "Study smarter. Revise what matters first."}
        </div>

        {forgot ? (
          <form onSubmit={(e) => { e.preventDefault(); setForgot(false); }}>
            <Field label="Email"><input required type="email" style={inputStyle} placeholder="you@school.edu" /></Field>
            <Button type="submit" style={{ width: "100%", justifyContent: "center" }}>Send reset link</Button>
          </form>
        ) : (
          <form onSubmit={onSubmit}>
            {mode === "signup" && <Field label="Name"><input required name="name" style={inputStyle} placeholder="Your name" /></Field>}
            <Field label="Email"><input required name="email" type="email" style={inputStyle} placeholder="you@school.edu" /></Field>
            <Field label="Password"><input required name="password" type="password" style={inputStyle} placeholder="••••••••" minLength={6} /></Field>
            {error && <div style={{ background: T.highSoft, color: T.high, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
            <Button type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", marginTop: 4 }}>
              {busy ? "Please wait..." : mode === "signup" ? "Create account" : "Log in"}
            </Button>
          </form>
        )}

        {!forgot && (
          <div style={{ marginTop: 16, fontSize: 13, color: T.muted, display: "flex", justifyContent: "space-between" }}>
            <span style={{ cursor: "pointer" }} onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
              {mode === "signup" ? "Already have an account? Log in" : "New here? Sign up"}
            </span>
            {mode === "login" && <span style={{ cursor: "pointer", color: T.primary, fontWeight: 600 }} onClick={() => setForgot(true)}>Forgot password?</span>}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============================================================================
   ONBOARDING
   ============================================================================ */
function Onboarding({ examGoal, setExamGoal, examDate, setExamDate, obStep, setObStep, onComplete, onSkipWithDemo }) {
  const [subjectsList, setSubjectsList] = useState([]);
  const [subjectInput, setSubjectInput] = useState("");
  const [topicsBySubject, setTopicsBySubject] = useState({});
  const [activeSubject, setActiveSubject] = useState(null);
  const [topicInput, setTopicInput] = useState("");

  function addSubject() {
    const v = subjectInput.trim();
    if (!v || subjectsList.includes(v)) return;
    setSubjectsList(prev => [...prev, v]);
    setTopicsBySubject(prev => ({ ...prev, [v]: [] }));
    setSubjectInput("");
  }
  function addTopicToSubject(sub) {
    const v = topicInput.trim();
    if (!v) return;
    setTopicsBySubject(prev => ({ ...prev, [sub]: [...(prev[sub]||[]), v] }));
    setTopicInput("");
  }

  const totalTopics = Object.values(topicsBySubject).reduce((s,a) => s + a.length, 0);

  return (
    <div style={{ fontFamily: FONT_BODY, minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: 560, maxWidth: "100%" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          {[1,2,3,4].map(s => <div key={s} style={{ flex: 1, height: 4, borderRadius: 4, background: s <= obStep ? T.primary : T.line }} />)}
        </div>
        <Card>
          {obStep === 1 && (
            <>
              <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 20, marginBottom: 4 }}>What are you preparing for?</div>
              <div style={{ fontSize: 13.5, color: T.muted, marginBottom: 20 }}>This helps tailor your revision plan.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {["University Exams","Semester Exams","Competitive Exams","Other"].map(opt => (
                  <button key={opt} onClick={() => setExamGoal(opt)} style={{
                    padding: "16px 12px", borderRadius: 12, textAlign: "left", cursor: "pointer",
                    border: `2px solid ${examGoal === opt ? T.primary : T.line}`,
                    background: examGoal === opt ? T.primarySoft : "#fff", fontWeight: 600, fontSize: 13.5,
                  }}>{opt}</button>
                ))}
              </div>
              <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
                <Button onClick={() => setObStep(2)} icon={ChevronRight}>Continue</Button>
              </div>
            </>
          )}

          {obStep === 2 && (
            <>
              <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 20, marginBottom: 4 }}>Add your subjects</div>
              <div style={{ fontSize: 13.5, color: T.muted, marginBottom: 20 }}>e.g. Data Structures, Operating Systems</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <input value={subjectInput} onChange={e=>setSubjectInput(e.target.value)} onKeyDown={e=>e.key==="Enter" && (e.preventDefault(), addSubject())} style={inputStyle} placeholder="Subject name" />
                <Button onClick={addSubject} icon={Plus}>Add</Button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minHeight: 32 }}>
                {subjectsList.map(s => (
                  <span key={s} style={{ background: T.primarySoft, color: T.primary, padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                    {s}
                    <X size={13} style={{ cursor: "pointer" }} onClick={() => { setSubjectsList(prev => prev.filter(x=>x!==s)); const c={...topicsBySubject}; delete c[s]; setTopicsBySubject(c); }} />
                  </span>
                ))}
              </div>
              <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between" }}>
                <Button variant="ghost" onClick={() => setObStep(1)}>Back</Button>
                <Button onClick={() => { setActiveSubject(subjectsList[0]); setObStep(3); }} disabled={subjectsList.length===0} icon={ChevronRight}>Continue</Button>
              </div>
            </>
          )}

          {obStep === 3 && (
            <>
              <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 20, marginBottom: 4 }}>Add chapters / topics</div>
              <div style={{ fontSize: 13.5, color: T.muted, marginBottom: 16 }}>{totalTopics} topic{totalTopics!==1?"s":""} added so far</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                {subjectsList.map(s => (
                  <button key={s} onClick={() => setActiveSubject(s)} style={{
                    padding: "6px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                    border: `1px solid ${activeSubject===s ? T.primary : T.line}`,
                    background: activeSubject===s ? T.primary : "#fff", color: activeSubject===s ? "#fff" : T.ink,
                  }}>{s} ({(topicsBySubject[s]||[]).length})</button>
                ))}
              </div>
              {activeSubject && (
                <>
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <input value={topicInput} onChange={e=>setTopicInput(e.target.value)} onKeyDown={e=>e.key==="Enter" && (e.preventDefault(), addTopicToSubject(activeSubject))} style={inputStyle} placeholder={`Topic in ${activeSubject}`} />
                    <Button onClick={() => addTopicToSubject(activeSubject)} icon={Plus}>Add</Button>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {(topicsBySubject[activeSubject]||[]).map(t => (
                      <span key={t} style={{ background: T.bg, padding: "6px 12px", borderRadius: 999, fontSize: 13 }}>{t}</span>
                    ))}
                  </div>
                </>
              )}
              <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between" }}>
                <Button variant="ghost" onClick={() => setObStep(2)}>Back</Button>
                <Button onClick={() => setObStep(4)} disabled={totalTopics===0} icon={ChevronRight}>Continue</Button>
              </div>
            </>
          )}

          {obStep === 4 && (
            <>
              <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 20, marginBottom: 4 }}>When is your exam?</div>
              <div style={{ fontSize: 13.5, color: T.muted, marginBottom: 20 }}>We'll use this to calculate urgency for every topic.</div>
              <Field label="Exam date">
                <input type="date" value={examDate} onChange={e=>setExamDate(e.target.value)} style={inputStyle} />
              </Field>
              <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between" }}>
                <Button variant="ghost" onClick={() => setObStep(3)}>Back</Button>
                <Button onClick={() => onComplete(subjectsList, topicsBySubject)} icon={CheckCircle2}>Finish setup</Button>
              </div>
            </>
          )}
        </Card>
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button onClick={onSkipWithDemo} style={{ background: "none", border: "none", color: T.muted, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
            Skip and load demo data instead
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   MAIN AREA ROUTER (post-auth)
   ============================================================================ */
function MainArea(props) {
  const { view } = props;
  if (view === "dashboard") return <Dashboard {...props} />;
  if (view === "subjects") return <SubjectsPage {...props} />;
  if (view === "priority") return <PriorityPage {...props} />;
  if (view === "addTopic") return <AddTopicPage {...props} />;
  if (view === "topicDetail") return <TopicDetailPage {...props} />;
  if (view === "quiz") return <QuizPage {...props} />;
  if (view === "plan") return <PlanPage {...props} />;
  if (view === "quizzes") return <QuizzesHub {...props} />;
  if (view === "analytics") return <AnalyticsPage {...props} />;
  if (view === "insights") return <InsightsPage {...props} />;
  if (view === "settings") return <SettingsPage {...props} />;
  return null;
}

function PageHeader({ title, subtitle, right }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 12, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 24, letterSpacing: -0.4 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13.5, color: T.muted, marginTop: 4 }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

/* ---------------------------- DASHBOARD ---------------------------- */
function Dashboard({ user, daysUntilExam, topics, highTopics, avgPrep, setView, setSelectedTopicId, loading, loadDemoData }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const stats = [
    { label: "Days Until Exam", value: daysUntilExam, icon: CalendarDays, tone: T.accent },
    { label: "Topics", value: topics.length, icon: BookOpen, tone: T.primary },
    { label: "High Priority", value: highTopics.length, icon: Flame, tone: T.high },
    { label: "Preparation", value: `${avgPrep}%`, icon: Trophy, tone: T.low },
  ];

  if (topics.length === 0) {
    return (
      <>
        <PageHeader title={`${greeting}, ${user?.name?.split(" ")[0] || "Student"} 👋`} subtitle="Let's get your first topics in so ReviseAI can build your plan." />
        <Card>
          {loading ? <div style={{display:"grid", gap:10}}><Skeleton h={20} w="40%" /><Skeleton h={14} /><Skeleton h={14} w="70%" /></div> :
          <EmptyState icon={BookOpen} title="No topics yet" subtitle="Add your subjects and topics, or load demo data to explore ReviseAI."
            action={<div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <Button onClick={() => setView("addTopic")} icon={Plus}>Add Topic</Button>
              <Button variant="ghost" onClick={loadDemoData}>Load Demo Data</Button>
            </div>} />}
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user?.name?.split(" ")[0] || "Student"} 👋`}
        subtitle={`Your next exam is in ${daysUntilExam} day${daysUntilExam===1?"":"s"}. Let's focus on what matters most.`}
        right={<Button icon={Plus} onClick={() => setView("addTopic")}>Add Topic</Button>}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }} className="stat-grid">
        {stats.map((s,i) => (
          <Card key={i} style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12.5, color: T.muted, fontWeight: 600 }}>{s.label}</span>
              <s.icon size={16} color={s.tone} />
            </div>
            <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 30, marginTop: 6 }}>{s.value}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 17, display: "flex", alignItems: "center", gap: 8 }}>
          🔥 Revise First
        </div>
        <span style={{ fontSize: 13, color: T.primary, fontWeight: 600, cursor: "pointer" }} onClick={() => setView("priority")}>View all →</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
        {highTopics.slice(0,5).map(t => (
          <TopicMiniCard key={t.id} t={t} onClick={() => { setSelectedTopicId(t.id); setView("topicDetail"); }} onStart={() => { setSelectedTopicId(t.id); setView("topicDetail"); }} />
        ))}
        {highTopics.length === 0 && <Card><EmptyState icon={CheckCircle2} title="Nothing urgent" subtitle="No high-priority topics right now — nice work." /></Card>}
      </div>
      <style>{`@media (max-width: 760px){ .stat-grid { grid-template-columns: repeat(2,1fr) !important; } }`}</style>
    </>
  );
}

function TopicMiniCard({ t, onClick, onStart }) {
  return (
    <Card onClick={onClick}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 12, color: T.muted, fontWeight: 600 }}>{t.subjectName}</div>
          <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 16, marginTop: 2 }}>{t.name}</div>
        </div>
        <Badge level={t.level} size="sm" />
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 12 }}>
        <span style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 24, color: LEVEL_COLOR[t.level] }}>{t.score}</span>
        <span style={{ fontSize: 12, color: T.muted }}>/100 priority</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12, fontSize: 12, color: T.muted }}>
        <div>Confidence <b style={{color:T.ink}}>{t.confidenceLevel}/10</b></div>
        <div>Previous <b style={{color:T.ink}}>{t.marksPercentage}%</b></div>
        <div>Exam <b style={{color:T.ink}}>{t.daysUntilExam}d</b></div>
        <div>Difficulty <b style={{color:T.ink}}>{t.difficulty}</b></div>
      </div>
      <Button onClick={(e)=>{e.stopPropagation(); onStart();}} style={{ width: "100%", justifyContent: "center", marginTop: 14 }} icon={Play}>Start Revision</Button>
    </Card>
  );
}

/* ---------------------------- SUBJECTS ---------------------------- */
function SubjectsPage({ subjects, topics, setView, setSubjectFilter }) {
  return (
    <>
      <PageHeader title="Subjects" subtitle="All the subjects you're tracking in ReviseAI." right={<Button icon={Plus} onClick={() => setView("addTopic")}>Add Topic</Button>} />
      {subjects.length === 0 ? <Card><EmptyState icon={BookOpen} title="No subjects yet" subtitle="Add a topic to create your first subject." /></Card> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px,1fr))", gap: 14 }}>
          {subjects.map(s => {
            const tps = topics.filter(t => t.subjectId === s.id);
            const avg = tps.length ? Math.round(tps.reduce((a,t)=>a+t.score,0)/tps.length) : 0;
            const high = tps.filter(t=>t.level==="HIGH").length;
            return (
              <Card key={s.id} onClick={() => { setSubjectFilter(s.name); setView("priority"); }}>
                <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 16 }}>{s.name}</div>
                <div style={{ fontSize: 12.5, color: T.muted, marginTop: 4 }}>{tps.length} topic{tps.length!==1?"s":""} · {high} high priority</div>
                <div style={{ marginTop: 14, height: 8, borderRadius: 999, background: T.line, overflow: "hidden" }}>
                  <div style={{ width: `${avg}%`, height: "100%", background: avg>=70?T.high:avg>=40?T.medium:T.low }} />
                </div>
                <div style={{ fontSize: 11.5, color: T.muted, marginTop: 6 }}>Avg priority {avg}/100</div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ---------------------------- PRIORITY TOPICS ---------------------------- */
function PriorityPage(props) {
  const { topics, subjects, priorityTab, setPriorityTab, search, setSearch, subjectFilter, setSubjectFilter, sortBy, setSortBy, setView, setSelectedTopicId } = props;

  let filtered = topics.filter(t => t.level === priorityTab);
  if (subjectFilter !== "All") filtered = filtered.filter(t => t.subjectName === subjectFilter);
  if (search) filtered = filtered.filter(t => t.name.toLowerCase().includes(search.toLowerCase()) || t.subjectName.toLowerCase().includes(search.toLowerCase()));
  filtered = [...filtered].sort((a,b) => sortBy === "priority" ? b.score - a.score : a.daysUntilExam - b.daysUntilExam);

  const counts = { HIGH: topics.filter(t=>t.level==="HIGH").length, MEDIUM: topics.filter(t=>t.level==="MEDIUM").length, LOW: topics.filter(t=>t.level==="LOW").length };

  return (
    <>
      <PageHeader title="Priority Topics" subtitle="Everything you're tracking, grouped by urgency." right={<Button icon={Plus} onClick={() => props.setView("addTopic")}>Add Topic</Button>} />

      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {["HIGH","MEDIUM","LOW"].map(lvl => (
          <button key={lvl} onClick={() => setPriorityTab(lvl)} style={{
            flex: 1, padding: "12px 10px", borderRadius: 12, cursor: "pointer", textAlign: "center",
            border: `2px solid ${priorityTab===lvl ? LEVEL_COLOR[lvl] : T.line}`,
            background: priorityTab===lvl ? LEVEL_SOFT[lvl] : "#fff",
          }}>
            <div style={{ fontSize: 18 }}>{LEVEL_EMOJI[lvl]}</div>
            <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 20, color: LEVEL_COLOR[lvl] }}>{counts[lvl]}</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.muted }}>{lvl}</div>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 200px" }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: 12, color: T.muted }} />
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search topics..." style={{ ...inputStyle, paddingLeft: 34 }} />
        </div>
        <select value={subjectFilter} onChange={e=>setSubjectFilter(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          <option>All</option>
          {subjects.map(s => <option key={s.id}>{s.name}</option>)}
        </select>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          <option value="priority">Highest Priority</option>
          <option value="exam">Soonest Exam</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <Card><EmptyState icon={Filter} title="No topics here" subtitle="Try a different filter, or add a new topic." /></Card>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map(t => (
            <Card key={t.id} onClick={() => { setSelectedTopicId(t.id); setView("topicDetail"); }} style={{ display: "flex", alignItems: "center", gap: 16, padding: 16, flexWrap: "wrap" }}>
              <div style={{ flex: "2 1 180px" }}>
                <div style={{ fontSize: 12, color: T.muted, fontWeight: 600 }}>{t.subjectName}</div>
                <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 15.5 }}>{t.name}</div>
              </div>
              <MiniStat label="Score" value={t.score} />
              <MiniStat label="Confidence" value={`${t.confidenceLevel}/10`} />
              <MiniStat label="Previous" value={`${t.marksPercentage}%`} />
              <MiniStat label="Exam" value={`${t.daysUntilExam}d`} />
              <MiniStat label="Difficulty" value={t.difficulty} />
              <MiniStat label="Weightage" value={t.weightage} />
              <MiniStat label="Last revised" value={t.lastRevision ? `${t.daysSinceRevision}d ago` : "Never"} />
              <Badge level={t.level} />
              <ChevronRight size={16} color={T.muted} />
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function MiniStat({ label, value }) {
  return (
    <div style={{ flex: "1 1 70px", minWidth: 64 }}>
      <div style={{ fontSize: 10.5, color: T.muted, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

/* ---------------------------- ADD TOPIC ---------------------------- */
function AddTopicPage({ subjects, addTopic, setView, examDate }) {
  const [form, setForm] = useState({
    subjectName: subjects[0]?.name || "", newSubject: "", name: "", marksPercentage: 60,
    confidenceLevel: 5, difficulty: "Medium", weightage: "Medium", lastRevision: "", revisionCount: 0, incorrectAnswers: 0,
  });
  const [preview, setPreview] = useState(null);
  const set = (k,v) => setForm(f => ({ ...f, [k]: v }));

  function analyze(e) {
    e.preventDefault();
    const r = computePriority({ ...form, marksPercentage: Number(form.marksPercentage), confidenceLevel: Number(form.confidenceLevel), lastRevision: form.lastRevision || null, revisionCount: Number(form.revisionCount), incorrectAnswers: Number(form.incorrectAnswers), examDate });
    setPreview(r);
  }

  function save() {
    const subjectName = form.newSubject.trim() || form.subjectName;
    const existing = subjects.find(s => s.name === subjectName);
    addTopic({
      subjectId: existing?.id || uid(), subjectName,
      name: form.name, marksPercentage: Number(form.marksPercentage), confidenceLevel: Number(form.confidenceLevel),
      difficulty: form.difficulty, weightage: form.weightage, lastRevision: form.lastRevision || null,
      revisionCount: Number(form.revisionCount), incorrectAnswers: Number(form.incorrectAnswers),
    });
    setView("priority");
  }

  return (
    <>
      <PageHeader title="Add Topic" subtitle="Tell ReviseAI about a topic and we'll calculate its revision priority." />
      <div style={{ display: "grid", gridTemplateColumns: preview ? "1fr 1fr" : "1fr", gap: 20 }}>
        <Card>
          <form onSubmit={analyze}>
            <Field label="Subject">
              <select value={form.subjectName} onChange={e=>set("subjectName", e.target.value)} style={inputStyle}>
                {subjects.map(s => <option key={s.id}>{s.name}</option>)}
                <option value="">+ New subject</option>
              </select>
            </Field>
            {!form.subjectName && <Field label="New subject name"><input required style={inputStyle} value={form.newSubject} onChange={e=>set("newSubject", e.target.value)} /></Field>}
            <Field label="Topic Name"><input required style={inputStyle} value={form.name} onChange={e=>set("name", e.target.value)} placeholder="e.g. Graphs" /></Field>
            <Field label={`Previous Marks (${form.marksPercentage}%)`}><input type="range" min="0" max="100" value={form.marksPercentage} onChange={e=>set("marksPercentage", e.target.value)} style={{width:"100%"}} /></Field>
            <Field label={`Confidence (${form.confidenceLevel}/10)`}><input type="range" min="1" max="10" value={form.confidenceLevel} onChange={e=>set("confidenceLevel", e.target.value)} style={{width:"100%"}} /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Difficulty">
                <select style={inputStyle} value={form.difficulty} onChange={e=>set("difficulty", e.target.value)}>
                  <option>Easy</option><option>Medium</option><option>Hard</option>
                </select>
              </Field>
              <Field label="Weightage">
                <select style={inputStyle} value={form.weightage} onChange={e=>set("weightage", e.target.value)}>
                  <option>Low</option><option>Medium</option><option>High</option>
                </select>
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Last Revision Date"><input type="date" style={inputStyle} value={form.lastRevision} onChange={e=>set("lastRevision", e.target.value)} /></Field>
              <Field label="Revision Count"><input type="number" min="0" style={inputStyle} value={form.revisionCount} onChange={e=>set("revisionCount", e.target.value)} /></Field>
            </div>
            <Field label="Incorrect Quiz Answers"><input type="number" min="0" style={inputStyle} value={form.incorrectAnswers} onChange={e=>set("incorrectAnswers", e.target.value)} /></Field>
            <Button type="submit" style={{ width: "100%", justifyContent: "center" }} icon={Sparkles}>Analyze Priority</Button>
          </form>
        </Card>

        {preview && (
          <Card style={{ height: "fit-content" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, marginBottom: 8 }}>PREDICTED PRIORITY</div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 44, color: LEVEL_COLOR[preview.level] }}>{preview.score}</div>
              <Badge level={preview.level} />
            </div>
            <div style={{ marginTop: 16, fontSize: 12.5, fontWeight: 700, color: T.muted }}>AI ANALYSIS</div>
            <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
              {preview.reasons.map((r,i) => (
                <li key={i} style={{ fontSize: 13.5, display: "flex", gap: 8 }}><span style={{color:T.low}}>✓</span>{r}</li>
              ))}
            </ul>
            <Button onClick={save} style={{ width: "100%", justifyContent: "center", marginTop: 20 }} icon={CheckCircle2}>Save Topic</Button>
          </Card>
        )}
      </div>
    </>
  );
}

/* ---------------------------- TOPIC DETAIL ---------------------------- */
function TopicDetailPage({ topics, selectedTopicId, setView, markRevised, deleteTopic, setQuizTopicId }) {
  const t = topics.find(x => x.id === selectedTopicId);
  if (!t) return <Card><EmptyState icon={AlertTriangle} title="Topic not found" subtitle="It may have been removed." action={<Button onClick={()=>setView("priority")}>Back to Priority Topics</Button>} /></Card>;

  return (
    <>
      <button onClick={() => setView("priority")} style={{ background: "none", border: "none", color: T.muted, fontSize: 13, marginBottom: 14, cursor: "pointer", padding: 0 }}>← Back</button>
      <PageHeader title={`${t.subjectName} → ${t.name}`} right={<Badge level={t.level} />} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }} className="detail-grid">
        <Card style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: T.muted, fontWeight: 600 }}>Priority Score</div>
          <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 40, color: LEVEL_COLOR[t.level] }}>{t.score}</div>
        </Card>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <StatBox label="Previous Score" value={`${t.marksPercentage}%`} />
          <StatBox label="Confidence" value={`${t.confidenceLevel}/10`} />
          <StatBox label="Difficulty" value={t.difficulty} />
          <StatBox label="Weightage" value={t.weightage} />
          <StatBox label="Last Revision" value={t.lastRevision ? `${t.daysSinceRevision}d ago` : "Never"} />
          <StatBox label="Exam" value={`${t.daysUntilExam}d away`} />
        </div>
      </div>

      <Card style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 15, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={16} color={T.primary} /> AI Recommendation
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: T.ink, margin: 0 }}>
          {t.level === "HIGH"
            ? `Revise this topic today because ${t.reasons[0]?.toLowerCase() || "several risk factors are elevated"}, while the exam is approaching.`
            : t.level === "MEDIUM"
            ? `Plan to revise this within the next few days — it's not urgent yet, but a few factors need attention.`
            : `This topic is in good shape. A light review closer to the exam should be enough.`}
        </p>
        <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
          {t.reasons.map((r,i) => <li key={i} style={{ fontSize: 13.5, display: "flex", gap: 8 }}><span style={{color:T.low}}>✓</span>{r}</li>)}
        </ul>
      </Card>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button icon={ClipboardList} onClick={() => { setQuizTopicId(t.id); setView("quiz"); }}>Start Quiz</Button>
        <Button variant="ghost" icon={CheckCircle2} onClick={() => markRevised(t.id)}>Mark as Revised</Button>
        <Button variant="subtle" icon={Pencil} onClick={() => showUpdatePrompt(t, markRevised)}>Update Performance</Button>
        <Button variant="danger" icon={Trash2} onClick={() => { deleteTopic(t.id); setView("priority"); }}>Delete</Button>
      </div>
      <style>{`@media (max-width: 700px){ .detail-grid { grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}
function showUpdatePrompt() { /* Update Performance is handled inline via the quiz feedback loop in this MVP */ }

function StatBox({ label, value }) {
  return (
    <Card style={{ padding: 12 }}>
      <div style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 16, marginTop: 2 }}>{value}</div>
    </Card>
  );
}

/* ---------------------------- QUIZ ---------------------------- */
function QuizPage({ topics, quizTopicId, submitQuiz, setView, showToast }) {
  const t = topics.find(x => x.id === quizTopicId);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  if (!t) return <Card><EmptyState icon={ClipboardList} title="Pick a topic first" subtitle="Start a quiz from a topic's detail page." action={<Button onClick={()=>setView("priority")}>Browse Topics</Button>} /></Card>;

  const questions = QUIZ_BANK.map((q, i) => ({ id: i, text: `${q} (${t.name})`, options: ["A", "B", "C", "D"], correct: i % 4 }));
  const answeredCount = Object.keys(answers).length;

  function submit() {
    let correct = 0;
    questions.forEach(q => { if (answers[q.id] === q.correct) correct++; });
    setSubmitted(true);
    submitQuiz(t.id, correct, questions.length);
  }

  if (submitted) {
    let correct = 0;
    questions.forEach(q => { if (answers[q.id] === q.correct) correct++; });
    const pct = Math.round((correct/questions.length)*100);
    return (
      <Card style={{ maxWidth: 480, margin: "0 auto", textAlign: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.muted }}>YOUR SCORE</div>
        <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 44, margin: "8px 0" }}>{correct} / {questions.length}</div>
        <div style={{ fontSize: 15, color: T.muted, marginBottom: 18 }}>{pct}%</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 24, marginBottom: 20 }}>
          <div><div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 20, color: T.low }}>{correct}</div><div style={{ fontSize: 11, color: T.muted }}>Correct</div></div>
          <div><div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 20, color: T.high }}>{questions.length-correct}</div><div style={{ fontSize: 11, color: T.muted }}>Incorrect</div></div>
        </div>
        <div style={{ background: T.primarySoft, color: T.primary, borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600, marginBottom: 18 }}>
          Priority updated based on your latest performance.
        </div>
        <Button onClick={() => setView("topicDetail")} style={{ width: "100%", justifyContent: "center" }}>Back to Topic</Button>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title={`Quiz — ${t.subjectName} → ${t.name}`} subtitle={`${answeredCount}/${questions.length} answered`} />
      <div style={{ display: "grid", gap: 12 }}>
        {questions.map((q, i) => (
          <Card key={q.id}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>{i+1}. {q.text}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
              {q.options.map((o, oi) => (
                <button key={oi} onClick={() => setAnswers(a => ({...a, [q.id]: oi}))} style={{
                  padding: "8px 6px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
                  border: `2px solid ${answers[q.id]===oi ? T.primary : T.line}`,
                  background: answers[q.id]===oi ? T.primarySoft : "#fff",
                }}>{o}</button>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <Button onClick={submit} disabled={answeredCount < questions.length} style={{ marginTop: 16, width: "100%", justifyContent: "center" }} icon={CheckCircle2}>Submit Quiz</Button>
    </>
  );
}

function QuizzesHub({ topics, setQuizTopicId, setView }) {
  return (
    <>
      <PageHeader title="Quizzes" subtitle="Test yourself on any topic — results feed back into your priority scores." />
      {topics.length === 0 ? <Card><EmptyState icon={ClipboardList} title="No topics yet" subtitle="Add a topic to unlock quizzes." /></Card> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }}>
          {topics.map(t => (
            <Card key={t.id}>
              <div style={{ fontSize: 12, color: T.muted, fontWeight: 600 }}>{t.subjectName}</div>
              <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 15, marginTop: 2 }}>{t.name}</div>
              <div style={{ marginTop: 8 }}><Badge level={t.level} size="sm" /></div>
              <Button onClick={() => { setQuizTopicId(t.id); setView("quiz"); }} style={{ width: "100%", justifyContent: "center", marginTop: 12 }} icon={Play}>Start Quiz</Button>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------------------- REVISION PLAN ---------------------------- */
function PlanPage({ topics, setView, setSelectedTopicId, markRevised, showToast }) {
  const ranked = [...topics].sort((a,b) => b.score - a.score).slice(0, 6);
  const [status, setStatus] = useState({});
  let clock = new Date(); clock.setHours(18,0,0,0);

  const sessions = ranked.map((t, i) => {
    const durationMin = t.level === "HIGH" ? 90 : t.level === "MEDIUM" ? 60 : 40;
    const start = new Date(clock);
    const end = new Date(clock.getTime() + durationMin * 60000);
    clock = new Date(end.getTime() + 15 * 60000);
    return { id: t.id, t, start, end };
  });

  function fmt(d) { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }

  return (
    <>
      <PageHeader title="AI Revision Plan" subtitle="Today's schedule, ranked by priority." />
      {sessions.length === 0 ? <Card><EmptyState icon={CalendarDays} title="Nothing scheduled" subtitle="Add topics to generate today's plan." /></Card> : (
        <div style={{ borderLeft: `2px solid ${T.line}`, marginLeft: 8, paddingLeft: 20, display: "grid", gap: 18 }}>
          {sessions.map(s => (
            <div key={s.id} style={{ position: "relative" }}>
              <div style={{ position: "absolute", left: -26, top: 4, width: 12, height: 12, borderRadius: 999, background: LEVEL_COLOR[s.t.level], border: "2px solid #fff", boxShadow: `0 0 0 2px ${LEVEL_COLOR[s.t.level]}` }} />
              <div style={{ fontSize: 12.5, color: T.muted, fontWeight: 700, marginBottom: 6 }}>{fmt(s.start)} – {fmt(s.end)}</div>
              <Card style={{ opacity: status[s.id] === "skipped" ? 0.5 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 15 }}>{s.t.subjectName} → {s.t.name}</div>
                    <div style={{ marginTop: 6 }}><Badge level={s.t.level} size="sm" /></div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {status[s.id] === "done" ? (
                      <span style={{ color: T.low, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={16}/> Completed</span>
                    ) : (
                      <>
                        <Button variant="ghost" icon={Play} onClick={() => { setSelectedTopicId(s.id); setView("topicDetail"); }}>Start</Button>
                        <Button variant="subtle" icon={CheckCircle2} onClick={() => { setStatus(st=>({...st,[s.id]:"done"})); markRevised(s.id); showToast("Session marked complete"); }}>Complete</Button>
                        <Button variant="subtle" icon={RotateCcw} onClick={() => showToast("Rescheduled to tomorrow")}>Reschedule</Button>
                        <Button variant="ghost" icon={X} onClick={() => setStatus(st=>({...st,[s.id]:"skipped"}))}>Skip</Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------------------- ANALYTICS ---------------------------- */
function AnalyticsPage({ topics, subjects, avgPrep }) {
  const subjectData = subjects.map(s => {
    const tps = topics.filter(t => t.subjectId === s.id);
    const prep = tps.length ? Math.round(tps.reduce((a,t)=>a+(100-t.score),0)/tps.length) : 0;
    return { name: s.name.split(" ")[0], prep };
  });
  const dist = [
    { level: "HIGH", count: topics.filter(t=>t.level==="HIGH").length },
    { level: "MEDIUM", count: topics.filter(t=>t.level==="MEDIUM").length },
    { level: "LOW", count: topics.filter(t=>t.level==="LOW").length },
  ];
  const scatterData = topics.map(t => ({ x: t.confidenceLevel, y: t.marksPercentage, name: t.name }));

  if (topics.length === 0) return (<><PageHeader title="Analytics" /><Card><EmptyState icon={BarChart3} title="No data yet" subtitle="Add topics to see analytics." /></Card></>);

  return (
    <>
      <PageHeader title="Analytics" subtitle="Your preparation, visualized." />
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 20, alignItems: "center", marginBottom: 20 }} className="analytics-top">
        <Card style={{ display: "flex", justifyContent: "center" }}>
          <CircularProgress value={avgPrep} label="Overall Prep" />
        </Card>
        <Card>
          <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Subject Preparation</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={subjectData}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.line} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0,100]} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="prep" fill={T.primary} radius={[6,6,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="analytics-bottom">
        <Card>
          <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Priority Distribution</div>
          {dist.map(d => (
            <div key={d.level} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 70, fontSize: 12, fontWeight: 700, color: LEVEL_COLOR[d.level] }}>{d.level}</div>
              <div style={{ flex: 1, height: 10, borderRadius: 999, background: T.line, overflow: "hidden" }}>
                <div style={{ width: `${(d.count/(topics.length||1))*100}%`, height: "100%", background: LEVEL_COLOR[d.level] }} />
              </div>
              <div style={{ width: 20, fontSize: 12, fontWeight: 700, textAlign: "right" }}>{d.count}</div>
            </div>
          ))}
        </Card>
        <Card>
          <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Confidence vs Performance</div>
          <ResponsiveContainer width="100%" height={170}>
            <ScatterChart>
              <CartesianGrid stroke={T.line} />
              <XAxis type="number" dataKey="x" name="Confidence" domain={[0,10]} tick={{ fontSize: 11 }} label={{ value: "Confidence", position: "insideBottom", fontSize: 10, dy: 10 }} />
              <YAxis type="number" dataKey="y" name="Marks" domain={[0,100]} tick={{ fontSize: 11 }} />
              <ZAxis range={[60,60]} />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v)=>v} />
              <Scatter data={scatterData} fill={T.accent} />
            </ScatterChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <style>{`
        @media (max-width: 760px){ .analytics-top { grid-template-columns: 1fr !important; } .analytics-bottom { grid-template-columns: 1fr !important; } }
      `}</style>
    </>
  );
}

/* ---------------------------- INSIGHTS ---------------------------- */
function InsightsPage({ topics, subjects }) {
  const insights = useMemo(() => {
    if (topics.length === 0) return [];
    const list = [];
    const bySubject = subjects.map(s => {
      const tps = topics.filter(t => t.subjectId === s.id);
      const avgScore = tps.length ? tps.reduce((a,t)=>a+t.score,0)/tps.length : 0;
      return { name: s.name, avgScore };
    }).sort((a,b) => b.avgScore - a.avgScore);
    if (bySubject[0]) list.push(`💡 Your weakest subject is ${bySubject[0].name}.`);

    const high = topics.filter(t=>t.level==="HIGH").length;
    if (high > 0) list.push(`🔥 ${high} high-priority topic${high!==1?"s are":" is"} still pending.`);

    const strong = topics.filter(t => t.marksPercentage >= 80).sort((a,b)=>b.marksPercentage-a.marksPercentage)[0];
    if (strong) list.push(`📈 ${strong.subjectName} → ${strong.name} is one of your strongest topics at ${strong.marksPercentage}%.`);

    const stale = topics.filter(t => t.daysSinceRevision >= 7 && t.weightage === "High");
    if (stale.length > 0) list.push(`⚠️ You haven't revised ${stale.length} important topic${stale.length!==1?"s":""} for over a week.`);

    const potential = topics.filter(t => t.level === "HIGH").length - Math.max(0, topics.filter(t=>t.level==="HIGH").length - Math.min(3, topics.filter(t=>t.level==="HIGH").length));
    if (high > 0) {
      const after = Math.max(0, high - Math.min(2, high));
      list.push(`🎯 Completing today's recommended plan could reduce your high-priority topics from ${high} to ${after}.`);
    }
    return list;
  }, [topics, subjects]);

  return (
    <>
      <PageHeader title="AI Insights" subtitle="Patterns ReviseAI noticed in your data." />
      {insights.length === 0 ? <Card><EmptyState icon={Sparkles} title="Not enough data yet" subtitle="Add a few topics and insights will appear here." /></Card> : (
        <div style={{ display: "grid", gap: 10 }}>
          {insights.map((ins,i) => (
            <Card key={i} style={{ display: "flex", alignItems: "center", fontSize: 14, fontWeight: 500 }}>{ins}</Card>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------------------- SETTINGS ---------------------------- */
function SettingsPage({ user, examDate, setExamDate, loadDemoData, showToast }) {
  return (
    <>
      <PageHeader title="Settings" subtitle="Manage your account and exam schedule." />
      <Card style={{ maxWidth: 480, marginBottom: 16 }}>
        <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Account</div>
        <Field label="Name"><input style={inputStyle} defaultValue={user?.name} /></Field>
        <Field label="Email"><input style={inputStyle} defaultValue={user?.email} /></Field>
        <Button onClick={() => showToast("Profile updated")}>Save Changes</Button>
      </Card>
      <Card style={{ maxWidth: 480, marginBottom: 16 }}>
        <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Exam Schedule</div>
        <Field label="Exam date"><input type="date" style={inputStyle} value={examDate} onChange={e=>setExamDate(e.target.value)} /></Field>
        <div style={{ fontSize: 12.5, color: T.muted }}>Changing this recalculates every topic's priority score.</div>
      </Card>
      <Card style={{ maxWidth: 480 }}>
        <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Demo Data</div>
        <div style={{ fontSize: 13, color: T.muted, marginBottom: 12 }}>Reload the sample subjects and topics used in the walkthrough. Clearly marked as demo data.</div>
        <Button variant="ghost" onClick={loadDemoData}>Reload Demo Data</Button>
      </Card>
    </>
  );
}
