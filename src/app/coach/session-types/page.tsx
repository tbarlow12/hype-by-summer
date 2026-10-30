import Link from "next/link";
import { Badge, Button, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { CopyButton } from "@/components/scheduling/copy-button";
import { isManager, requireStaff } from "@/lib/auth";
import { businessUrl } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { listCoaches } from "@/lib/scheduling/availability";
import { formatDuration } from "@/lib/format";
import { LOCATION_LABELS, priceLabel } from "@/lib/scheduling/labels";
import { moveSessionTypeAction, toggleSessionTypeAction } from "./actions";

export const metadata = { title: "Session types" };

export default async function SessionTypesPage() {
  const { business, membership } = await requireStaff();
  const manager = isManager(membership);
  const supabase = await createClient();
  const [{ data: types }, coaches] = await Promise.all([
    supabase.from("session_types").select("*").eq("business_id", business.id).order("sort_order").order("name"),
    listCoaches(business.id),
  ]);
  const list = types ?? [];
  const nameOf = new Map(coaches.map((c) => [c.id, c.name]));
  const bookingPage = businessUrl(business, "/book");

  return (
    <>
      <PageHeader
        title="Session types"
        description={`Booking page: ${bookingPage}`}
        actions={
          <>
            <CopyButton text={bookingPage} label="Copy booking page" />
            {manager ? <LinkButton href="/coach/session-types/new">New session type</LinkButton> : null}
          </>
        }
      />
      {list.length === 0 ? (
        <EmptyState
          title="No session types yet"
          description={manager ? "Create the sessions clients can book: 1:1 training, group classes, free consults…" : "A manager hasn't set up any sessions yet."}
          action={manager ? <LinkButton href="/coach/session-types/new">Create one</LinkButton> : undefined}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((st, i) => (
            <li key={st.id}>
              <Card className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-start gap-3">
                  <span className="mt-1.5 size-3 shrink-0 rounded-full" style={{ backgroundColor: st.color }} aria-hidden />
                  <div className="min-w-0">
                    {manager ? (
                      <Link href={`/coach/session-types/${st.id}`} className="font-semibold hover:text-brand">
                        {st.name}
                      </Link>
                    ) : (
                      <span className="font-semibold">{st.name}</span>
                    )}
                    <p className="text-xs text-zinc-500">
                      {st.coach_ids.map((id) => nameOf.get(id)).filter(Boolean).join(", ") || "No active coach"}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge>{formatDuration(st.duration_minutes)}</Badge>
                      <Badge>{priceLabel(st)}</Badge>
                      <Badge>{LOCATION_LABELS[st.location_type]}</Badge>
                      {st.capacity > 1 ? <Badge tone="purple">Group · {st.capacity}</Badge> : null}
                      {st.is_consultation ? <Badge tone="green">Consultation</Badge> : null}
                      {st.clients_only ? <Badge tone="brand">Clients only</Badge> : null}
                      {!st.active ? <Badge tone="amber">Off</Badge> : null}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {manager ? (
                    <>
                      <form action={moveSessionTypeAction}>
                        <input type="hidden" name="id" value={st.id} />
                        <input type="hidden" name="dir" value="up" />
                        <Button type="submit" variant="ghost" size="sm" disabled={i === 0} aria-label={`Move ${st.name} up`}>
                          ↑
                        </Button>
                      </form>
                      <form action={moveSessionTypeAction}>
                        <input type="hidden" name="id" value={st.id} />
                        <input type="hidden" name="dir" value="down" />
                        <Button type="submit" variant="ghost" size="sm" disabled={i === list.length - 1} aria-label={`Move ${st.name} down`}>
                          ↓
                        </Button>
                      </form>
                      <form action={toggleSessionTypeAction}>
                        <input type="hidden" name="id" value={st.id} />
                        <input type="hidden" name="active" value={st.active ? "false" : "true"} />
                        <Button type="submit" variant="outline" size="sm">
                          {st.active ? "Turn off" : "Turn on"}
                        </Button>
                      </form>
                    </>
                  ) : null}
                  <CopyButton text={businessUrl(business, `/book/${st.slug}`)} />
                  {manager ? (
                    <LinkButton href={`/coach/session-types/${st.id}`} variant="ghost" size="sm">
                      Edit
                    </LinkButton>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
