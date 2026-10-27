-- SMS (Twilio): per-booking consent for guests, a delivery log, and opt-outs.

alter table public.bookings add column sms_opt_in boolean not null default false;

create table public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  to_phone text not null,
  profile_id uuid references public.profiles (id) on delete set null,
  booking_id uuid references public.bookings (id) on delete set null,
  kind text not null,                 -- reminder | confirmation | cancellation | other
  body text not null,
  twilio_sid text unique,
  status text not null default 'queued',  -- queued | sent | delivered | failed | undelivered | skipped
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.sms_messages (booking_id);
create trigger sms_messages_updated before update on public.sms_messages
  for each row execute function public.set_updated_at();
alter table public.sms_messages enable row level security;
create policy "sms: trainer reads own bookings" on public.sms_messages for select
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.trainer_id = auth.uid()));

-- Numbers that replied STOP; never text them until they reply START.
create table public.sms_opt_outs (
  phone text primary key,             -- E.164
  opted_out_at timestamptz not null default now()
);
alter table public.sms_opt_outs enable row level security;  -- service role only
