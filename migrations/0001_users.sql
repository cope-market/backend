-- Users. The Privy identity is the key: a user exists here because they signed in, and the wallet
-- and X handle come from Privy rather than from anything the client sends.
create table users (
    id              uuid primary key default gen_random_uuid(),
    privy_id        text        not null unique,
    x_handle        text        not null unique,
    x_name          text        not null,
    x_avatar_url    text,
    wallet_address  text        not null unique,
    bio             text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- Profiles are looked up by handle from public pages, and by wallet when attributing an on-chain
-- event to a user.
create index users_wallet_address_idx on users (lower(wallet_address));
