import { supabase, supabaseEnabled } from "./supabaseClient";

/* ============================================================================
   db.js — the real backend layer.
   Every function here mirrors the shape the UI already expects (see the
   mock layer in App.jsx). When Supabase isn't configured (no .env keys),
   supabaseEnabled is false and App.jsx quietly keeps using in-memory state
   instead — nothing breaks either way.
   ============================================================================ */

/* ---------- mappers: local camelCase <-> Supabase snake_case ---------- */
function topicToRow(t, userId) {
  return {
    subject_id: t.subjectId,
    user_id: userId,
    name: t.name,
    marks_percentage: t.marksPercentage,
    confidence_level: t.confidenceLevel,
    difficulty: t.difficulty,
    weightage: t.weightage,
    last_revision: t.lastRevision,
    revision_count: t.revisionCount,
    incorrect_answers: t.incorrectAnswers,
    priority_score: t.score ?? null,
    priority_level: t.level ?? null,
  };
}

function rowToTopic(row, subjectName) {
  return {
    id: row.id,
    subjectId: row.subject_id,
    subjectName: subjectName || "",
    name: row.name,
    marksPercentage: Number(row.marks_percentage),
    confidenceLevel: row.confidence_level,
    difficulty: row.difficulty,
    weightage: row.weightage,
    lastRevision: row.last_revision,
    revisionCount: row.revision_count,
    incorrectAnswers: row.incorrect_answers,
  };
}

function rowToQuizAttempt(row, topicNameById) {
  return {
    id: row.id,
    topicId: row.topic_id,
    topicName: topicNameById[row.topic_id] || "",
    date: (row.created_at || "").slice(0, 10),
    scorePercent: row.total_questions ? Math.round((row.score / row.total_questions) * 100) : 0,
  };
}

/* ---------- auth ---------- */
export async function signUp(name, email, password) {
  const { data, error } = await supabase.auth.signUp({
    email, password, options: { data: { name } },
  });
  if (error) throw error;
  return data.user;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (error) throw error;
  return data;
}

export async function markOnboarded(userId, examGoal) {
  const { error } = await supabase.from("profiles").update({ onboarded: true, exam_goal: examGoal }).eq("id", userId);
  if (error) throw error;
}

/* ---------- subjects + topics ---------- */
export async function fetchSubjectsAndTopics(userId) {
  const { data: subjects, error: subErr } = await supabase.from("subjects").select("*").eq("user_id", userId).order("created_at");
  if (subErr) throw subErr;
  const { data: topicRows, error: topErr } = await supabase.from("topics").select("*").eq("user_id", userId).order("created_at");
  if (topErr) throw topErr;

  const subjectById = Object.fromEntries((subjects || []).map(s => [s.id, s.name]));
  const topics = (topicRows || []).map(row => rowToTopic(row, subjectById[row.subject_id]));
  return { subjects: subjects || [], topics };
}

export async function createSubject(userId, name, examDate) {
  const { data, error } = await supabase.from("subjects").insert({ user_id: userId, name, exam_date: examDate }).select().single();
  if (error) throw error;
  return data;
}

export async function createTopic(userId, topic) {
  const { data, error } = await supabase.from("topics").insert(topicToRow(topic, userId)).select().single();
  if (error) throw error;
  return rowToTopic(data, topic.subjectName);
}

export async function updateTopicRow(id, patch, userId) {
  const dbPatch = {};
  if ("marksPercentage" in patch) dbPatch.marks_percentage = patch.marksPercentage;
  if ("confidenceLevel" in patch) dbPatch.confidence_level = patch.confidenceLevel;
  if ("difficulty" in patch) dbPatch.difficulty = patch.difficulty;
  if ("weightage" in patch) dbPatch.weightage = patch.weightage;
  if ("lastRevision" in patch) dbPatch.last_revision = patch.lastRevision;
  if ("revisionCount" in patch) dbPatch.revision_count = patch.revisionCount;
  if ("incorrectAnswers" in patch) dbPatch.incorrect_answers = patch.incorrectAnswers;
  if ("score" in patch) dbPatch.priority_score = patch.score;
  if ("level" in patch) dbPatch.priority_level = patch.level;
  const { error } = await supabase.from("topics").update(dbPatch).eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

export async function deleteTopicRow(id, userId) {
  const { error } = await supabase.from("topics").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

export async function recordQuizResult(userId, topicId, score, total, incorrect) {
  const { error } = await supabase.from("quiz_results").insert({
    user_id: userId, topic_id: topicId, score, total_questions: total, incorrect_answers: incorrect,
  });
  if (error) throw error;
}

export async function fetchQuizHistory(userId, topicNameById = {}) {
  const { data, error } = await supabase.from("quiz_results").select("*").eq("user_id", userId).order("created_at");
  if (error) throw error;
  return (data || []).map(row => rowToQuizAttempt(row, topicNameById));
}

export { supabaseEnabled };
