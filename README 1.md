# TraceLab — Free Internet Launch

TraceLab is an interactive code playground with step-by-step flow visualization. This launch build supports 16 languages: HTML, CSS, Python 3, JavaScript, TypeScript, C, C++, Java, Go, Kotlin, Swift, Ruby, PHP, Perl, Bash, and SQL/SQLite.

## Architecture

Browser → TraceLab Node Web Service → OneCompiler Code Execution API → compiler/interpreter → output

The OneCompiler API key is stored only on the server.

## Critical deployment rule
Use a **Render Web Service**, not a Static Site.

See `DEPLOY.md` for exact settings and `LAUNCH_CHECKLIST.md` before publishing.
