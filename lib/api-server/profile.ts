import type {z} from "zod";
import type {Profile, PublicProfile} from "../api-schema/entities";
import type {User} from "../db/users";

/// Maps a stored user onto the wire shape.
///
/// Stats are zeroed for now. Positions come from the chain, and follows and copies come from tables
/// that do not exist yet. The fields are here because the shape is frozen and a client should not
/// have to change when they start carrying real numbers; they are zero rather than absent so a
/// client never has to handle a missing field.
const EMPTY_STATS = {
  openPositions: 0,
  closedPositions: 0,
  realizedPnlUsd: "0",
  followers: 0,
  following: 0,
  copiesReceived: 0,
};

export function toProfile(user: User): z.infer<typeof Profile> {
  return {
    handle: user.xHandle,
    name: user.xName,
    avatarUrl: user.xAvatarUrl,
    walletAddress: user.walletAddress,
    bio: user.bio,
    createdAt: user.createdAt.toISOString(),
    stats: {...EMPTY_STATS},
  };
}

export function toPublicProfile(user: User, viewer: User | null): z.infer<typeof PublicProfile> {
  return {
    ...toProfile(user),
    // Null when nobody is signed in: "not following" and "unknown" are different states and a UI
    // should be able to tell them apart.
    viewer: viewer ? {isFollowing: false, isSelf: viewer.id === user.id} : null,
  };
}
