const { emitToWorkspace, emitToChannel, emitToUser, room, legacyRoom } = require("../src/sockets/realtimeEmit");

function fakeIo() {
  const calls = [];
  const makeBuilder = (target) => ({
    except(value) {
      calls.push({ type: "except", target, value });
      return this;
    },
    emit(event, payload) {
      calls.push({ type: "emit", target, event, payload });
    },
  });
  return {
    calls,
    to(target) {
      return makeBuilder(target);
    },
    in(target) {
      return makeBuilder(target);
    },
  };
}

test("resource emitters build scoped and legacy rooms from loaded resources", () => {
  const io = fakeIo();
  const workspace = { _id: "w1", organizationId: "o1" };
  const channel = { _id: "c1", organizationId: "o1" };
  emitToWorkspace(io, workspace, "workspace:event", { ok: true });
  emitToChannel(io, channel, "channel:event", { ok: true });
  expect(room("workspace", "w1", "o1")).toBe("org:o1:workspace:w1");
  expect(legacyRoom("workspace", "w1")).toBe("workspace:w1");
  expect(io.calls.filter((call) => call.type === "emit").map((call) => call.target)).toEqual([
    ["org:o1:workspace:w1", "workspace:w1"],
    ["org:o1:channel:c1", "channel:c1"],
  ]);
});

test("personal events use only the user room", () => {
  const io = fakeIo();
  emitToUser(io, "u1", "notification:new", { organizationId: "o1" });
  expect(io.calls).toEqual([{ type: "emit", target: "user:u1", event: "notification:new", payload: { organizationId: "o1" } }]);
});
