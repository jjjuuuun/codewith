import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectProjectSource } from "../src/services/project-files.js";
import {
  createProjectSources,
  sourceConnectionNote,
} from "../server/project-source.mjs";

test("browser connection status follows actual permissions and folder access, not saved metadata", async () => {
  const c = { kind: "browser", label: "project" };
  assert.equal((await inspectProjectSource(c, null)).state, "missing");
  assert.equal(
    (await inspectProjectSource(c, { queryPermission: async () => "prompt" }))
      .state,
    "permission",
  );
  assert.equal(
    (await inspectProjectSource(c, { queryPermission: async () => "denied" }))
      .state,
    "permission",
  );
  const empty = { queryPermission: async () => "granted", async *entries() {} };
  assert.equal((await inspectProjectSource(c, empty)).state, "connected");
  assert.equal(
    (
      await inspectProjectSource(c, {
        ...empty,
        async *entries() {
          throw Error("folder gone");
        },
      })
    ).state,
    "unavailable",
  );
  assert.equal((await inspectProjectSource(null)).state, "disconnected");
  assert.equal(
    (await inspectProjectSource({ kind: "upload" })).state,
    "snapshot",
  );
});
test("server connection reports unavailable paths without erasing the previous connection", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codewith-source-state-"));
  try {
    const project = path.join(root, "project");
    fs.mkdirSync(project);
    const user = {
      projectSources: {
        w: { kind: "server", path: project, label: "project", files: {} },
      },
    };
    const sources = createProjectSources({
      mode: "personal",
      store: {
        dir: path.join(root, "data"),
        workspace: () => ({}),
        user: () => user,
      },
    });
    assert.equal(sources.summary("w", "u").available, true);
    fs.renameSync(project, project + "-moved");
    assert.equal(sources.summary("w", "u").available, false);
    assert.equal(sources.summary("w", "u").connection.path, project);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AI context distinguishes connected empty projects from no connection", () => {
  const note = sourceConnectionNote({
    provenance: { kind: "browser", totalFiles: 0 },
  });
  assert.match(note, /폴더가 연결되어/);
  assert.match(note, /0개/);
  assert.match(note, /재연결을 요구하지/);
  assert.match(sourceConnectionNote(null), /연결 정보가 없습니다/);
  assert.match(
    sourceConnectionNote({ provenance: { kind: "upload", totalFiles: 0 } }),
    /사본이 연결/,
  );
});
