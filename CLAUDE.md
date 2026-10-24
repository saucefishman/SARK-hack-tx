# SARK-hack-tx

Hackathon project. Multiple people (and their Claude sessions) work in parallel. Read this before starting work.

## Avoiding redundancy

- `STRUCTURE.md` indexes reusable classes and functions. Check it first, then search the codebase. Reuse or extend what exists; don't create a parallel version.
- When you add, rename, move, or delete something reusable, update `STRUCTURE.md` in the same commit.
- Keep one of each shared thing: one API client, one place for shared types, one config loader, one styling approach.
- Shared interfaces (API routes, types, schemas, env vars) are contracts other people depend on. Coordinate with the team before changing them.
- Check whether an existing dependency already does the job before adding a new one.
- If you stub something someone else owns, mark it `TODO(stub): <owner>` so it's easy to find and replace.

## Collaboration

- Pull `main` often and merge small changes frequently; long-lived branches cause painful conflicts.
- Don't reformat or restructure files you aren't otherwise changing.
- Never commit secrets. Keep them in `.env` and list required vars in `.env.example`.
- Working demo beats perfect code, but `main` should always run.

## For Claude sessions

- Read `STRUCTURE.md` and grep for existing implementations before creating new files or modules.
- People work across the whole codebase, so expect concurrent edits. Pull before large changes and keep diffs focused.
- Keep `STRUCTURE.md` in sync with any reusable code you add or change.
