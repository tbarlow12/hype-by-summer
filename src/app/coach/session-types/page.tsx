import Link from "next/link";
import { Badge, Button, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { CopyButton } from "@/components/scheduling/copy-button";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/env";
import { formatDuration } from "@/lib/format";
import { LOCATION_LABELS, priceLabel } from "@/lib/scheduling/labels";
import { moveSessionTypeAction, toggleSessionTypeAction } from "./actions";

export const metadata = { title: "Session types" };

export default async function SessionTypesPage() {
  const profile = await requireTrainer();
  const supabase = await createClient();
  const [{ data: types }, { data: store }] = await Promise.all([
    supabase.from("session_types").select("*").eq("trainer_id", profile.id).order("sort_order").order("name"),
    supabase.from("trainer_profiles").select("slug").eq("trainer_id", profile.id).maybeSingle(),
  ]);
  const list = types ?? [];

  return (
    <>
      <PageHeader
        title="Session types"
        description={store ? `Your booking page: ${absoluteUrl(`/book/${store.slug}`)}` : undefined}
        actions={
          <>
            {store ? <CopyButton text={absoluteUrl(`/book/${store.slug}`)} label="Copy booking page" /> : null}
            <LinkButton href="/coach/session-types/new">New session type</LinkButton>
          </>
        }
      />
      {list.length === 0 ? (
        <EmptyState
          title="No session types yet"
          description="Create the sessions clients can book: 1:1 training, group classes, free consults…"
          action={<LinkButton href="/coach/session-types/new">Create one</LinkButton>}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((st, i) => (
            <li key={st.id}>
              <Card className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-start gap-3">
                  <span className="mt-1.5 size-3 shrink-0 rounded-full" style={{ backgroundColor: st.color }} aria-hidden />
                  <div className="min-w-0">
                    <Link href={`/coach/session-types/${st.id}`} className="font-semibold hover:text-brand">
                      {st.name}
                    </Link>
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
                  {store ? <CopyButton text={absoluteUrl(`/book/${store.slug}/${st.slug}`)} /> : null}
                  <LinkButton href={`/coach/session-types/${st.id}`} variant="ghost" size="sm">
                    Edit
                  </LinkButton>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
