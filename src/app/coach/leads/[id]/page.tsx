import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { Alert, Badge, Card, CardTitle, LinkButton } from "@/components/ui";
import { isManager, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime, titleCase } from "@/lib/format";
import { optionLabel } from "@/lib/leads/options";
import { scoreLead } from "@/lib/leads/score";
import type { Json } from "@/lib/supabase/database.types";
import { ScoreBadge, StatusBadge, leadName, sourceLabel } from "../lead-ui";
import {
  addLeadNote,
  assignLead,
  changeLeadStatus,
  deleteLead,
  emailLead,
  inviteLeadAsClient,
  markLost,
  setFollowUp,
  updateLeadDetails,
} from "../actions";
import { AssignForm, DeleteLeadForm, EmailForm, FollowUpForm, InviteForm, LeadDetailsForm, LostForm, NoteForm, StatusForm } from "./lead-forms";

export const metadata: Metadata = { title: "Lead" };

const EVENT_LABELS: Record<string, string> = {
  captured: "Form submitted",
  magnet_delivered: "Guide emailed",
  magnet_downloaded: "Guide downloaded",
  email_sent: "Email sent",
  note: "Note",
  status_changed: "Status changed",
  consult_booked: "Consult booked",
  converted: "Became a client",
  page_view: "Page view",
  invited: "Invited to the client portal",
  unsubscribed: "Unsubscribed",
  contact_message: "Sent a message",
};

const EVENT_DOT: Record<string, string> = {
  captured: "bg-brand",
  magnet_downloaded: "bg-emerald-500",
  consult_booked: "bg-violet-500",
  converted: "bg-emerald-600",
  email_sent: "bg-sky-500",
  contact_message: "bg-amber-500",
  unsubscribed: "bg-red-500",
};

function detailText(type: string, detail: Json): string | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const d = detail as Record<string, Json>;
  switch (type) {
    case "note":
      return typeof d.text === "string" ? d.text : null;
    case "contact_message":
      return typeof d.message === "string" ? d.message : null;
    case "status_changed":
      return `${optionLabel(String(d.from ?? ""))} → ${optionLabel(String(d.to ?? ""))}${d.reason ? ` (${String(d.reason)})` : ""}`;
    case "email_sent":
      return [d.subject, d.body].filter((x) => typeof x === "string").join("\n\n") || null;
    case "captured": {
      const bits = [
        d.source ? `via ${optionLabel(String(d.source))}` : null,
        d.utm_campaign ? `campaign ${String(d.utm_campaign)}` : null,
        d.repeat ? "returning" : null,
      ].filter(Boolean);
      return bits.join(" · ") || null;
    }
    case "magnet_delivered":
      return d.emailed === false ? "Email failed to send" : null;
    default:
      return null;
  }
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{value || <span className="text-zinc-400">—</span>}</dd>
    </div>
  );
}

