import type { Metadata } from "next";
import { isManager, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listTeam } from "@/lib/clients/team";
import { ROLES, invitableRoles, roleLabel } from "@/lib/clients/team-utils";
import { ActionForm, SubmitButton } from "@/components/form";
import { Avatar, Badge, Card, CardTitle, Checkbox, Field, Input, LinkButton, PageHeader, Select, cn } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { inviteMember, resendMemberInvite, setMemberActive, updateMember } from "./actions";

export const metadata: Metadata = { title: "Team" };

const roleTone = (r: string) => (r === "owner" ? "purple" : r === "admin" ? "blue" : r === "coach" ? "brand" : "neutral") as "purple" | "blue" | "brand" | "neutral";

export default async function TeamPage() {
  const { profile, business, membership } = await requireStaff();
  const manager = isManager(membership);
  const supabase = await createClient();
  const team = await listTeam(supabase, business.id);
  const assignable = invitableRoles(membership.role);
  const active = team.filter((m) => m.active);
  const inactive = team.filter((m) => !m.active);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description={`${active.length} active member${active.length === 1 ? "" : "s"} at ${business.name}`}
        actions={
          <LinkButton href="/coach/settings#coach-profile" variant="outline" size="sm">
            Edit my coach profile
          </LinkButton>
        }
      />

      {manager ? (
        <Card>
          <CardTitle>Invite someone</CardTitle>
          <p className="mt-1 text-sm text-zinc-500">
            They get an email from {business.name} with a link to sign in. No password needed.
          </p>
          <ActionForm action={inviteMember} resetOnSuccess className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Email" htmlFor="inv-email">
              <Input id="inv-email" name="email" type="email" required autoComplete="off" placeholder="coach@example.com" />
            </Field>
            <Field label="Name" htmlFor="inv-name">
              <Input id="inv-name" name="full_name" autoComplete="off" />
            </Field>
            <Field label="Role" htmlFor="inv-role">
              <Select id="inv-role" name="role" defaultValue="coach">
                {ROLES.filter((r) => assignable.includes(r.value)).map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Title (optional)" htmlFor="inv-title">
              <Input id="inv-title" name="title" placeholder="Strength coach" />
            </Field>
            <div className="sm:col-span-2 lg:col-span-4">
              <Checkbox name="is_bookable" defaultChecked label="Clients can book sessions with them" />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <SubmitButton pendingLabel="Inviting…">Send invite</SubmitButton>
            </div>
          </ActionForm>
          <dl className="mt-5 grid gap-2 border-t border-zinc-200 pt-4 text-xs text-zinc-500 sm:grid-cols-2 dark:border-zinc-800">
            {ROLES.map((r) => (
              <div key={r.value}>
                <dt className="inline font-semibold text-zinc-700 dark:text-zinc-300">{r.label}: </dt>
                <dd className="inline">{r.description}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}

      <ul className="space-y-3">
        {active.map((m) => {
          const self = m.userId === profile.id;
          const lockedOwner = m.role === "owner" && membership.role !== "owner";
          return (
            <li key={m.userId}>
              <Card className="p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={m.name} src={m.avatarUrl} size={44} />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {m.name}
                        {self ? <Badge>You</Badge> : null}
                        <Badge tone={roleTone(m.role)}>{roleLabel(m.role)}</Badge>
                        {m.isBookable ? <Badge tone="green">Bookable</Badge> : null}
                      </p>
                      <p className="truncate text-xs text-zinc-500">
                        {[m.title, m.email, `joined ${formatDate(m.createdAt, profile.timezone)}`].filter(Boolean).join(" · ")}
                      </p>
                      {m.specialties.length ? <p className="mt-0.5 truncate text-xs text-zinc-500">{m.specialties.join(" · ")}</p> : null}
                    </div>
                  </div>
                  {manager ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                      <ActionForm action={updateMember} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="user_id" value={m.userId} />
                        <label htmlFor={`role-${m.userId}`} className="sr-only">
                          Role for {m.name}
                        </label>
                        <Select id={`role-${m.userId}`} name="role" defaultValue={m.role} disabled={lockedOwner} className="w-28">
                          {ROLES.filter((r) => r.value === m.role || assignable.includes(r.value)).map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </Select>
                        {lockedOwner ? <input type="hidden" name="role" value={m.role} /> : null}
                        <label htmlFor={`title-${m.userId}`} className="sr-only">
                          Title for {m.name}
                        </label>
                        <Input id={`title-${m.userId}`} name="title" defaultValue={m.title ?? ""} placeholder="Title" className="w-36" />
                        <Checkbox name="is_bookable" defaultChecked={m.isBookable} label="Bookable" />
                        <SubmitButton size="sm" variant="outline">
                          Save
                        </SubmitButton>
                      </ActionForm>
                      <div className="flex gap-2">
                        {!self ? (
                          <ActionForm action={resendMemberInvite}>
                            <input type="hidden" name="user_id" value={m.userId} />
                            <SubmitButton size="sm" variant="ghost" pendingLabel="Sending…">
                              Resend invite
                            </SubmitButton>
                          </ActionForm>
                        ) : null}
                        {!self && !lockedOwner ? (
                          <ActionForm action={setMemberActive}>
                            <input type="hidden" name="user_id" value={m.userId} />
                            <input type="hidden" name="active" value="false" />
                            <SubmitButton size="sm" variant="ghost" pendingLabel="…">
                              Deactivate
                            </SubmitButton>
                          </ActionForm>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      {manager && inactive.length ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Deactivated</h2>
          <ul className="space-y-2">
            {inactive.map((m) => (
              <li key={m.userId}>
                <Card className={cn("flex items-center justify-between gap-3 p-4 opacity-80")}>
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={m.name} src={m.avatarUrl} size={36} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{m.name}</p>
                      <p className="truncate text-xs text-zinc-500">
                        {roleLabel(m.role)} · {m.email}
                      </p>
                    </div>
                  </div>
                  {m.role !== "owner" || membership.role === "owner" ? (
                    <ActionForm action={setMemberActive}>
                      <input type="hidden" name="user_id" value={m.userId} />
                      <input type="hidden" name="active" value="true" />
                      <SubmitButton size="sm" variant="outline" pendingLabel="…">
                        Reactivate
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
