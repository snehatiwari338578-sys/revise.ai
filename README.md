# ReviseAI — deployable Vite project (with real Supabase backend wiring)

## Run locally
```
npm install
npm run dev
```

## Connect your real Supabase backend
1. Create a project at supabase.com.
2. Open SQL Editor → paste and run `supabase_schema.sql` (creates tables + Row Level Security).
3. In Authentication → Providers, make sure Email is enabled (it is by default).
4. Go to Project Settings → API, copy your Project URL and anon public key.
5. Copy `.env.example` to `.env` and paste those two values in.
6. Restart `npm run dev` — the app will now use real signup/login and save
   every subject/topic/quiz result to your Supabase project instead of memory.

`src/supabaseClient.js` detects whether the env vars are set. If they aren't,
the app automatically falls back to in-memory demo mode — nothing breaks.

`src/db.js` is the entire data-access layer: auth (signUp/signIn/signOut),
profile loading, and CRUD for subjects/topics/quiz results, all mapped to the
exact schema in `supabase_schema.sql`. `src/App.jsx` calls these functions
wherever it used to just update local state — every add/edit/delete/quiz now
writes through to Supabase and, on refresh, `useEffect` restores your session
and reloads your data automatically.

## Deploy
Push to GitHub, import the repo on vercel.com, and add the same two
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` values under Project Settings →
Environment Variables so the deployed app can reach your database too.

## Optional: swap in the ML prediction service
`ml_service_fastapi.py` is a FastAPI service that matches the same 8-feature
priority contract used client-side. Run it separately and point a `fetch()`
call at `/predict` if you want scoring to happen server-side instead of in
the browser (useful once you train a real Random Forest model on usage data).
