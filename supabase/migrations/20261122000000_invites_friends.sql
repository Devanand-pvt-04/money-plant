-- Friends release (decision 0016): sign-up by invite only (ACC-8) and friend
-- links (ACC-9).
--
-- An invite is an email a member let in. Members invite up to 5 people; an
-- admin (app_metadata.role = 'admin', set from the dashboard, never by the
-- app) invites any number. A new sign-in is created only for an email with an
-- open invite, and that invite then links the inviter and the new member as
-- friends.
--
-- A friend link is one row both people can see. The requester writes their
-- own name and UPI ID; the friend answers through respond_friend_link, which
-- writes only the friend's side. Either side can unlink. Each phone turns an
-- accepted link into a person account with the other's name, email and UPI ID.

-- ---- Who is an admin ----

create function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select auth.jwt())->'app_metadata'->>'role' = 'admin', false);
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---- Invites ----

create table public.invites (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and length(email) <= 254),
  -- Set by the server when the invited person signs up.
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index invites_open_email_idx on public.invites (user_id, email) where deleted_at is null;
create index invites_email_idx on public.invites (email) where deleted_at is null and used_at is null;
create index invites_user_updated_idx on public.invites (user_id, updated_at);
create trigger invites_set_updated_at before insert or update on public.invites
for each row execute function public.set_updated_at();

-- Updates from the app may only withdraw an open invite (deleted_at). New
-- invites come only through invite_friend below. Runs as the caller, so
-- current_user tells the app (authenticated) from the server's own functions.
create function public.invites_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if old.used_at is not null or old.deleted_at is not null then
    raise exception 'invite already used or withdrawn' using errcode = 'P0001', hint = 'invite_closed';
  end if;
  new.email := old.email;
  new.user_id := old.user_id;
  new.used_at := old.used_at;
  new.used_by := old.used_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger invites_guard before update on public.invites
for each row execute function public.invites_guard();

alter table public.invites enable row level security;

create policy "Users read their own invites" on public.invites for select
to authenticated using ((select auth.uid()) = user_id);
create policy "Users withdraw their own invites" on public.invites for update
to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.invites from anon;
revoke all on public.invites from authenticated;
grant select, update on public.invites to authenticated;

-- ---- Friend links ----

create table public.friend_links (
  id uuid primary key,
  -- The requester: the inviter, or whoever sent the request.
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  requester_email text,
  requester_name text check (length(requester_name) <= 80),
  requester_vpa text check (length(requester_vpa) <= 256),
  friend_email text not null check (friend_email = lower(friend_email) and length(friend_email) <= 254),
  -- Only respond_friend_link and the sign-up link write these.
  friend_user_id uuid references auth.users (id) on delete cascade,
  friend_name text check (length(friend_name) <= 80),
  friend_vpa text check (length(friend_vpa) <= 256),
  accepted_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (requester_email is distinct from friend_email)
);

create unique index friend_links_open_pair_idx on public.friend_links (user_id, friend_email) where deleted_at is null;
create index friend_links_user_updated_idx on public.friend_links (user_id, updated_at);
create index friend_links_friend_user_idx on public.friend_links (friend_user_id, updated_at);
create index friend_links_friend_email_idx on public.friend_links (friend_email, updated_at);
create trigger friend_links_set_updated_at before insert or update on public.friend_links
for each row execute function public.set_updated_at();

-- The requester writes only their own name and UPI ID, and unlinks with
-- deleted_at. Their email comes from their sign-in.
create function public.friend_links_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.requester_email := lower((select auth.jwt())->>'email');
    new.friend_user_id := null;
    new.friend_name := null;
    new.friend_vpa := null;
    new.accepted_at := null;
    new.declined_at := null;
    new.deleted_at := null;
    return new;
  end if;
  new.user_id := old.user_id;
  new.requester_email := old.requester_email;
  new.friend_email := old.friend_email;
  new.friend_user_id := old.friend_user_id;
  new.friend_name := old.friend_name;
  new.friend_vpa := old.friend_vpa;
  new.accepted_at := old.accepted_at;
  new.declined_at := old.declined_at;
  -- An unlinked link stays unlinked; a new request makes a new row.
  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  end if;
  return new;
end;
$$;

create trigger friend_links_guard before insert or update on public.friend_links
for each row execute function public.friend_links_guard();

alter table public.friend_links enable row level security;

create policy "People read links they are part of" on public.friend_links for select
to authenticated using (
  (select auth.uid()) = user_id
  or (select auth.uid()) = friend_user_id
  or friend_email = lower((select auth.jwt())->>'email')
);
create policy "Users send their own friend requests" on public.friend_links for insert
to authenticated with check ((select auth.uid()) = user_id);
create policy "Requesters update their own links" on public.friend_links for update
to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.friend_links from anon;
revoke truncate, trigger, references, delete on public.friend_links from authenticated;
grant select, insert, update on public.friend_links to authenticated;

