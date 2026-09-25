import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { parseAnswer, buildPrompt } from "../server/ai.mjs";

const proposal = {
  title: "알림 설정",
  requirements: [
    {
      title: "알림 끄기",
      body: "알림을 끄면 발송하지 않는다.",
      criteria: ["비활성 계정에 메일을 보내지 않는다."],
    },
  ],
};
test("new spec proposals validate required fields and remain distinct from requirement proposals", () => {
  const response = {
    message: "검토 후 추가하세요.",
    proposal: null,
    specProposal: proposal,
    files: [],
  };
  assert.deepEqual(
    parseAnswer(JSON.stringify(response), "discuss").specProposal,
    proposal,
  );
  assert.equal(
    parseAnswer(JSON.stringify(response), "developer").specProposal,
    null,
  );
  assert.throws(() =>
    parseAnswer(
      JSON.stringify({
        ...response,
        specProposal: { title: "X", requirements: [] },
      }),
      "discuss",
    ),
  );
});

for (const databaseUrl of ["", "sqlite:spec-proposals.sqlite"])
  test(`adding a proposed spec checks ownership, editor role, revision and duplicate requests (${databaseUrl || "file"})`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-spec-proposal-"));
    let store;
    try {
      store = await Store.open(dir, { databaseUrl });
      store.db.users.push(
        ...["u", "viewer", "editor"].map((id) => ({ id, name: id, login: id })),
      );
      let workspace = await store.create("u", "테스트");
      workspace.members.push(
        { userId: "viewer", role: "viewer" },
        { userId: "editor", role: "editor" },
      );
      const message = {
        id: "proposal-message",
        workspaceId: workspace.id,
        userId: "u",
        role: "assistant",
        specId: null,
        specProposal: proposal,
      };
      store.db.chats.push(message);
      const base = workspace.head;
      await assert.rejects(
        store.addSpecProposal(workspace.id, "viewer", message.id, base),
        { status: 403 },
      );
      await assert.rejects(
        store.addSpecProposal(workspace.id, "editor", message.id, base),
        { status: 404 },
      );
      await assert.rejects(
        store.addSpecProposal(workspace.id, "u", message.id, "old"),
        { status: 409 },
      );
      const prompt = buildPrompt({
        document: workspace.document,
        specId: null,
        role: "discuss",
        message: "알림 명세 추가해줘",
        history: [],
        selectedFiles: [],
      });
      assert(prompt.includes("specProposal"));
      await store.addSpecProposal(workspace.id, "u", message.id, base);
      assert.equal(workspace.document.specs.length, 1);
      const added = workspace.document.specs[0];
      assert.equal(added.title, proposal.title);
      assert.equal(
        added.requirements[0].criteria[0].text,
        proposal.requirements[0].criteria[0],
      );
      assert.equal(message.addedSpecId, added.id);
      assert(added.requirements[0].recordId);
      await store.addSpecProposal(workspace.id, "u", message.id, base);
      assert.equal(workspace.document.specs.length, 1);
      await store.close();
      store = await Store.open(dir, { databaseUrl });
      workspace = store.db.workspaces[0];
      await store.addSpecProposal(
        workspace.id,
        "u",
        message.id,
        workspace.head,
      );
      assert.equal(workspace.document.specs.length, 1);
    } finally {
      await store?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
