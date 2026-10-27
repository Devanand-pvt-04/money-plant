-- Production build (decision 0011): an error log, so a crash on a phone
-- leaves something to debug. The app sends the error's message and stack
-- with numbers taken out, where it happened and the app version: never
-- amounts, payees or SMS text. Phones only add rows; reading them is for the
-- developer in the dashboard.

create table public.app_errors (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message text not null check (length(message) <= 500),
  stack text check (length(stack) <= 4000),
  source text not null check (length(source) <= 60),
  fatal boolean not null default false,
  app_version text check (length(app_version) <= 40),
  update_id text check (length(update_id) <= 64),
  channel text check (length(channel) <= 40),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index app_errors_occurred_idx on public.app_errors (occurred_at desc);
create trigger app_errors_set_updated_at before insert or update on public.app_errors
for each row execute function public.set_updated_at();

alter table public.app_errors enable row level security;

create policy "Users log their own errors" on public.app_errors for insert
to authenticated with check ((select auth.uid()) = user_id);
create policy "Users read their own errors" on public.app_errors for select
to authenticated using ((select auth.uid()) = user_id);
