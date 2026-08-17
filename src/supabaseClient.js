import { createClient } from "@supabase/supabase-js";

// Reads from environment variables (set these in a .env file locally,
// and in your hosting provider's dashboard for production).
// See .env.example for the exact variable names.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// If no keys are configured, the app still works — it just runs the
// in-memory demo mode already built into App.jsx instead of hitting Supabase.
export const supabaseEnabled = Boolean(url && anonKey);

export const supabase = supabaseEnabled ? createClient(url, anonKey) : null;
