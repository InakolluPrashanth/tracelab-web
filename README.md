# TraceLab

TraceLab is an interactive code playground with source-driven execution flow visualization across 16 languages. Python and JavaScript run in the browser; hosted languages use the TraceLab Node backend and Wandbox public compiler API.

## Input handling

For programs that call standard input functions, TraceLab detects common input reads and asks for values one at a time. It then combines the answers into stdin and submits the program to Wandbox. The public Wandbox API runs programs in batch mode, so answers must be collected before execution begins.

See `DEPLOY.md` for deployment settings and `LAUNCH_CHECKLIST.md` for a release check.
