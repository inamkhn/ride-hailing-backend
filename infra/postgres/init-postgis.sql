-- Enable PostGIS on first container start (docker-entrypoint-initdb.d).
-- The monolith's durable history/ledger tables live on plain Postgres types today
-- (database-schema.md §2 location_history note); PostGIS is enabled up front so the
-- geography migration is a no-op on the infra side when spatial queries become real.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
