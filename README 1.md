# TraceLab — Free Internet Launch

TraceLab is an interactive code playground with step-by-step flow visualization for 16 languages. Fifteen runtimes execute code live: HTML, CSS, Python 3, JavaScript, TypeScript, C, C++, Java, Go, Swift, Ruby, PHP, Perl, Bash, and SQL/SQLite. Kotlin has a source walkthrough, but Wandbox currently does not provide a Kotlin compiler.

## Architecture

Browser → TraceLab Node Web Service → Wandbox public API → compiler/interpreter → output

The backend uses Wandbox's public API and does not require an API key. Wandbox availability and throttling are controlled by Wandbox.

## Deployment

Use a **Render Web Service**, not a Static Site. See `DEPLOY.md` for the settings and `LAUNCH_CHECKLIST.md` before publishing.
