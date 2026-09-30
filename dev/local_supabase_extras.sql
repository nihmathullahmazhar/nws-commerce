-- DEV ONLY. Applied after the test shim and the schema to make the local
-- database serve the admin app through PostgREST and dev/server.mjs, the way a
-- Supabase project would. Never pasted into Supabase.

-- The login PostgREST connects as; it switches to anon / authenticated / service_role per request.
do $$ begin
  create role authenticator login noinherit password 'authenticator-local-dev';
exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to authenticator;

alter table auth.users
  add column if not exists encrypted_password text,
  add column if not exists email_confirmed_at timestamptz,
  add column if not exists last_sign_in_at    timestamptz;
create unique index if not exists users_email_uq on auth.users (lower(email));

create or replace function auth.dev_create_user(p_email text, p_password text) returns uuid
language sql as $$
  insert into auth.users (email, encrypted_password, email_confirmed_at)
  values (lower(p_email), extensions.crypt(p_password, extensions.gen_salt('bf', 8)), now())
  returning id
$$;

create or replace function auth.dev_check_password(p_email text, p_password text) returns uuid
language sql stable as $$
  select id from auth.users
   where lower(email) = lower(p_email)
     and encrypted_password = extensions.crypt(p_password, encrypted_password)
$$;
