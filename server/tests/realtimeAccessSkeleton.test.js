const { grantUser, revokeUser, revokeOrganization, revokeSession } = require("../src/services/realtimeAccess");

function fakeIo() {
  const calls = [];
  return {
    calls,
    in(room) {
      return {
        async socketsJoin(rooms) { calls.push({ op: "join", room, rooms }); },
        async socketsLeave(rooms) { calls.push({ op: "leave", room, rooms }); },
        async disconnectSockets(force) { calls.push({ op: "disconnect", room, force }); },
        async fetchSockets() { return [{ id: "socket-1", rooms: new Set([room, "org:o1:project:p1"]) }]; },
      };
    },
    async fetchSockets() { return [{ id: "socket-1", rooms: new Set(["org:o1:project:p1"]) }]; },
  };
}

test("grant and revoke use adapter room operations without a socket registry", async () => {
  const io = fakeIo();
  await grantUser(io, "o1", "u1", ["org:o1:project:p1"]);
  await revokeUser(io, "o1", "u1", ["org:o1:project:p1"]);
  await revokeOrganization(io, "o1");
  await revokeSession(io, "s1");
  expect(io.calls).toEqual([
    { op: "join", room: "user:u1", rooms: ["org:o1:project:p1"] },
    { op: "leave", room: "socket-1", rooms: ["org:o1:project:p1"] },
    { op: "disconnect", room: "socket-1", force: true },
    { op: "disconnect", room: "session:s1", force: true },
  ]);
});
