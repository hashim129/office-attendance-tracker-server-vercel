-- Media Team weekly posting calendar: one row per planned social media post.
create table if not exists public.crm_media_posts (
  id text primary key,
  post_date date not null,
  post_time text not null default '',
  platform text not null,
  kind text not null default 'post',
  title text not null default '',
  caption text not null default '',
  assignee text,
  status text not null default 'planned',
  link text not null default '',
  notes text not null default '',
  created_by text,
  posted_at timestamptz,
  posted_by text,
  reminded text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_media_posts_date_idx on public.crm_media_posts (post_date);
alter table public.crm_media_posts enable row level security;
