import { beforeEach, describe, expect, it } from "vitest";
import { createDb, ID } from "./harness";

let ctx: Awaited<ReturnType<typeof createDb>>;
beforeEach(async () => {
  ctx = await createDb(); // fresh database per test: no state leaks between tests
});

describe("tenant isolation (two partner organisations)", () => {
  it("each partner admin sees only their own organisation's leads", async () => {
    const a = await ctx.as(ID.adminA, (q) => q("select id from leads order by name"));
    const b = await ctx.as(ID.adminB, (q) => q("select id from leads order by name"));
    expect(a.rows.map((r) => r.id).sort()).toEqual([ID.leadA1, ID.leadA2].sort());
    expect(b.rows.map((r) => r.id)).toEqual([ID.leadB1]);
  });

  it("a partner admin cannot read or modify another partner's lead", async () => {
    const read = await ctx.as(ID.adminA, (q) => q("select id from leads where id = $1", [ID.leadB1]));
    expect(read.rows).toHaveLength(0);

    const upd = await ctx.as(ID.adminA, (q) =>
      q("update leads set notes = 'hacked' where id = $1 returning id", [ID.leadB1]),
    );
    expect(upd.rows).toHaveLength(0);

    const del = await ctx.as(ID.adminA, (q) => q("delete from leads where id = $1 returning id", [ID.leadB1]));
    expect(del.rows).toHaveLength(0);

    const still = await ctx.admin("select notes from leads where id = $1", [ID.leadB1]);
    expect(still.rows[0].notes).toBeNull();
  });

  it("a partner admin cannot insert a lead into another organisation", async () => {
    await expect(
      ctx.as(ID.adminA, (q) =>
        q("insert into leads (org_id, project_id, name, phone) values ($1, $2, 'x', '+919811111111')", [
          ID.orgB,
          ID.proj1,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a lead cannot be moved to another organisation", async () => {
    await expect(
      ctx.as(ID.adminA, (q) => q("update leads set org_id = $1 where id = $2", [ID.orgB, ID.leadA1])),
    ).rejects.toThrow();
  });

  it("partners cannot see each other's profiles, call records or activity", async () => {
    const profiles = await ctx.as(ID.adminA, (q) => q("select id from profiles"));
    const ids = profiles.rows.map((r) => r.id);
    expect(ids).not.toContain(ID.adminB);
    expect(ids).not.toContain(ID.empB1);

    await ctx.admin(
      `insert into calls (org_id, lead_id, project_id, connected, duration_seconds) values ($1, $2, $3, true, 60)`,
      [ID.orgB, ID.leadB1, ID.proj1],
    );
    const calls = await ctx.as(ID.adminA, (q) => q("select id from calls"));
    expect(calls.rows).toHaveLength(0);

    const acts = await ctx.as(ID.adminA, (q) => q("select id from lead_activities"));
    expect(acts.rows).toHaveLength(0);
  });
});

describe("project access", () => {
  it("partners only see projects assigned to them", async () => {
    const a = await ctx.as(ID.adminA, (q) => q("select id from projects"));
    const b = await ctx.as(ID.adminB, (q) => q("select id from projects"));
    expect(a.rows.map((r) => r.id).sort()).toEqual([ID.proj1, ID.proj2].sort());
    expect(b.rows.map((r) => r.id)).toEqual([ID.proj1]);
  });

  it("a partner cannot create a lead on a project not assigned to them", async () => {
    await expect(
      ctx.as(ID.adminB, (q) =>
        q("insert into leads (org_id, project_id, name, phone) values ($1, $2, 'x', '+919822222222')", [
          ID.orgB,
          ID.proj2,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("two partners can hold the same project without seeing each other's leads", async () => {
    await ctx.as(ID.adminB, (q) =>
      q("insert into leads (org_id, project_id, name, phone) values ($1, $2, 'B new', '+919833333333')", [
        ID.orgB,
        ID.proj1,
      ]),
    );
    const a = await ctx.as(ID.adminA, (q) => q("select name from leads where project_id = $1", [ID.proj1]));
    expect(a.rows.map((r) => r.name)).not.toContain("B new");
  });

  it("partners cannot create or modify projects or assignments", async () => {
    await expect(ctx.as(ID.adminA, (q) => q("insert into projects (name) values ('mine')"))).rejects.toThrow();
    await expect(
      ctx.as(ID.adminA, (q) => q("insert into project_assignments (project_id, org_id) values ($1, $2)", [ID.proj2, ID.orgA])),
    ).rejects.toThrow();
  });
});

describe("knowledge base approval", () => {
  beforeEach(async () => {
    await ctx.admin(
      `insert into project_kb_versions (project_id, version, facts, status) values
         ($1, 1, '{"price":"draft"}', 'draft'),
         ($1, 2, '{"price":"pending"}', 'pending_review')`,
      [ID.proj1],
    );
  });

  it("partners and employees never see unapproved versions", async () => {
    const r = await ctx.as(ID.adminA, (q) => q("select id from project_kb_versions"));
    expect(r.rows).toHaveLength(0);
    const e = await ctx.as(ID.empA1, (q) => q("select id from project_kb_versions"));
    expect(e.rows).toHaveLength(0);
  });

  it("an approved version becomes visible to assigned partners only", async () => {
    await ctx.admin(
      `insert into project_kb_versions (project_id, version, facts, status, reviewed_by, reviewed_at)
       values ($1, 3, '{"price":"approved"}', 'approved', $2, now())`,
      [ID.proj2, ID.superAdmin],
    );
    const a = await ctx.as(ID.adminA, (q) => q("select version from project_kb_versions"));
    expect(a.rows.map((r) => r.version)).toEqual([3]);
    const b = await ctx.as(ID.adminB, (q) => q("select version from project_kb_versions"));
    expect(b.rows).toHaveLength(0); // proj2 is not assigned to B
  });

  it("approval requires a named reviewer, and only one approved version per project", async () => {
    await expect(
      ctx.admin(`insert into project_kb_versions (project_id, version, status) values ($1, 9, 'approved')`, [ID.proj1]),
    ).rejects.toThrow(/kb_approved_needs_reviewer/);

    await ctx.admin(
      `insert into project_kb_versions (project_id, version, status, reviewed_by, reviewed_at) values ($1, 10, 'approved', $2, now())`,
      [ID.proj1, ID.superAdmin],
    );
    await expect(
      ctx.admin(
        `insert into project_kb_versions (project_id, version, status, reviewed_by, reviewed_at) values ($1, 11, 'approved', $2, now())`,
        [ID.proj1, ID.superAdmin],
      ),
    ).rejects.toThrow(/project_kb_one_approved/);
  });

  it("a partner admin cannot approve a knowledge-base version", async () => {
    const upd = await ctx.as(ID.adminA, (q) =>
      q("update project_kb_versions set status = 'approved' returning id"),
    );
    expect(upd.rows).toHaveLength(0);
  });
});

describe("employee restrictions", () => {
  it("an employee sees only leads assigned to them", async () => {
    const r = await ctx.as(ID.empA1, (q) => q("select id from leads"));
    expect(r.rows.map((x) => x.id)).toEqual([ID.leadA1]);
  });

  it("an employee can update status and notes on an assigned lead", async () => {
    const r = await ctx.as(ID.empA1, (q) =>
      q("update leads set status = 'interested', notes = 'called back' where id = $1 returning status", [ID.leadA1]),
    );
    expect(r.rows[0].status).toBe("interested");
  });

  it("an employee cannot touch a colleague's lead", async () => {
    const r = await ctx.as(ID.empA1, (q) =>
      q("update leads set notes = 'x' where id = $1 returning id", [ID.leadA2]),
    );
    expect(r.rows).toHaveLength(0);
  });

  it("an employee cannot reassign a lead, change its phone or project", async () => {
    await expect(
      ctx.as(ID.empA1, (q) => q("update leads set assigned_to = $1 where id = $2", [ID.empA2, ID.leadA1])),
    ).rejects.toThrow();
    await expect(
      ctx.as(ID.empA1, (q) => q("update leads set phone = '+919899999999' where id = $1", [ID.leadA1])),
    ).rejects.toThrow(/only a partner admin/);
    await expect(
      ctx.as(ID.empA1, (q) => q("update leads set project_id = $1 where id = $2", [ID.proj2, ID.leadA1])),
    ).rejects.toThrow(/only a partner admin/);
  });

  it("an employee cannot import leads, create campaigns or read org-wide data", async () => {
    await expect(
      ctx.as(ID.empA1, (q) =>
        q("insert into leads (org_id, project_id, name, phone) values ($1, $2, 'x', '+919844444444')", [ID.orgA, ID.proj1]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      ctx.as(ID.empA1, (q) =>
        q("insert into campaigns (org_id, project_id, name) values ($1, $2, 'c')", [ID.orgA, ID.proj1]),
      ),
    ).rejects.toThrow(/row-level security/);
    const profiles = await ctx.as(ID.empA1, (q) => q("select id from profiles"));
    expect(profiles.rows.map((r) => r.id)).toEqual([ID.empA1]); // only themselves
    const opt = await ctx.as(ID.empA1, (q) => q("select id from opt_outs"));
    expect(opt.rows).toHaveLength(0);
  });

  it("an employee sees only their own callback tasks", async () => {
    await ctx.admin(
      `insert into callback_tasks (org_id, lead_id, assigned_to) values ($1, $2, $3), ($1, $4, $5)`,
      [ID.orgA, ID.leadA1, ID.empA1, ID.leadA2, ID.empA2],
    );
    const r = await ctx.as(ID.empA1, (q) => q("select lead_id from callback_tasks"));
    expect(r.rows.map((x) => x.lead_id)).toEqual([ID.leadA1]);
  });
});

describe("role escalation and platform limits", () => {
  it("a partner admin cannot promote anyone, add a super admin or change org", async () => {
    const promote = await ctx.as(ID.adminA, (q) =>
      q("update profiles set role = 'partner_admin' where id = $1 returning id", [ID.empA1]),
    ).catch((e) => e);
    // either rejected outright or affected zero rows; the role must be unchanged
    void promote;
    const after = await ctx.admin("select role from profiles where id = $1", [ID.empA1]);
    expect(after.rows[0].role).toBe("partner_employee");

    await expect(
      ctx.as(ID.adminA, (q) => q("insert into profiles (id, org_id, role) values (gen_random_uuid(), $1, 'partner_admin')", [ID.orgA])),
    ).rejects.toThrow();

    const move = await ctx.as(ID.adminA, (q) =>
      q("update profiles set org_id = $1 where id = $2 returning id", [ID.orgB, ID.empA1]),
    ).catch(() => ({ rows: [] }));
    expect(move.rows).toHaveLength(0);
    const org = await ctx.admin("select org_id from profiles where id = $1", [ID.empA1]);
    expect(org.rows[0].org_id).toBe(ID.orgA);
  });

  it("a partner admin cannot raise their own usage limits or plan", async () => {
    const upd = await ctx.as(ID.adminA, (q) =>
      q("update org_entitlements set monthly_minute_limit = 999999 where org_id = $1 returning org_id", [ID.orgA]),
    );
    expect(upd.rows).toHaveLength(0);
    const ent = await ctx.admin("select monthly_minute_limit from org_entitlements where org_id = $1", [ID.orgA]);
    expect(ent.rows[0].monthly_minute_limit).toBe(0);
  });

  it("a partner can read their own entitlements but not another partner's", async () => {
    const r = await ctx.as(ID.adminA, (q) => q("select org_id from org_entitlements"));
    expect(r.rows.map((x) => x.org_id)).toEqual([ID.orgA]);
  });

  it("only the super admin can flip the calling kill switch", async () => {
    const partner = await ctx.as(ID.adminA, (q) =>
      q("update platform_settings set calling_kill_switch = true returning id"),
    );
    expect(partner.rows).toHaveLength(0);

    const sa = await ctx.as(ID.superAdmin, (q) =>
      q("update platform_settings set calling_kill_switch = true returning calling_kill_switch"),
    );
    expect(sa.rows[0].calling_kill_switch).toBe(true);
  });

  it("partners cannot write call records or audit logs directly", async () => {
    await expect(
      ctx.as(ID.adminA, (q) =>
        q("insert into calls (org_id, lead_id, project_id) values ($1, $2, $3)", [ID.orgA, ID.leadA1, ID.proj1]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ctx.as(ID.adminA, (q) => q("insert into audit_logs (action) values ('forged')")),
    ).rejects.toThrow(/permission denied/);
  });

  it("partner admins can invite employees but not other admins", async () => {
    await ctx.as(ID.adminA, (q) =>
      q(
        "insert into invitations (org_id, email, role, token_hash, invited_by) values ($1, 'new@a.test', 'partner_employee', 'h', $2)",
        [ID.orgA, ID.adminA],
      ),
    );
    await expect(
      ctx.as(ID.adminA, (q) =>
        q(
          "insert into invitations (org_id, email, role, token_hash, invited_by) values ($1, 'boss@a.test', 'partner_admin', 'h', $2)",
          [ID.orgA, ID.adminA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      ctx.as(ID.adminA, (q) =>
        q(
          "insert into invitations (org_id, email, role, token_hash, invited_by) values ($1, 'x@b.test', 'partner_employee', 'h', $2)",
          [ID.orgB, ID.adminA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("super admin has platform control but no customer-data access", () => {
  it("can manage partners, projects and assignments", async () => {
    await ctx.as(ID.superAdmin, (q) => q("insert into organizations (name) values ('Partner C')"));
    await ctx.as(ID.superAdmin, (q) => q("insert into projects (name) values ('New Tower')"));
    const orgs = await ctx.as(ID.superAdmin, (q) => q("select id from organizations"));
    expect(orgs.rows).toHaveLength(3);
  });

  it("cannot read leads or calls directly, but gets aggregate stats", async () => {
    await ctx.admin(
      `insert into calls (org_id, lead_id, project_id, connected, duration_seconds, stt_cost_inr, tts_cost_inr, telephony_cost_inr)
       values ($1, $2, $3, true, 120, 1, 1, 3)`,
      [ID.orgA, ID.leadA1, ID.proj1],
    );
    const leads = await ctx.as(ID.superAdmin, (q) => q("select id from leads"));
    expect(leads.rows).toHaveLength(0);
    const calls = await ctx.as(ID.superAdmin, (q) => q("select id from calls"));
    expect(calls.rows).toHaveLength(0);

    const stats = await ctx.as(ID.superAdmin, (q) => q("select platform_stats() as s"));
    const s = stats.rows[0].s;
    expect(s.leads).toBe(3);
    expect(s.calls_connected).toBe(1);
    expect(Number(s.ai_cost_inr)).toBe(2);
    expect(Number(s.telephony_cost_inr)).toBe(3);
  });

  it("platform_stats is refused to partner admins", async () => {
    await expect(ctx.as(ID.adminA, (q) => q("select platform_stats()"))).rejects.toThrow(/super admin only/);
  });

  it("can stop a campaign but cannot edit other campaign fields", async () => {
    await ctx.admin(
      `insert into campaigns (id, org_id, project_id, name, status) values
         ('40000000-0000-0000-0000-000000000001', $1, $2, 'Diwali push', 'running')`,
      [ID.orgA, ID.proj1],
    );
    const stopped = await ctx.as(ID.superAdmin, (q) =>
      q("update campaigns set status = 'stopped' where id = '40000000-0000-0000-0000-000000000001' returning status, stopped_by"),
    );
    expect(stopped.rows[0].status).toBe("stopped");
    expect(stopped.rows[0].stopped_by).toBe(ID.superAdmin);

    await expect(
      ctx.as(ID.superAdmin, (q) =>
        q("update campaigns set name = 'renamed' where id = '40000000-0000-0000-0000-000000000001'"),
      ),
    ).rejects.toThrow(/may only change campaign status/);
  });
});

describe("partner suspension", () => {
  it("a suspended partner loses access to all operational data", async () => {
    await ctx.as(ID.superAdmin, (q) => q("update organizations set status = 'suspended' where id = $1", [ID.orgA]));

    expect((await ctx.as(ID.adminA, (q) => q("select id from leads"))).rows).toHaveLength(0);
    expect((await ctx.as(ID.empA1, (q) => q("select id from leads"))).rows).toHaveLength(0);
    expect((await ctx.as(ID.adminA, (q) => q("select id from projects"))).rows).toHaveLength(0);
    await expect(
      ctx.as(ID.adminA, (q) =>
        q("insert into leads (org_id, project_id, name, phone) values ($1, $2, 'x', '+919855555555')", [ID.orgA, ID.proj1]),
      ),
    ).rejects.toThrow(/row-level security/);

    // partner B is unaffected
    expect((await ctx.as(ID.adminB, (q) => q("select id from leads"))).rows).toHaveLength(1);
  });

  it("reactivating a partner restores access", async () => {
    await ctx.as(ID.superAdmin, (q) => q("update organizations set status = 'suspended' where id = $1", [ID.orgA]));
    await ctx.as(ID.superAdmin, (q) => q("update organizations set status = 'active' where id = $1", [ID.orgA]));
    expect((await ctx.as(ID.adminA, (q) => q("select id from leads"))).rows).toHaveLength(2);
  });

  it("a deactivated user loses access even if their organisation is active", async () => {
    await ctx.as(ID.superAdmin, (q) => q("update profiles set is_active = false where id = $1", [ID.empA1]));
    expect((await ctx.as(ID.empA1, (q) => q("select id from leads"))).rows).toHaveLength(0);
  });
});

describe("lead history and opt-outs", () => {
  it("status changes are recorded as history, not overwritten", async () => {
    await ctx.as(ID.empA1, (q) => q("update leads set status = 'connected' where id = $1", [ID.leadA1]));
    await ctx.as(ID.empA1, (q) => q("update leads set status = 'interested' where id = $1", [ID.leadA1]));
    const h = await ctx.as(ID.adminA, (q) =>
      q("select from_status, to_status from lead_activities where lead_id = $1 order by created_at, to_status", [ID.leadA1]),
    );
    expect(h.rows).toHaveLength(2);
    expect(h.rows.map((r) => r.to_status).sort()).toEqual(["connected", "interested"]);
  });

  it("history cannot be edited or deleted by users", async () => {
    await ctx.as(ID.empA1, (q) => q("update leads set status = 'connected' where id = $1", [ID.leadA1]));
    await expect(
      ctx.as(ID.adminA, (q) => q("update lead_activities set kind = 'tampered'")),
    ).rejects.toThrow(/permission denied/);
    await expect(ctx.as(ID.adminA, (q) => q("delete from lead_activities"))).rejects.toThrow(/permission denied/);
  });

  it("recording an opt-out immediately marks the lead do-not-contact", async () => {
    await ctx.as(ID.empA1, (q) =>
      q("insert into opt_outs (org_id, phone, reason) values ($1, '+919800000001', 'asked to stop')", [ID.orgA]),
    );
    const lead = await ctx.admin("select status, consent_status from leads where id = $1", [ID.leadA1]);
    expect(lead.rows[0]).toEqual({ status: "do_not_contact", consent_status: "denied" });
  });

  it("an opt-out in one organisation does not affect another", async () => {
    await ctx.admin("update leads set phone = '+919800000001' where id = $1", [ID.leadB1]);
    await ctx.as(ID.empA1, (q) =>
      q("insert into opt_outs (org_id, phone) values ($1, '+919800000001')", [ID.orgA]),
    );
    const b = await ctx.admin("select status from leads where id = $1", [ID.leadB1]);
    expect(b.rows[0].status).toBe("new");
  });

  it("phone numbers must be valid E.164", async () => {
    await expect(
      ctx.as(ID.adminA, (q) =>
        q("insert into leads (org_id, project_id, name, phone) values ($1, $2, 'x', '98765')", [ID.orgA, ID.proj1]),
      ),
    ).rejects.toThrow(/leads_phone_check|violates check/);
  });

  it("the same phone cannot be imported twice for the same project and organisation", async () => {
    await expect(
      ctx.as(ID.adminA, (q) =>
        q("insert into leads (org_id, project_id, name, phone) values ($1, $2, 'dup', '+919800000001')", [ID.orgA, ID.proj1]),
      ),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("site visits", () => {
  it("a visit cannot be marked confirmed without a reserved slot and a confirmation source", async () => {
    await expect(
      ctx.as(ID.adminA, (q) =>
        q("insert into site_visits (org_id, lead_id, project_id, status) values ($1, $2, $3, 'confirmed')", [
          ID.orgA,
          ID.leadA1,
          ID.proj1,
        ]),
      ),
    ).rejects.toThrow(/visit_confirmed_needs_slot/);
  });

  it("a requested visit can be confirmed once a human books the slot", async () => {
    const v = await ctx.as(ID.empA1, (q) =>
      q(
        "insert into site_visits (org_id, lead_id, project_id, preferred_at) values ($1, $2, $3, now() + interval '3 days') returning id, status",
        [ID.orgA, ID.leadA1, ID.proj1],
      ),
    );
    expect(v.rows[0].status).toBe("requested");
    const c = await ctx.as(ID.empA1, (q) =>
      q(
        "update site_visits set status = 'confirmed', scheduled_at = now() + interval '3 days', confirmation_source = 'human' where id = $1 returning status",
        [v.rows[0].id],
      ),
    );
    expect(c.rows[0].status).toBe("confirmed");
  });

  it("visits are isolated between partners and between employees", async () => {
    await ctx.admin(
      `insert into site_visits (org_id, lead_id, project_id) values ($1, $2, $3), ($4, $5, $3)`,
      [ID.orgA, ID.leadA1, ID.proj1, ID.orgB, ID.leadB1],
    );
    expect((await ctx.as(ID.adminA, (q) => q("select id from site_visits"))).rows).toHaveLength(1);
    expect((await ctx.as(ID.empA2, (q) => q("select id from site_visits"))).rows).toHaveLength(0);
    expect((await ctx.as(ID.empA1, (q) => q("select id from site_visits"))).rows).toHaveLength(1);
  });
});

describe("calling gate, usage limits and kill switch", () => {
  const gate = async (org: string) =>
    (await ctx.admin("select can_start_call($1) as r", [org])).rows[0].r as { allowed: boolean; reason: string };

  const addMinutes = async (org: string, lead: string, minutes: number) =>
    ctx.admin(
      `insert into calls (org_id, lead_id, project_id, connected, duration_seconds) values ($1, $2, $3, true, $4)`,
      [org, lead, ID.proj1, minutes * 60],
    );

  it("blocks calling for a plan with no AI minutes", async () => {
    expect(await gate(ID.orgA)).toEqual({ allowed: false, reason: "no_ai_entitlement" });
  });

  it("allows calling within limits, then blocks at the monthly hard limit", async () => {
    await ctx.as(ID.superAdmin, (q) =>
      q("update org_entitlements set monthly_minute_limit = 100, daily_call_limit = 50 where org_id = $1", [ID.orgA]),
    );
    expect(await gate(ID.orgA)).toEqual({ allowed: true, reason: "ok" });
    await addMinutes(ID.orgA, ID.leadA1, 100);
    expect(await gate(ID.orgA)).toEqual({ allowed: false, reason: "monthly_limit_reached" });
    // other partner is unaffected by A's usage
    await ctx.admin("update org_entitlements set monthly_minute_limit = 100, daily_call_limit = 50 where org_id = $1", [ID.orgB]);
    expect(await gate(ID.orgB)).toEqual({ allowed: true, reason: "ok" });
  });

  it("enforces the daily call limit", async () => {
    await ctx.admin("update org_entitlements set monthly_minute_limit = 1000, daily_call_limit = 2 where org_id = $1", [ID.orgA]);
    await addMinutes(ID.orgA, ID.leadA1, 1);
    await addMinutes(ID.orgA, ID.leadA2, 1);
    expect(await gate(ID.orgA)).toEqual({ allowed: false, reason: "daily_limit_reached" });
  });

  it("the kill switch stops calling for every partner immediately", async () => {
    await ctx.admin("update org_entitlements set monthly_minute_limit = 1000, daily_call_limit = 50");
    expect((await gate(ID.orgA)).allowed).toBe(true);
    await ctx.as(ID.superAdmin, (q) => q("update platform_settings set calling_kill_switch = true"));
    expect(await gate(ID.orgA)).toEqual({ allowed: false, reason: "kill_switch" });
    expect(await gate(ID.orgB)).toEqual({ allowed: false, reason: "kill_switch" });
  });

  it("a suspended partner cannot start calls", async () => {
    await ctx.admin("update org_entitlements set monthly_minute_limit = 1000, daily_call_limit = 50");
    await ctx.as(ID.superAdmin, (q) => q("update organizations set status = 'suspended' where id = $1", [ID.orgA]));
    expect(await gate(ID.orgA)).toEqual({ allowed: false, reason: "organisation_not_active" });
  });

  it("raises alerts at 70%, 85% and 100% of the monthly limit", async () => {
    await ctx.admin("update org_entitlements set monthly_minute_limit = 100 where org_id = $1", [ID.orgA]);
    const level = async () =>
      (await ctx.as(ID.adminA, (q) => q("select usage_alert_level($1) as l", [ID.orgA]))).rows[0].l;
    expect(await level()).toBe(0);
    await addMinutes(ID.orgA, ID.leadA1, 70);
    expect(await level()).toBe(70);
    await addMinutes(ID.orgA, ID.leadA1, 15);
    expect(await level()).toBe(85);
    await addMinutes(ID.orgA, ID.leadA1, 15);
    expect(await level()).toBe(100);
  });

  it("a partner cannot read another partner's usage level", async () => {
    await expect(ctx.as(ID.adminA, (q) => q("select usage_alert_level($1)", [ID.orgB]))).rejects.toThrow(/not allowed/);
  });
});

describe("partner dashboard stats", () => {
  it("returns org-wide numbers to the org's admin only", async () => {
    await ctx.admin("update org_entitlements set monthly_minute_limit = 500 where org_id = $1", [ID.orgA]);
    await ctx.admin(
      `insert into calls (org_id, lead_id, project_id, connected, duration_seconds, stt_cost_inr, tts_cost_inr, telephony_cost_inr)
       values ($1, $2, $3, true, 120, 1, 1, 2), ($1, $2, $3, false, 0, 0, 0, 0.5)`,
      [ID.orgA, ID.leadA1, ID.proj1],
    );
    const s = (await ctx.as(ID.adminA, (q) => q("select partner_stats($1) as s", [ID.orgA]))).rows[0].s;
    expect(s.leads_total).toBe(2);
    expect(s.calls_attempted).toBe(2);
    expect(s.calls_connected).toBe(1);
    expect(Number(s.minutes_used)).toBe(2);
    expect(s.minutes_limit).toBe(500);
    expect(Number(s.telephony_cost_inr)).toBe(2.5);
  });

  it("is refused to employees, other partners and the super admin", async () => {
    await expect(ctx.as(ID.empA1, (q) => q("select partner_stats($1)", [ID.orgA]))).rejects.toThrow(/not allowed/);
    await expect(ctx.as(ID.adminB, (q) => q("select partner_stats($1)", [ID.orgA]))).rejects.toThrow(/not allowed/);
    await expect(ctx.as(ID.superAdmin, (q) => q("select partner_stats($1)", [ID.orgA]))).rejects.toThrow(/not allowed/);
  });

  it("counts only consented, still-callable leads as eligible", async () => {
    await ctx.admin("update leads set consent_status = 'granted' where id = $1", [ID.leadA1]);
    const s = (await ctx.as(ID.adminA, (q) => q("select partner_stats($1) as s", [ID.orgA]))).rows[0].s;
    expect(s.leads_eligible).toBe(1);
  });
});

describe("knowledge-base approval workflow", () => {
  const draft = async (version: number, status = "pending_review", facts = '{"pricing":"Rs 85 lakh"}') =>
    (await ctx.admin(
      `insert into project_kb_versions (project_id, version, facts, status) values ($1, $2, $3::jsonb, $4) returning id`,
      [ID.proj1, version, facts, status],
    )).rows[0].id as string;

  it("a super admin can approve; the reviewer is recorded as the caller and an audit row is written", async () => {
    const id = await draft(1);
    await ctx.as(ID.superAdmin, (q) => q("select approve_kb_version($1)", [id]));
    const v = (await ctx.admin("select status, reviewed_by from project_kb_versions where id = $1", [id])).rows[0];
    expect(v).toEqual({ status: "approved", reviewed_by: ID.superAdmin });
    expect((await ctx.admin("select 1 from audit_logs where action = 'kb.approve'")).rows).toHaveLength(1);
    // now visible to assigned partners
    expect((await ctx.as(ID.adminA, (q) => q("select version from project_kb_versions"))).rows).toHaveLength(1);
  });

  it("approving a new version supersedes the previous approved one atomically", async () => {
    const v1 = await draft(1);
    await ctx.as(ID.superAdmin, (q) => q("select approve_kb_version($1)", [v1]));
    const v2 = await draft(2, "pending_review", '{"pricing":"Rs 90 lakh"}');
    await ctx.as(ID.superAdmin, (q) => q("select approve_kb_version($1)", [v2]));
    const rows = (await ctx.admin("select version, status from project_kb_versions order by version")).rows;
    expect(rows).toEqual([{ version: 1, status: "superseded" }, { version: 2, status: "approved" }]);
    // partners see only the current approved facts
    const seen = (await ctx.as(ID.adminA, (q) => q("select version from project_kb_versions"))).rows;
    expect(seen).toEqual([{ version: 2 }]);
  });

  it("partners and employees cannot approve", async () => {
    const id = await draft(1);
    await expect(ctx.as(ID.adminA, (q) => q("select approve_kb_version($1)", [id]))).rejects.toThrow(/super admin only/);
    await expect(ctx.as(ID.empA1, (q) => q("select approve_kb_version($1)", [id]))).rejects.toThrow(/super admin only/);
  });

  it("only a version pending review with content can be approved", async () => {
    await expect(ctx.as(ID.superAdmin, (q) => q("select approve_kb_version($1)", [null]))).rejects.toThrow();
    const d = await draft(1, "draft");
    await expect(ctx.as(ID.superAdmin, (q) => q("select approve_kb_version($1)", [d]))).rejects.toThrow(/pending review/);
    const empty = await draft(2, "pending_review", "{}");
    await expect(ctx.as(ID.superAdmin, (q) => q("select approve_kb_version($1)", [empty]))).rejects.toThrow(/empty/);
  });

  it("a rejected version is never visible to partners", async () => {
    const id = await draft(1);
    await ctx.as(ID.superAdmin, (q) => q("select reject_kb_version($1)", [id]));
    expect((await ctx.as(ID.adminA, (q) => q("select 1 from project_kb_versions"))).rows).toHaveLength(0);
  });
});
