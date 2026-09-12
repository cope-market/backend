-- Cached tweet embeds. X's oEmbed endpoint has no CORS headers so a browser cannot call it, and it
-- rate-limits, so fetching per page view would not survive a demo. One row per URL, fetched once.
create table events (
    id             uuid primary key default gen_random_uuid(),
    tweet_url      text        not null unique,
    author_handle  text        not null,
    author_name    text        not null,
    oembed_html    text        not null,
    fetched_at     timestamptz not null default now()
);

create type thesis_stance as enum ('bullish', 'bearish');

create table theses (
    id                     uuid primary key default gen_random_uuid(),
    user_id                uuid          not null references users (id) on delete cascade,
    event_id               uuid          references events (id),
    feed_id                text          not null,
    stance                 thesis_stance not null,
    title                  text          not null,
    body                   text          not null default '',

    -- Attached when the backing trade confirms. Null until then, because a user writes their take
    -- before they sign. Live P&L is read from the chain with this id and never mirrored here.
    token_id               numeric(78, 0),
    copied_from_thesis_id  uuid          references theses (id),

    -- Denormalised so the feed does not count rows per thesis on every read. Maintained in the same
    -- transaction as the action that changes them.
    like_count             integer       not null default 0,
    comment_count          integer       not null default 0,
    copy_count             integer       not null default 0,

    created_at             timestamptz   not null default now()
);

create index theses_created_idx on theses (created_at desc);
create index theses_user_idx on theses (user_id, created_at desc);
create index theses_copied_from_idx on theses (copied_from_thesis_id);

create table likes (
    user_id    uuid        not null references users (id) on delete cascade,
    thesis_id  uuid        not null references theses (id) on delete cascade,
    created_at timestamptz not null default now(),
    -- One like per person. Makes liking idempotent at the schema level rather than by convention.
    primary key (user_id, thesis_id)
);

create table comments (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid        not null references users (id) on delete cascade,
    thesis_id  uuid        not null references theses (id) on delete cascade,
    body       text        not null,
    created_at timestamptz not null default now()
);

create index comments_thesis_idx on comments (thesis_id, created_at desc);

create table follows (
    follower_id uuid        not null references users (id) on delete cascade,
    followee_id uuid        not null references users (id) on delete cascade,
    created_at  timestamptz not null default now(),
    primary key (follower_id, followee_id),
    -- Following yourself would inflate your own follower count and put your posts in your own
    -- "following" feed twice.
    constraint follows_not_self check (follower_id <> followee_id)
);

create index follows_followee_idx on follows (followee_id);
