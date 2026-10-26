-- JobPilot online schema. Deployed by the Supabase GitHub integration on push (or paste into SQL Editor once; safe to re-run).
-- Shared job pool (written only by the fetch-jobs function) + each user's own scores, documents, alerts and contacts.
-- Row-level security: every user reads and writes only rows with their own user_id.

-- ---------- Shared job pool
create table if not exists public.jobs_pool (
  id text primary key, source text not null, title text not null, company text not null default '', location text not null default '',
  remote boolean not null default false, url text not null, description text not null default '', posted_at text not null default '',
  posted timestamptz, company_url text, job_type text, salary text, applicants int, emails text[] not null default '{}',
  fetched_at timestamptz not null default now());
create index if not exists jobs_pool_fetched on public.jobs_pool (fetched_at);
alter table public.jobs_pool enable row level security;
drop policy if exists "signed-in users read the pool" on public.jobs_pool;
create policy "signed-in users read the pool" on public.jobs_pool for select to authenticated using (true);

-- Fetcher state, exchange rates and the scoring corpus (key → JSON).
create table if not exists public.meta (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table public.meta enable row level security;
drop policy if exists "signed-in users read meta" on public.meta;
create policy "signed-in users read meta" on public.meta for select to authenticated using (key in ('fx', 'corpus', 'last_fetch'));

-- ---------- Per-user data
create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null default '{}', synced_at timestamptz);

create table if not exists public.user_jobs (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  job_id text not null references public.jobs_pool on delete cascade,
  score int not null, eligible boolean not null, reasons jsonb not null,
  status text not null default 'new' check (status in ('new', 'saved', 'applied', 'hidden')),
  stage text check (stage in ('applied', 'interview', 'offer', 'rejected')), stage_at timestamptz,
  reviewed boolean not null default false, found_at timestamptz not null default now(),
  primary key (user_id, job_id));
create index if not exists user_jobs_feed on public.user_jobs (user_id, eligible, score);

create table if not exists public.alerts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(), job_id text not null,
  created_at timestamptz not null default now(), read boolean not null default false,
  unique (user_id, job_id), foreign key (user_id, job_id) references public.user_jobs on delete cascade);

create table if not exists public.documents (
  id text primary key check (id ~ '^[a-z0-9]{6,40}$'),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('cv', 'letter')), name text not null check (length(name) <= 80),
  data jsonb not null check (octet_length(data::text) < 1000000), updated_at timestamptz not null default now());

create table if not exists public.recruiters (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null, title text not null default '', company text not null default '', profile_url text, email text,
  job_id text, source text not null,
  status text not null default 'new' check (status in ('new', 'requested', 'connected', 'ignored')),
  found_at timestamptz not null default now(), unique (user_id, email), unique (user_id, profile_url));

do $$ declare t text; begin
  foreach t in array array['profiles', 'user_jobs', 'alerts', 'documents', 'recruiters'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- Read-only joins for the app; security_invoker makes them obey the tables' row-level security.
create or replace view public.my_jobs with (security_invoker = true) as
  select uj.job_id as id, uj.score, uj.eligible, uj.reasons, uj.status, uj.stage, uj.stage_at, uj.reviewed, uj.found_at,
    p.source, p.title, p.company, p.location, p.remote, p.url, p.description, p.posted_at, p.company_url, p.job_type, p.salary, p.applicants,
    coalesce(p.posted, uj.found_at) as posted
  from public.user_jobs uj join public.jobs_pool p on p.id = uj.job_id;

create or replace view public.my_alerts with (security_invoker = true) as
  select a.id, a.read, a.created_at, a.job_id, p.title, p.company, p.location, p.url, uj.score, p.source
  from public.alerts a join public.user_jobs uj using (user_id, job_id) join public.jobs_pool p on p.id = a.job_id;

create or replace view public.my_recruiters with (security_invoker = true) as
  select r.*, p.title as job_title from public.recruiters r left join public.jobs_pool p on p.id = r.job_id;

-- Explicit grants (newer Supabase projects no longer grant API access to new tables by default); RLS still applies.
grant select, insert, update, delete on public.profiles, public.user_jobs, public.alerts, public.documents, public.recruiters to authenticated;
grant select on public.jobs_pool, public.meta, public.my_jobs, public.my_alerts, public.my_recruiters to authenticated;

-- ---------- Sign-up: invite code required, at most 15 accounts
create table if not exists public.invites (code text primary key, used_by uuid, used_at timestamptz);
alter table public.invites enable row level security; -- no policies: only the admin (dashboard) sees codes

create or replace function public.invite_ok(code text) returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.invites i where i.code = invite_ok.code and i.used_by is null)
     and (select count(*) from auth.users) < 15;
$$;
revoke all on function public.invite_ok(text) from public;
grant execute on function public.invite_ok(text) to anon, authenticated;

create or replace function public.claim_invite() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from auth.users) >= 15 then raise exception 'JobPilot is full (15 testers)'; end if;
  update public.invites set used_by = new.id, used_at = now() where code = new.raw_user_meta_data->>'invite' and used_by is null;
  if not found then raise exception 'Invalid or already used invite code'; end if;
  return new;
end $$;
drop trigger if exists claim_invite on auth.users;
create trigger claim_invite before insert on auth.users for each row execute function public.claim_invite();

-- 15 single-use codes; see them in Table Editor → invites.
insert into public.invites (code) select substr(md5(random()::text), 1, 8) from generate_series(1, 15)
  where not exists (select 1 from public.invites);

-- A user deletes their own account (all their rows go with it).
create or replace function public.delete_me() returns void language sql security definer set search_path = public as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_me() from public;
grant execute on function public.delete_me() to authenticated;

-- ---------- Fetcher helpers (service role only)
-- Insert new jobs; a refetch fills in what the first fetch missed and keeps the longer description.
create or replace function public.upsert_pool(jobs jsonb) returns int language sql security definer set search_path = public as $$
  with r as (
    insert into public.jobs_pool as p (id, source, title, company, location, remote, url, description, posted_at, posted, company_url, job_type, salary, applicants, emails)
    select id, source, title, coalesce(company, ''), coalesce(location, ''), coalesce(remote, false), url, coalesce(description, ''), coalesce(posted_at, ''),
      posted, company_url, job_type, salary, applicants, coalesce(emails, '{}')
    from jsonb_to_recordset(jobs) as x(id text, source text, title text, company text, location text, remote boolean, url text, description text,
      posted_at text, posted timestamptz, company_url text, job_type text, salary text, applicants int, emails text[])
    on conflict (id) do update set company_url = coalesce(excluded.company_url, p.company_url), job_type = coalesce(excluded.job_type, p.job_type),
      salary = coalesce(excluded.salary, p.salary), applicants = coalesce(excluded.applicants, p.applicants),
      description = case when length(excluded.description) > length(p.description) then excluded.description else p.description end
    returning 1)
  select count(*)::int from r;
$$;

-- Jobs older than 30 days go, unless someone saved or applied to them; contacts nobody acted on go after 90 days.
create or replace function public.prune_pool() returns void language sql security definer set search_path = public as $$
  delete from public.jobs_pool p where p.fetched_at < now() - interval '30 days'
    and not exists (select 1 from public.user_jobs u where u.job_id = p.id and u.status in ('saved', 'applied'));
  delete from public.recruiters where status in ('new', 'ignored') and found_at < now() - interval '90 days';
$$;
revoke all on function public.upsert_pool(jsonb) from public, anon, authenticated;
revoke all on function public.prune_pool() from public, anon, authenticated;
