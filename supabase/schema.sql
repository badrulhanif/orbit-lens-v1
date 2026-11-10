-- Orbit Lens: run once in Supabase → SQL Editor → New query → Run.
-- Only the app's server (secret key) reads or writes these tables; row level
-- security is on with no public policies, so the public API sees nothing.

-- Email alerts for watched places.
create table if not exists public.watches (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  email       text not null check (char_length(email) <= 254),
  place       jsonb not null,           -- name, area, kind, at, bbox, boundary
  token       text not null unique,     -- secret for confirm / unsubscribe links
  confirmed   boolean not null default false,
  snapshot    jsonb,                    -- what was already reported
  last_sent_at timestamptz
);
create index if not exists watches_email on public.watches (email);
create index if not exists watches_confirmed on public.watches (confirmed);
alter table public.watches enable row level security;

-- Reports from the public ("I see flooding here"), checked before showing.
create table if not exists public.community_reports (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  hazard       text not null check (hazard in ('flood', 'landslide', 'storm', 'sinkhole', 'earthquake', 'other')),
  description  text not null check (char_length(description) between 5 and 600),
  latitude     double precision not null check (latitude between -90 and 90),
  longitude    double precision not null check (longitude between -180 and 180),
  precise      boolean not null default false, -- from GPS, or just the area
  occurred_on  date,
  photo_url    text,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reporter     text                     -- hashed IP, for rate limits only
);
create index if not exists reports_status on public.community_reports (status, latitude, longitude);
create index if not exists reports_reporter on public.community_reports (reporter, created_at);
alter table public.community_reports enable row level security;

-- Photos attached to reports (public read, uploads by the server only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', true, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