export default async function LeadDetailPage({ params }: PageProps<"/coach/leads/[id]">) {
  const { id } = await params;
  const { profile, business, membership } = await requireStaff();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: lead } = await supabase.from("leads").select("*").eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!lead) notFound();

  const tz = profile.timezone;
  const manager = isManager(membership);
  const admin = createAdminClient();
  const [{ data: events }, { data: bookings }, { data: magnet }, { data: account }, { data: team }] = await Promise.all([
    supabase.from("lead_events").select("*, profiles:created_by(full_name)").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(200),
    supabase
      .from("bookings")
      .select("id, starts_at, status, session_types(name, is_consultation)")
      .eq("business_id", business.id)
      .or(`lead_id.eq.${lead.id},guest_email.eq."${lead.email.replace(/"/g, "")}"${lead.converted_client_id ? `,client_id.eq.${lead.converted_client_id}` : ""}`)
      .order("starts_at", { ascending: false })
      .limit(20),
    lead.lead_magnet_id
      ? supabase.from("lead_magnets").select("id, title, slug").eq("id", lead.lead_magnet_id).eq("business_id", business.id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("profiles").select("id").eq("email", lead.email).maybeSingle(),
    admin
      .from("business_members")
      .select("user_id, active, profiles!business_members_user_id_fkey(full_name, email)")
      .eq("business_id", business.id),
  ]);

  const types = (events ?? []).map((e) => e.type);
  const { score, reasons } = scoreLead(lead, {
    captures: types.filter((t) => t === "captured").length,
    downloadedMagnet: types.includes("magnet_downloaded"),
    consultBooked: types.includes("consult_booked") || (bookings ?? []).some((b) => b.session_types?.is_consultation),
    sentMessage: types.includes("contact_message"),
  });
  const consult = (bookings ?? []).find((b) => b.session_types?.is_consultation);
  const invited = types.includes("invited");
  const lastTouch = (lead.last_touch && typeof lead.last_touch === "object" && !Array.isArray(lead.last_touch) ? lead.last_touch : {}) as Record<string, string>;
  const followUpValue = lead.next_follow_up_at ? formatInTimeZone(lead.next_follow_up_at, tz, "yyyy-MM-dd'T'HH:mm") : "";
  const signature = `${profile.full_name ?? ""}\n${business.name}`.trim();
  const members = team ?? [];
  const nameOf = (userId: string) => {
    const m = members.find((t) => t.user_id === userId);
    return m?.profiles?.full_name || m?.profiles?.email || "Former teammate";
  };
  // An account that's on this team can't become a client here.
  const isStaffAccount = Boolean(account && members.some((m) => m.user_id === account.id));
  const isClientAccount = Boolean(account && !isStaffAccount);
  const assignee = lead.assigned_coach_id;
  const assignOptions: { value: string; label: string }[] = manager
    ? [
        { value: "", label: "Unassigned" },
        ...members.filter((m) => m.active || m.user_id === assignee).map((m) => ({ value: m.user_id, label: nameOf(m.user_id) })),
      ]
    : assignee === null
      ? [
          { value: "", label: "Unassigned" },
          { value: profile.id, label: `${nameOf(profile.id)} (me)` },
        ]
      : assignee === profile.id
        ? [
            { value: profile.id, label: `${nameOf(profile.id)} (me)` },
            { value: "", label: "Unassigned" },
          ]
        : [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/coach/leads" className="text-sm text-zinc-500 hover:text-brand">
          ← All leads
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
              {leadName(lead)} <StatusBadge status={lead.status} /> <ScoreBadge score={lead.score} />
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              <a href={`mailto:${lead.email}`} className="hover:text-brand">
                {lead.email}
              </a>
              {lead.phone ? (
                <>
                  {" · "}
                  <a href={`tel:${lead.phone}`} className="hover:text-brand">
                    {lead.phone}
                  </a>
                </>
              ) : null}
              {" · added "}
              {formatDateTime(lead.created_at, tz, "MMM d, yyyy")}
            </p>
          </div>
          {lead.converted_client_id ? (
            <LinkButton href={`/coach/clients/${lead.converted_client_id}`} variant="outline" size="sm">
              View client profile
            </LinkButton>
          ) : null}
        </div>
      </div>

      {lead.unsubscribed_at ? (
        <Alert tone="amber">
          Unsubscribed from marketing on {formatDateTime(lead.unsubscribed_at, tz, "MMM d, yyyy")}. Only send personal, one-to-one replies.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardTitle>Qualification</CardTitle>
            <div className="mt-4">
              <LeadDetailsForm action={updateLeadDetails.bind(null, lead.id)} lead={lead} />
            </div>
          </Card>

          <Card>
            <CardTitle>Timeline</CardTitle>
            <div className="mt-4">
              <NoteForm action={addLeadNote.bind(null, lead.id)} />
            </div>
            {events?.length ? (
              <ol className="mt-6 space-y-4 border-l border-zinc-200 pl-5 dark:border-zinc-800">
                {events.map((e) => {
                  const text = detailText(e.type, e.detail);
                  return (
                    <li key={e.id} className="relative">
                      <span className={`absolute -left-[1.6rem] top-1.5 size-2.5 rounded-full ring-4 ring-white dark:ring-zinc-900 ${EVENT_DOT[e.type] ?? "bg-zinc-400"}`} aria-hidden="true" />
                      <p className="text-sm font-semibold">
                        {EVENT_LABELS[e.type] ?? titleCase(e.type)}
                        <span className="ml-2 text-xs font-normal text-zinc-500">
                          {formatDateTime(e.created_at, tz)}
                          {e.profiles?.full_name ? ` · ${e.profiles.full_name}` : ""}
                        </span>
                      </p>
                      {text ? <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">{text}</p> : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mt-6 text-sm text-zinc-500">No activity yet.</p>
            )}
          </Card>

          <Card>
            <CardTitle>Send an email</CardTitle>
            <p className="mt-1 text-sm text-zinc-500">Sent from your business address with your email as reply-to. Logged on the timeline.</p>
            <div className="mt-4">
              <EmailForm action={emailLead.bind(null, lead.id)} firstName={lead.first_name} signature={signature} />
            </div>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardTitle>Pipeline</CardTitle>
            <div className="mt-4 space-y-5">
              {members.length > 1 || assignee !== profile.id ? (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Assigned to</p>
                  {assignOptions.length ? (
                    <AssignForm action={assignLead.bind(null, lead.id)} value={assignee} options={assignOptions} />
                  ) : (
                    <p className="text-sm font-medium">{assignee ? nameOf(assignee) : "Unassigned"}</p>
                  )}
                </div>
              ) : null}
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Status</p>
                <StatusForm action={changeLeadStatus.bind(null, lead.id)} status={lead.status} />
                {lead.status === "lost" && lead.lost_reason ? (
                  <p className="mt-2 text-xs text-zinc-500">Lost: {optionLabel(lead.lost_reason.split(":")[0])}{lead.lost_reason.includes(":") ? ` (${lead.lost_reason.split(":").slice(1).join(":").trim()})` : ""}</p>
                ) : null}
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Next follow-up ({tz})</p>
                <FollowUpForm action={setFollowUp.bind(null, lead.id)} value={followUpValue} />
                {lead.last_contacted_at ? (
                  <p className="mt-2 text-xs text-zinc-500">Last contacted {formatDateTime(lead.last_contacted_at, tz)}</p>
                ) : null}
              </div>
              {lead.status !== "lost" && lead.status !== "converted" ? (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400">Mark as lost…</summary>
                  <div className="mt-3">
                    <LostForm action={markLost.bind(null, lead.id)} />
                  </div>
                </details>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardTitle>Client portal</CardTitle>
            <div className="mt-3 space-y-3 text-sm">
              {lead.status === "converted" ? (
                <p className="text-emerald-700 dark:text-emerald-400">
                  Converted{lead.converted_at ? ` on ${formatDateTime(lead.converted_at, tz, "MMM d, yyyy")}` : ""}.
                </p>
              ) : isStaffAccount ? (
                <p className="text-zinc-500">This email belongs to a member of your team.</p>
              ) : (
                <>
                  <p className="text-zinc-500">
                    {isClientAccount
                      ? "They already have an account. Link them as a client and mark this lead converted."
                      : invited
                        ? "Invitation sent. They'll be marked as a client when they first sign in. You can resend it."
                        : "Send an invite to the client portal. They'll be marked as a client when they join."}
                  </p>
                  <InviteForm
                    action={inviteLeadAsClient.bind(null, lead.id)}
                    label={isClientAccount ? "Link as client" : invited ? "Resend invite" : "Invite as client"}
                  />
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardTitle>Bookings</CardTitle>
            <div className="mt-3 text-sm">
              <p className="mb-3">
                Consult:{" "}
                {consult ? (
                  <Badge tone="purple">
                    {titleCase(consult.status)} · {formatDateTime(consult.starts_at, tz, "MMM d, h:mm a")}
                  </Badge>
                ) : types.includes("consult_booked") ? (
                  <Badge tone="purple">Booked</Badge>
                ) : (
                  <span className="text-zinc-500">Not booked yet</span>
                )}
              </p>
              {bookings?.length ? (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {bookings.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 py-2">
                      <span className="min-w-0 truncate">
                        {b.session_types?.name ?? "Session"}
                        <span className="block text-xs text-zinc-500">{formatDateTime(b.starts_at, tz)}</span>
                      </span>
                      <Badge>{titleCase(b.status)}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-zinc-500">No bookings.</p>
              )}
            </div>
          </Card>

          <Card>
            <CardTitle>Score breakdown</CardTitle>
            <p className="mt-1 text-xs text-zinc-500">Recalculated automatically ({score}/100).</p>
            {reasons.length ? (
              <ul className="mt-3 space-y-1 text-sm">
                {reasons.map((r) => (
                  <li key={r.label} className="flex justify-between gap-2">
                    <span>{r.label}</span>
                    <span className={r.points < 0 ? "text-red-600" : "text-emerald-600"}>
                      {r.points > 0 ? "+" : ""}
                      {r.points}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">No signals yet.</p>
            )}
          </Card>

          <Card>
            <CardTitle>Attribution</CardTitle>
            <dl className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
              <Row label="Source" value={sourceLabel(lead.source)} />
              <Row label="Lead magnet" value={magnet ? <Link href={`/coach/lead-magnets/${magnet.id}`} className="text-brand hover:underline">{magnet.title}</Link> : null} />
              <Row label="UTM source" value={lead.utm_source} />
              <Row label="UTM medium" value={lead.utm_medium} />
              <Row label="UTM campaign" value={lead.utm_campaign} />
              {lead.utm_content ? <Row label="UTM content" value={lead.utm_content} /> : null}
              {lead.utm_term ? <Row label="UTM term" value={lead.utm_term} /> : null}
              <Row label="Referrer" value={lead.referrer_url} />
              <Row label="Landing page" value={lead.landing_page} />
              <Row label="First seen" value={formatDateTime(lead.first_seen_at, tz)} />
              {Object.keys(lastTouch).length ? (
                <Row
                  label="Last touch"
                  value={[lastTouch.utm_source, lastTouch.utm_medium, lastTouch.utm_campaign].filter(Boolean).join(" / ") || lastTouch.referrer_url}
                />
              ) : null}
              <Row label="How heard" value={lead.how_heard} />
              <Row label="Country" value={lead.country} />
              <Row label="Device" value={lead.user_agent ? <span title={lead.user_agent}>{deviceLabel(lead.user_agent)}</span> : null} />
            </dl>
          </Card>

          <Card>
            <CardTitle>Consent</CardTitle>
            <dl className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
              <Row label="Marketing emails" value={lead.marketing_consent ? <Badge tone="green">Opted in</Badge> : <Badge>No</Badge>} />
              {lead.consented_at ? <Row label="Consented" value={formatDateTime(lead.consented_at, tz)} /> : null}
              {lead.unsubscribed_at ? <Row label="Unsubscribed" value={formatDateTime(lead.unsubscribed_at, tz)} /> : null}
            </dl>
            {lead.consent_text ? <p className="mt-2 text-xs italic text-zinc-500">&ldquo;{lead.consent_text}&rdquo;</p> : null}
          </Card>

          {manager || assignee === profile.id ? (
            <details className="rounded-2xl border border-red-200 p-4 dark:border-red-900">
              <summary className="cursor-pointer text-sm font-semibold text-red-700 dark:text-red-400">Delete lead</summary>
              <div className="mt-3">
                <DeleteLeadForm action={deleteLead.bind(null, lead.id)} />
              </div>
            </details>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function deviceLabel(ua: string): string {
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : "Other";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  return `${browser} on ${os}`;
}
