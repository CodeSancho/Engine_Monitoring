# PostgreSQL / Supabase setup

The backend uses PostgreSQL directly, so it works with a local PostgreSQL
server or Supabase. The Supabase service-role key is not needed: use the
database connection URI on the backend only.

1. In Supabase, open **Project Settings → Database** and copy a connection URI.
   For a long-running Node server, use the session pooler URI if direct IPv6
   connections are unavailable. Keep the password private.
2. Set `DATABASE_URL` in the backend environment to that URI. For Supabase,
   retain `sslmode=require` in the connection URI.
3. Run `001_initial_schema.sql` in the Supabase SQL Editor, or run
   `psql "$DATABASE_URL" -f backend/db/001_initial_schema.sql` from the repo root.
4. Start the backend. It logs whether PostgreSQL persistence is enabled.

When `DATABASE_URL` is absent, the prototype continues with its in-memory
alert store and live simulator. With PostgreSQL configured, readings,
predictions, and alerts are written to the database and alert routes read from
it. Sensor history currently has no read API; add one when the dashboard needs
historical queries.

The schema enables Row Level Security without client policies. The current API
connects as a trusted server using the database URI, so do not expose that URI
to browser code.
