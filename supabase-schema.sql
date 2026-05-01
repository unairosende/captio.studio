-- Run this in your Supabase SQL editor (Dashboard → SQL Editor)

create table if not exists profiles (
  id                uuid references auth.users on delete cascade primary key,
  email             text,
  stripe_customer_id text,
  created_at        timestamptz default now()
);

create table if not exists subscriptions (
  id                 text primary key,  -- Stripe subscription ID
  user_id            uuid references profiles(id) on delete cascade,
  status             text not null,     -- active | canceled | past_due | trialing
  plan               text not null,     -- individual | team
  current_period_end timestamptz,
  created_at         timestamptz default now()
);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- RLS
alter table profiles      enable row level security;
alter table subscriptions enable row level security;

create policy "Users can read own profile"      on profiles      for select using (auth.uid() = id);
create policy "Users can read own subscription" on subscriptions for select using (auth.uid() = user_id);
