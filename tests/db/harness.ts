import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

// Fixed ids so tests read clearly.
export const ID = {
  superAdmin: "00000000-0000-0000-0000-0000000000a1",
  adminA: "00000000-0000-0000-0000-0000000000a2",
  empA1: "00000000-0000-0000-0000-0000000000a3",
  empA2: "00000000-0000-0000-0000-0000000000a4",
  adminB: "00000000-0000-0000-0000-0000000000b2",
  empB1: "00000000-0000-0000-0000-0000000000b3",
  orgA: "10000000-0000-0000-0000-00000000000a",
  orgB: "10000000-0000-0000-0000-00000000000b",
  proj1: "20000000-0000-0000-0000-000000000001", // assigned to A and B
  proj2: "20000000-0000-0000-0000-000000000002", // assigned to A only
  leadA1: "30000000-0000-0000-0000-0000000000a1", // org A, assigned empA1
  leadA2: "30000000-0000-0000-0000-0000000000a2", // org A, assigned empA2
  leadB1: "30000000-0000-0000-0000-0000000000b1", // org B, assigned empB1
};

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");

/** Fresh in-memory Postgres with Supabase-style auth stubs, the real migration, and seed data. */
export async function createDb() {
  const db = new PGlite();

  // Stand-ins for what Supabase provides: roles, auth schema, auth.uid().
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
  `);

  for (const file of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }

  // Seed as the table owner (bypasses RLS, like the service role).
  await db.exec(`
    insert into auth.users (id, email) values
      ('${ID.superAdmin}', 'super@leadpilot.test'),
      ('${ID.adminA}', 'admin@a.test'), ('${ID.empA1}', 'e1@a.test'), ('${ID.empA2}', 'e2@a.test'),
      ('${ID.adminB}', 'admin@b.test'), ('${ID.empB1}', 'e1@b.test');

    insert into organizations (id, name) values
      ('${ID.orgA}', 'Partner A'), ('${ID.orgB}', 'Partner B');

    insert into profiles (id, org_id, role, full_name, email) values
      ('${ID.superAdmin}', null, 'super_admin', 'Super', 'super@leadpilot.test'),
      ('${ID.adminA}', '${ID.orgA}', 'partner_admin', 'Admin A', 'admin@a.test'),
      ('${ID.empA1}', '${ID.orgA}', 'partner_employee', 'Emp A1', 'e1@a.test'),
      ('${ID.empA2}', '${ID.orgA}', 'partner_employee', 'Emp A2', 'e2@a.test'),
      ('${ID.adminB}', '${ID.orgB}', 'partner_admin', 'Admin B', 'admin@b.test'),
      ('${ID.empB1}', '${ID.orgB}', 'partner_employee', 'Emp B1', 'e1@b.test');

    insert into projects (id, name) values
      ('${ID.proj1}', 'Skyline Heights'), ('${ID.proj2}', 'Green Meadows');
    insert into project_assignments (project_id, org_id) values
      ('${ID.proj1}', '${ID.orgA}'), ('${ID.proj1}', '${ID.orgB}'), ('${ID.proj2}', '${ID.orgA}');

    insert into leads (id, org_id, project_id, name, phone, assigned_to) values
      ('${ID.leadA1}', '${ID.orgA}', '${ID.proj1}', 'Lead A1', '+919800000001', '${ID.empA1}'),
      ('${ID.leadA2}', '${ID.orgA}', '${ID.proj1}', 'Lead A2', '+919800000002', '${ID.empA2}'),
      ('${ID.leadB1}', '${ID.orgB}', '${ID.proj1}', 'Lead B1', '+919800000003', '${ID.empB1}');
  `);

  /** Run fn as a signed-in user, with RLS enforced. */
  async function as<T>(userId: string, fn: (q: Query) => Promise<T>): Promise<T> {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    try {
      return await fn((sql, params) => db.query(sql, params));
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
    }
  }

  /** Run as the owner / service role (bypasses RLS). */
  const admin: Query = (sql, params) => db.query(sql, params);

  return { db, as, admin };
}

export type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
