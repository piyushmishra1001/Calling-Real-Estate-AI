import { beforeEach, describe, expect, it } from "vitest";
import { createDb, ID } from "./harness";

let ctx: Awaited<ReturnType<typeof createDb>>;
beforeEach(async () => {
  ctx = await createDb();
});

const newUser = (id: string, email: string, meta = "{}") =>
  ctx.admin("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)", [id, email, meta]);

describe("invitation-based onboarding", () => {
  it("creates a profile from the stored invitation when the invited user appears", async () => {
    await ctx.admin("insert into invitations (org_id, email, role, token_hash) values ($1, 'new@a.test', 'partner_employee', 'h')", [ID.orgA]);
    await newUser("00000000-0000-0000-0000-0000000000c1", "NEW@a.test");
    const p = await ctx.admin("select org_id, role from profiles where id = '00000000-0000-0000-0000-0000000000c1'");
    expect(p.rows[0]).toEqual({ org_id: ID.orgA, role: "partner_employee" });
    const inv = await ctx.admin("select accepted_at from invitations where email = 'new@a.test'");
    expect(inv.rows[0].accepted_at).not.toBeNull();
  });

  it("ignores org and role claimed in user metadata", async () => {
    await ctx.admin("insert into invitations (org_id, email, role, token_hash) values ($1, 'sneaky@a.test', 'partner_employee', 'h')", [ID.orgA]);
    await newUser("00000000-0000-0000-0000-0000000000c2", "sneaky@a.test", JSON.stringify({ role: "super_admin", org_id: ID.orgB }));
    const p = await ctx.admin("select org_id, role from profiles where id = '00000000-0000-0000-0000-0000000000c2'");
    expect(p.rows[0]).toEqual({ org_id: ID.orgA, role: "partner_employee" });
  });

  it("gives no access to someone who was never invited", async () => {
    await newUser("00000000-0000-0000-0000-0000000000c3", "stranger@x.test");
    expect((await ctx.admin("select 1 from profiles where id = '00000000-0000-0000-0000-0000000000c3'")).rows).toHaveLength(0);
  });

  it("rejects expired and already-used invitations", async () => {
    await ctx.admin("insert into invitations (org_id, email, role, token_hash, expires_at) values ($1, 'old@a.test', 'partner_employee', 'h', now() - interval '1 day')", [ID.orgA]);
    await newUser("00000000-0000-0000-0000-0000000000c4", "old@a.test");
    expect((await ctx.admin("select 1 from profiles where id = '00000000-0000-0000-0000-0000000000c4'")).rows).toHaveLength(0);

    await ctx.admin("insert into invitations (org_id, email, role, token_hash, accepted_at) values ($1, 'used@a.test', 'partner_employee', 'h', now())", [ID.orgA]);
    await newUser("00000000-0000-0000-0000-0000000000c5", "used@a.test");
    expect((await ctx.admin("select 1 from profiles where id = '00000000-0000-0000-0000-0000000000c5'")).rows).toHaveLength(0);
  });

  it("gives no access when the inviting organisation is suspended", async () => {
    await ctx.admin("update organizations set status = 'suspended' where id = $1", [ID.orgA]);
    await ctx.admin("insert into invitations (org_id, email, role, token_hash) values ($1, 'late@a.test', 'partner_employee', 'h')", [ID.orgA]);
    await newUser("00000000-0000-0000-0000-0000000000c6", "late@a.test");
    expect((await ctx.admin("select 1 from profiles where id = '00000000-0000-0000-0000-0000000000c6'")).rows).toHaveLength(0);
  });

  it("enforces the plan's seat limit", async () => {
    // org A already has 3 active users (admin + 2 employees); allow exactly 3
    await ctx.admin("update org_entitlements set seats = 3 where org_id = $1", [ID.orgA]);
    await ctx.admin("insert into invitations (org_id, email, role, token_hash) values ($1, 'extra@a.test', 'partner_employee', 'h')", [ID.orgA]);
    await expect(newUser("00000000-0000-0000-0000-0000000000c7", "extra@a.test")).rejects.toThrow(/seat limit/);
  });
});
