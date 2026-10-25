# TraceLab

TraceLab is an interactive code playground with source-driven walkthroughs across 16 languages and live execution in 15 runtimes. Python and JavaScript run in the browser; 11 hosted languages use the TraceLab Node backend and Wandbox public compiler API. Kotlin currently supports walkthroughs only because Wandbox does not list a Kotlin compiler.

## Input handling

For programs that call standard input functions, TraceLab detects common input reads and asks for values one at a time. It then combines the answers into stdin and submits the program to Wandbox. The public Wandbox API runs programs in batch mode, so answers must be collected before execution begins.

The editor includes a searchable language picker, lightweight language-aware completion, a Console and I/O side panel, and a Feedback tab that sends feedback to the service logs for developer review.

See `DEPLOY.md` for deployment settings and `LAUNCH_CHECKLIST.md` for a release check.
