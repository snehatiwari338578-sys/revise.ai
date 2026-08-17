-- ============================================================================
-- ReviseAI — Supabase schema
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Requires Supabase Auth to already be enabled (it is, by default).
-- ============================================================================

-- Extensions
create extension if not exists "uuid-ossp";

-- ----------------------------------------------------------------------------
-- profiles  (1:1 with auth.users)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null,
  exam_goal text,               -- "University Exams" | "Semester Exams" | "Competitive Exams" | "Other"
  onboarded boolean not null default false,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ----------------------------------------------------------------------------
-- subjects
-- ----------------------------------------------------------------------------
create table if not exists public.subjects (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  exam_date date,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- topics
-- ----------------------------------------------------------------------------
create table if not exists public.topics (
  id uuid primary key default uuid_generate_v4(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  marks_percentage numeric(5,2) not null default 0 check (marks_percentage between 0 and 100),
  confidence_level int not null default 5 check (confidence_level between 1 and 10),
  difficulty text not null default 'Medium' check (difficulty in ('Easy','Medium','Hard')),
  weightage text not null default 'Medium' check (weightage in ('Low','Medium','High')),
  last_revision date,
  revision_count int not null default 0,
  incorrect_answers int not null default 0,
  priority_score int,                 -- 0-100, written by the prediction service
  priority_level text check (priority_level in ('HIGH','MEDIUM','LOW')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists topics_touch_updated_at on public.topics;
create trigger topics_touch_updated_at
  before update on public.topics
  for each row execute procedure public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- quiz_results
-- ----------------------------------------------------------------------------
create table if not exists public.quiz_results (
  id uuid primary key default uuid_generate_v4(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score int not null,
  total_questions int not null,
  incorrect_answers int not null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- revision_sessions
-- ----------------------------------------------------------------------------
create table if not exists public.revision_sessions (
  id uuid primary key default uuid_generate_v4(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scheduled_time timestamptz not null,
  duration int not null default 45,        -- minutes
  status text not null default 'scheduled' check (status in ('scheduled','completed','skipped','rescheduled')),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- ROW LEVEL SECURITY — users can only ever read/write their own rows
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.topics enable row level security;
alter table public.quiz_results enable row level security;
alter table public.revision_sessions enable row level security;

create policy "profiles: self select" on public.profiles for select using (auth.uid() = id);
create policy "profiles: self update" on public.profiles for update using (auth.uid() = id);

create policy "subjects: owner all" on public.subjects for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "topics: owner all" on public.topics for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "quiz_results: owner all" on public.quiz_results for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "revision_sessions: owner all" on public.revision_sessions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Helpful indexes
create index if not exists idx_subjects_user on public.subjects(user_id);
create index if not exists idx_topics_user on public.topics(user_id);
create index if not exists idx_topics_subject on public.topics(subject_id);
create index if not exists idx_quiz_results_topic on public.quiz_results(topic_id);
create index if not exists idx_revision_sessions_user on public.revision_sessions(user_id);
