create table if not exists public.duck_min_quan_scores (
  player_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(btrim(nickname)) between 2 and 24),
  score integer not null check (score >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.duck_min_quan_profiles (
  player_id uuid primary key references auth.users(id) on delete cascade,
  avatar_url text not null check (avatar_url = 'https://duongquandz15-web.github.io/duck-minh-quan/assets/leaderboard-avatar.png'),
  updated_at timestamptz not null default now()
);

alter table public.duck_min_quan_scores enable row level security;
revoke all on table public.duck_min_quan_scores from anon, authenticated;
alter table public.duck_min_quan_profiles enable row level security;
revoke all on table public.duck_min_quan_profiles from anon, authenticated;

create or replace function public.submit_duck_min_quan_score(
  p_score integer,
  p_nickname text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player_id uuid := auth.uid();
  clean_nickname text := btrim(p_nickname);
begin
  if v_player_id is null then
    raise exception 'Sign in is required to submit a score.';
  end if;
  if p_score is null or p_score < 0 then
    raise exception 'Score must be a non-negative integer.';
  end if;
  if clean_nickname is null or char_length(clean_nickname) not between 2 and 24 then
    raise exception 'Nickname must contain 2 to 24 characters.';
  end if;

  insert into public.duck_min_quan_scores (player_id, nickname, score)
  values (v_player_id, clean_nickname, p_score)
  on conflict (player_id) do update
  set nickname = excluded.nickname,
      score = greatest(public.duck_min_quan_scores.score, excluded.score),
      updated_at = case
        when excluded.score > public.duck_min_quan_scores.score then now()
        else public.duck_min_quan_scores.updated_at
      end;
end;
$$;

create or replace function public.set_duck_min_quan_avatar(p_avatar_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player_id uuid := auth.uid();
begin
  if v_player_id is null then
    raise exception 'Sign in is required to set a leaderboard avatar.';
  end if;
  if p_avatar_url is distinct from 'https://duongquandz15-web.github.io/duck-minh-quan/assets/leaderboard-avatar.png' then
    raise exception 'Avatar URL is not allowed.';
  end if;

  insert into public.duck_min_quan_profiles (player_id, avatar_url)
  values (v_player_id, p_avatar_url)
  on conflict (player_id) do update
  set avatar_url = excluded.avatar_url,
      updated_at = now();
end;
$$;

drop function if exists public.get_duck_min_quan_leaderboard();
create function public.get_duck_min_quan_leaderboard()
returns table (
  rank bigint,
  nickname text,
  score integer,
  updated_at timestamptz,
  avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select ranked.rank, ranked.nickname, ranked.score, ranked.updated_at, ranked.avatar_url
  from (
    select
      row_number() over (order by scores.score desc, scores.updated_at asc) as rank,
      scores.nickname,
      scores.score,
      scores.updated_at,
      profiles.avatar_url
    from public.duck_min_quan_scores as scores
    left join public.duck_min_quan_profiles as profiles on profiles.player_id = scores.player_id
    order by scores.score desc, scores.updated_at asc
    limit 100
  ) as ranked
  order by ranked.rank;
$$;

revoke all on function public.submit_duck_min_quan_score(integer, text) from public, anon, authenticated;
revoke all on function public.set_duck_min_quan_avatar(text) from public, anon, authenticated;
revoke all on function public.get_duck_min_quan_leaderboard() from public, anon, authenticated;
grant execute on function public.submit_duck_min_quan_score(integer, text) to authenticated;
grant execute on function public.set_duck_min_quan_avatar(text) to authenticated;
grant execute on function public.get_duck_min_quan_leaderboard() to anon, authenticated;

notify pgrst, 'reload schema';
