import { beforeAll, describe, expect, it } from "vitest";
import { createDb, ID } from "./harness";

describe("delete_partner_data", () => {
  let t: Awaited<ReturnType<typeof createDb>>;
  beforeAll(async () => {
    t = await createDb();
    // Give partner A a full set of records, including ones with no cascade.
    await t.db.exec(`
      insert into campaigns (id, org_id, project_id, name) values ('40000000-0000-0000-0000-000000000001', '${ID.orgA}', '${ID.proj1}', 'C1');
      insert into callback_tasks (org_id, lead_id, assigned_to, due_at) values ('${ID.orgA}', '${ID.leadA1}', '${ID.empA1}', now());
      insert into site_visits (org_id, lead_id, project_id, status) values ('${ID.orgA}', '${ID.leadA1}', '${ID.proj1}', 'requested');
      insert into opt_outs (org_id, phone, reason) values ('${ID.orgA}', '+919800000009', 'test');
      insert into invitations (org_id, email, role, token_hash) values ('${ID.orgA}', 'new@a.test', 'partner_employee', 'h');
    `);
  });

  it("removes the partner and all of its data, and nothing of the other partner", async () => {
    const r = await t.admin(`select delete_partner_data('${ID.orgA}') as out`);
    const ids: string[] = r.rows[0].out.user_ids;
    expect(ids.sort()).toEqual([ID.adminA, ID.empA1, ID.empA2].sort());

    for (const table of ["leads", "lead_activities", "callback_tasks", "site_visits", "campaigns", "opt_outs", "invitations", "profiles", "org_entitlements", "project_assignments"]) {
      const col = table === "organizations" ? "id" : "org_id";
      const c = await t.admin(`select count(*)::int n from ${table} where ${col} = '${ID.orgA}'`);
      expect(c.rows[0].n, table).toBe(0);
    }
    expect((await t.admin(`select count(*)::int n from organizations where id = '${ID.orgA}'`)).rows[0].n).toBe(0);

    // Partner B and the shared project catalogue are untouched.
    expect((await t.admin(`select count(*)::int n from leads where org_id = '${ID.orgB}'`)).rows[0].n).toBe(1);
    expect((await t.admin(`select count(*)::int n from profiles where org_id = '${ID.orgB}'`)).rows[0].n).toBe(2);
    expect((await t.admin(`select count(*)::int n from projects`)).rows[0].n).toBe(2);
    expect((await t.admin(`select count(*)::int n from profiles where id = '${ID.superAdmin}'`)).rows[0].n).toBe(1);
  });

  it("fails cleanly for an unknown partner", async () => {
    await expect(t.admin(`select delete_partner_data('99999999-0000-0000-0000-000000000000')`)).rejects.toThrow(/not found/);
  });

  it("cannot be called by a signed-in user, even a Super Admin", async () => {
    await expect(t.as(ID.superAdmin, (q) => q(`select delete_partner_data('${ID.orgB}')`))).rejects.toThrow(/permission denied/);
    await expect(t.as(ID.adminB, (q) => q(`select delete_partner_data('${ID.orgB}')`))).rejects.toThrow(/permission denied/);
  });
});
