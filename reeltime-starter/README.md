# ReelTime starter + Supabase authentication

## Run on Windows
1. Extract this ZIP.
2. Open the `reeltime-starter` folder in VS Code.
3. In VS Code, choose Terminal → New Terminal.
4. Run `python -m http.server 5500`.
5. Open http://localhost:5500 in Chrome. Keep the terminal open.

## Included
- Original responsive ReelTime sample feed and existing demo interactions.
- Popup Log in / Create account modal using Supabase email/password Auth.
- Session restore, log out, and basic profile row creation.
- The profile table SQL is in the previous setup instructions.

## Supabase setup
`supabase.js` contains the project URL and frontend publishable key. Publishable keys are intended for browser use, but never put a `service_role` or secret key in frontend files. Make sure Row Level Security is enabled on tables.

The profiles table should have `id uuid primary key references auth.users(id) on delete cascade`, `full_name text`, `username text`, `avatar_url text`, and the policies created in the setup steps.

## Email confirmation
If Supabase email confirmation is enabled, a new account may need to click the verification link before logging in. For local testing, configure the Auth email settings and redirect URLs in Supabase as needed.

## Important limitations
The sample Reels, likes, comments, follows, and video previews are still demo-only. This update adds real authentication, not online video uploads or shared social actions yet.
