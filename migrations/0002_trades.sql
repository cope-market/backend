-- Trade intents. A row here records what a user meant to do; what actually happened is read from
-- the receipt. The chain is the source of truth for state, this table for intent.
create type trade_action as enum ('open', 'close');
create type trade_status as enum ('pending', 'submitted', 'confirmed', 'failed', 'cancelled', 'expired');

create table trades (
    id                   uuid primary key default gen_random_uuid(),
    user_id              uuid         not null references users (id) on delete cascade,
    action               trade_action not null,
    status               trade_status not null default 'pending',

    feed_id              text         not null,
    is_long              boolean,
    -- uint256 values as exact integers. A bigint column would overflow and a float would round.
    collateral           numeric(78, 0),
    token_id             numeric(78, 0),
    copied_from_token_id numeric(78, 0),

    -- What the user was shown and what they were asked to sign, kept so a dispute can be settled.
    quote_json           jsonb        not null,
    tx_json              jsonb        not null,

    tx_hash              text unique,
    thesis_id            uuid,
    error                text,

    expires_at           timestamptz  not null,
    created_at           timestamptz  not null default now(),
    confirmed_at         timestamptz
);

-- One transaction settles one trade. Without this, a confirm replayed against a second intent
-- would record the same fill twice.
create index trades_user_created_idx on trades (user_id, created_at desc);
create index trades_status_idx on trades (status) where status in ('pending', 'submitted');
