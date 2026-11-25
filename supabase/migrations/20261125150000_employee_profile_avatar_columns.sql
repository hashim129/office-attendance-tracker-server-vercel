alter table public.employees
  add column if not exists game_character_id text,
  add column if not exists game_pet_id text;

comment on column public.employees.game_character_id is 'Employee Universe avatar identifier, saved independently of shared device settings.';
comment on column public.employees.game_pet_id is 'Employee Universe pet identifier, saved independently of shared device settings.';
