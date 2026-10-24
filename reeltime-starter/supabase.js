// ReelTime's public Supabase client configuration.
// Publishable keys are intended for frontend use. Never put a service_role/secret key here.
const SUPABASE_URL = "https://dtqsxpzbzkagikxyqyty.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_9B-nMCklSCOd2xmbio3VEw_uFkquKKr";

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  console.error("Supabase JS library did not load. Check your internet connection and refresh.");
} else {
  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );
  console.log("ReelTime Supabase client initialized!");
}
