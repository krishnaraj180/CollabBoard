/**
 * Evict one user's sockets from tenant rooms and disconnect them.
 * @param {import('socket.io').Server} io
 * @param {string|import('mongoose').Types.ObjectId} organizationId
 * @param {string|import('mongoose').Types.ObjectId} userId
 */
function revokeUser(io, organizationId, userId) {}

/**
 * Evict every socket from an organization and disconnect it.
 * @param {import('socket.io').Server} io
 * @param {string|import('mongoose').Types.ObjectId} organizationId
 */
function revokeOrganization(io, organizationId) {}

/**
 * Grant a user's live sockets access to tenant rooms.
 * @param {import('socket.io').Server} io
 * @param {string|import('mongoose').Types.ObjectId} organizationId
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string[]} rooms
 */
function grantUser(io, organizationId, userId, rooms) {}

module.exports = { revokeUser, revokeOrganization, grantUser };
