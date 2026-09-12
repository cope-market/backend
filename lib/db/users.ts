import type {Pool} from "pg";

/// User records. The Privy identity is the key: a row exists because somebody signed in, and the
/// handle, name, avatar and wallet are whatever Privy reports now.

export interface User {
  id: string;
  privyId: string;
  xHandle: string;
  xName: string;
  xAvatarUrl: string | null;
  walletAddress: string;
  bio: string | null;
  createdAt: Date;
}

export interface PrivyIdentity {
  privyId: string;
  xHandle: string;
  xName: string;
  xAvatarUrl: string | null;
  walletAddress: string;
}

interface UserRow {
  id: string;
  privy_id: string;
  x_handle: string;
  x_name: string;
  x_avatar_url: string | null;
  wallet_address: string;
  bio: string | null;
  created_at: Date;
}

const COLUMNS = `id, privy_id, x_handle, x_name, x_avatar_url, wallet_address, bio, created_at`;

function toUser(row: UserRow): User {
  return {
    id: row.id,
    privyId: row.privy_id,
    xHandle: row.x_handle,
    xName: row.x_name,
    xAvatarUrl: row.x_avatar_url,
    walletAddress: row.wallet_address,
    bio: row.bio,
    createdAt: row.created_at,
  };
}

/// Called on every sign-in. Creates the user the first time and refreshes what Privy owns after
/// that. Bio is deliberately not touched: it is ours, and a sign-in must not wipe what the user
/// wrote.
export async function upsertUser(pool: Pool, identity: PrivyIdentity): Promise<User> {
  const {rows} = await pool.query<UserRow>(
    `insert into users (privy_id, x_handle, x_name, x_avatar_url, wallet_address)
     values ($1, $2, $3, $4, $5)
     on conflict (privy_id) do update
       set x_handle      = excluded.x_handle,
           x_name        = excluded.x_name,
           x_avatar_url  = excluded.x_avatar_url,
           wallet_address = excluded.wallet_address,
           updated_at    = now()
     returning ${COLUMNS}`,
    [
      identity.privyId,
      identity.xHandle,
      identity.xName,
      identity.xAvatarUrl,
      identity.walletAddress,
    ],
  );
  return toUser(rows[0]!);
}

export async function findUserByPrivyId(pool: Pool, privyId: string): Promise<User | null> {
  const {rows} = await pool.query<UserRow>(`select ${COLUMNS} from users where privy_id = $1`, [
    privyId,
  ]);
  return rows[0] ? toUser(rows[0]) : null;
}

/// Handles are compared case-insensitively. X treats "Alice" and "alice" as the same account, and a
/// profile URL a user types by hand will not match the stored casing.
export async function findUserByHandle(pool: Pool, handle: string): Promise<User | null> {
  const {rows} = await pool.query<UserRow>(
    `select ${COLUMNS} from users where lower(x_handle) = lower($1)`,
    [handle],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function updateUserBio(
  pool: Pool,
  userId: string,
  bio: string | null,
): Promise<User | null> {
  const {rows} = await pool.query<UserRow>(
    `update users set bio = $2, updated_at = now() where id = $1 returning ${COLUMNS}`,
    [userId, bio],
  );
  return rows[0] ? toUser(rows[0]) : null;
}
