-- Several UPI IDs and a phone number for one person (decision 0021; IOU-3,
-- IOU-4). A person's `vpa` stays the one used to pay them. `extra_vpas` are
-- their other UPI IDs, and `phone` their 10-digit mobile number, used only to
-- recognise their payments (a UPI ID such as 98xxxxxx10@ybl carries it). The
-- user's own other UPI IDs and phone live in their sign-in's user_metadata
-- (`extra_vpas`, `phone`) and reach friends through the friend link, like
-- their main UPI ID.

-- At most 10, each a lower-case UPI ID.
create function public.valid_extra_vpas(p_vpas text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_vpas is not null
     and cardinality(p_vpas) <= 10
     and coalesce(bool_and(v = lower(v) and v ~ '^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$'), true)
  from unnest(p_vpas) v;
$$;

revoke all on function public.valid_extra_vpas(text[]) from public, anon;
grant execute on function public.valid_extra_vpas(text[]) to authenticated;

-- ---- People ----

alter table public.accounts
  add column extra_vpas text[] not null default '{}' check (public.valid_extra_vpas(extra_vpas)),
  add column phone text check (phone ~ '^[6-9][0-9]{9}$');
alter table public.accounts drop constraint accounts_person_fields_check;
alter table public.accounts add constraint accounts_person_fields_check
  check (type = 'person' or (vpa is null and email is null and phone is null and cardinality(extra_vpas) = 0));

-- ---- Friend links: each side's extra UPI IDs ----

alter table public.friend_links
  add column requester_extra_vpas text[] not null default '{}' check (public.valid_extra_vpas(requester_extra_vpas)),
  add column friend_extra_vpas text[] not null default '{}' check (public.valid_extra_vpas(friend_extra_vpas)),
  add column requester_phone text check (requester_phone ~ '^[6-9][0-9]{9}$'),
  add column friend_phone text check (friend_phone ~ '^[6-9][0-9]{9}$');

-- As before, plus: the requester writes only their own extra UPI IDs.
create or replace function public.friend_links_guard()
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
    new.friend_extra_vpas := '{}';
    new.friend_phone := null;
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
  new.friend_extra_vpas := old.friend_extra_vpas;
  new.friend_phone := old.friend_phone;
  new.accepted_at := old.accepted_at;
  new.declined_at := old.declined_at;
  -- An unlinked link stays unlinked; a new request makes a new row.
  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  end if;
  return new;
end;
$$;

-- The friend's answer, now with their other UPI IDs and phone. The
-- four-argument version stays for phones without this update; it leaves
-- those alone.
create function public.respond_friend_link(p_id uuid, p_accept boolean, p_name text, p_vpa text, p_extra_vpas text[], p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not public.valid_extra_vpas(coalesce(p_extra_vpas, '{}')) then
    raise exception 'not valid UPI IDs' using errcode = '22023';
  end if;
  if p_phone is not null and p_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'not a mobile number' using errcode = '22023';
  end if;
  perform public.respond_friend_link(p_id, p_accept, p_name, p_vpa);
  update public.friend_links l set friend_extra_vpas = coalesce(p_extra_vpas, '{}'), friend_phone = p_phone
  where l.id = p_id and l.friend_user_id = me;
end;
$$;

revoke all on function public.respond_friend_link(uuid, boolean, text, text, text[], text) from public, anon;
grant execute on function public.respond_friend_link(uuid, boolean, text, text, text[], text) to authenticated;