-- The friend accepts or declines, and keeps their name and UPI ID current.
-- Calling it again with p_accept true after accepting only updates the details.
create function public.respond_friend_link(p_id uuid, p_accept boolean, p_name text, p_vpa text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  my_email text := lower((select auth.jwt())->>'email');
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  update public.friend_links l set
    friend_user_id = me,
    friend_name = left(nullif(trim(p_name), ''), 80),
    friend_vpa = left(nullif(trim(p_vpa), ''), 256),
    accepted_at = case when p_accept then coalesce(l.accepted_at, now()) else null end,
    declined_at = case when p_accept then null else now() end
  where l.id = p_id
    and l.deleted_at is null
    and l.user_id <> me
    and (l.friend_user_id = me or (l.friend_user_id is null and l.friend_email = my_email));
  if not found then
    raise exception 'friend link % is not yours', p_id using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.respond_friend_link(uuid, boolean, text, text) from public, anon;
grant execute on function public.respond_friend_link(uuid, boolean, text, text) to authenticated;

-- Either side ends the link. The person accounts and IOUs on each phone stay.
create function public.unlink_friend(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  my_email text := lower((select auth.jwt())->>'email');
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  update public.friend_links l set deleted_at = now()
  where l.id = p_id and l.deleted_at is null
    and (l.user_id = me or l.friend_user_id = me or (l.friend_user_id is null and l.friend_email = my_email));
  if not found then
    raise exception 'friend link % is not yours', p_id using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.unlink_friend(uuid) from public, anon;
grant execute on function public.unlink_friend(uuid) to authenticated;

-- ACC-8 and ACC-9 in one call: invite an email, or, when that person is
-- already a member, send them a friend request instead. Returns 'invited',
-- 'requested' or 'already_linked'. The answer tells a member whether an email
-- they typed belongs to a member, which the friend request would show anyway.
-- Members have at most 5 open or used invites; admins have no limit.
create function public.invite_friend(p_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  my_email text := lower((select auth.jwt())->>'email');
  meta jsonb := coalesce((select auth.jwt())->'user_metadata', '{}'::jsonb);
  target text := lower(trim(p_email));
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if target is null or target !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(target) > 254 then
    raise exception 'not an email' using errcode = '22023', hint = 'bad_email';
  end if;
  if target = my_email then
    raise exception 'that is you' using errcode = '22023', hint = 'self';
  end if;
  if exists (
    select 1 from public.friend_links l
    where l.deleted_at is null
      and ((l.user_id = me and l.friend_email = target)
        or (l.requester_email = target and (l.friend_user_id = me or l.friend_email = my_email)))
  ) then
    return 'already_linked';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = target) then
    insert into public.friend_links (id, user_id, requester_email, requester_name, requester_vpa, friend_email)
    values (p_id, me, my_email, left(nullif(meta->>'name', ''), 80), left(nullif(meta->>'vpa', ''), 256), target);
    return 'requested';
  end if;
  if exists (select 1 from public.invites i where i.user_id = me and i.email = target and i.deleted_at is null) then
    return 'invited';
  end if;
  if not public.is_admin() and (
    select count(*) from public.invites i where i.user_id = me and i.deleted_at is null
  ) >= 5 then
    raise exception 'invite limit reached' using errcode = 'P0001', hint = 'invite_limit';
  end if;
  insert into public.invites (id, user_id, email) values (p_id, me, target);
  return 'invited';
end;
$$;

revoke all on function public.invite_friend(uuid, text) from public, anon;
grant execute on function public.invite_friend(uuid, text) to authenticated;

-- ---- The door: only invited emails become members ----

-- Runs as the auth service when a sign-in is first created. Users who exist
-- already are untouched; an email with no open invite is refused, and the
-- app shows "ask a friend to invite you".
create function public.require_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or not exists (
    select 1 from public.invites i
    where i.email = lower(new.email) and i.deleted_at is null and i.used_at is null
  ) then
    raise exception 'not invited' using errcode = 'P0001', hint = 'not_invited';
  end if;
  return new;
end;
$$;

-- After the sign-in exists: close the invites for that email and link the new
-- member with each inviter, already accepted (signing up is the answer).
create function public.use_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv record;
begin
  for inv in
    update public.invites i set used_at = now(), used_by = new.id
    where i.email = lower(new.email) and i.deleted_at is null and i.used_at is null
    returning i.user_id
  loop
    insert into public.friend_links (id, user_id, requester_email, requester_name, requester_vpa, friend_email, friend_user_id, accepted_at)
    select gen_random_uuid(), u.id, lower(u.email), left(u.raw_user_meta_data->>'name', 80), left(u.raw_user_meta_data->>'vpa', 256),
           lower(new.email), new.id, now()
    from auth.users u
    where u.id = inv.user_id
    on conflict (user_id, friend_email) where deleted_at is null do nothing;
  end loop;
  return new;
end;
$$;

revoke all on function public.require_invite() from public, anon, authenticated;
revoke all on function public.use_invite() from public, anon, authenticated;

create trigger require_invite before insert on auth.users
for each row execute function public.require_invite();
create trigger use_invite after insert on auth.users
for each row execute function public.use_invite();
