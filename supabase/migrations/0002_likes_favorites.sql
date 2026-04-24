-- Likes + Favorites + ranking counters
-- Likes are a public signal (affect catalog ranking).
-- Favorites are personal bookmarks.

-- =========================================================================
-- Tables
-- =========================================================================

create table if not exists public.filter_likes (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  filter_id uuid not null references public.filters(id)  on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, filter_id)
);

create table if not exists public.filter_favorites (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  filter_id uuid not null references public.filters(id)  on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, filter_id)
);

create index if not exists filter_likes_filter_idx    on public.filter_likes    (filter_id);
create index if not exists filter_favs_user_idx       on public.filter_favorites (user_id);
create index if not exists filter_favs_filter_idx     on public.filter_favorites (filter_id);

-- =========================================================================
-- Denormalized counters on filters
-- =========================================================================

alter table public.filters
  add column if not exists likes_count int not null default 0,
  add column if not exists uses_count  int not null default 0;

-- =========================================================================
-- Trigger: maintain likes_count on filter_likes insert/delete
-- =========================================================================

create or replace function public.bump_filter_likes()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update public.filters set likes_count = likes_count + 1 where id = new.filter_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.filters set likes_count = greatest(0, likes_count - 1) where id = old.filter_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists bump_filter_likes_trg on public.filter_likes;
create trigger bump_filter_likes_trg
after insert or delete on public.filter_likes
for each row execute function public.bump_filter_likes();

-- =========================================================================
-- Trigger: maintain uses_count on generations
-- Only counts generations where user_id != filter.owner_id (no self-boost)
-- Increments on first transition to 'done' status
-- =========================================================================

create or replace function public.bump_filter_uses()
returns trigger
language plpgsql
as $$
declare
  filter_owner uuid;
begin
  -- Only bump when we newly reach status='done' and have a filter_id
  if new.filter_id is null or new.status <> 'done' then
    return new;
  end if;

  -- On UPDATE, skip if it was already 'done' (no double-count)
  if tg_op = 'UPDATE' and old.status = 'done' then
    return new;
  end if;

  select owner_id into filter_owner from public.filters where id = new.filter_id;
  if filter_owner is not null and filter_owner <> new.user_id then
    update public.filters set uses_count = uses_count + 1 where id = new.filter_id;
  end if;
  return new;
end;
$$;

drop trigger if exists bump_filter_uses_trg on public.generations;
create trigger bump_filter_uses_trg
after insert or update of status on public.generations
for each row execute function public.bump_filter_uses();

-- =========================================================================
-- RPC: ranked public filters with time decay
-- Formula: score = (likes*3 + uses) / (hours_since_created + 2)^1.5
-- Recent hot filters bubble up; old ones decay unless still getting activity.
-- =========================================================================

create or replace function public.filters_top(p_limit int default 100)
returns setof public.filters
language sql
stable
as $$
  select f.*
  from public.filters f
  where f.visibility = 'public'
  order by
    (f.likes_count * 3 + f.uses_count)::float
    / power( extract(epoch from (now() - f.created_at))/3600.0 + 2.0, 1.5 )
    desc,
    f.created_at desc
  limit p_limit;
$$;

-- =========================================================================
-- RLS policies
-- =========================================================================

alter table public.filter_likes     enable row level security;
alter table public.filter_favorites enable row level security;

-- Likes: users can insert/delete their own; anyone can see (to compute liked_by_me)
drop policy if exists "likes_own_write" on public.filter_likes;
create policy "likes_own_write" on public.filter_likes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "likes_read_all" on public.filter_likes;
create policy "likes_read_all" on public.filter_likes
  for select using (true);

-- Favorites: only the user themselves can read/write their own
drop policy if exists "favs_own" on public.filter_favorites;
create policy "favs_own" on public.filter_favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
