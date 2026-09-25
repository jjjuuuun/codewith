import { runtimeConfig as runtime } from "./runtime-config.mjs";
import { LIMITS } from "../shared/config.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { problem } from "../shared/schema.mjs";
const MAX = LIMITS.attachmentBytes;
export function createChatAttachments(store, dataDir) {
  store.db.chatAttachments ??= [];
  const root = path.join(dataDir, "chat-attachments");
  const describe = ({ id, name, mime, size, text }) => ({
    id,
    name,
    mime,
    size,
    characters: text?.length || 0,
  });
  function get(uid, wid, id) {
    store.workspace(wid, uid);
    const a = store.db.chatAttachments.find(
      (a) => a.id === id && a.userId === uid && a.workspaceId === wid,
    );
    if (!a) throw problem("첨부 파일을 찾을 수 없습니다.", 404);
    return a;
  }
  async function upload(uid, b) {
    store.workspace(b.workspaceId, uid);
    if (
      typeof b.data !== "string" ||
      b.data.length > MAX * 1.4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(b.data)
    )
      throw problem(
        `첨부 파일은 ${LIMITS.attachmentBytes / (1024 * 1024)} MB 이하이어야 합니다.`,
        413,
      );
    const bytes = Buffer.from(b.data, "base64");
    if (!bytes.length || bytes.length > MAX)
      throw problem("비어 있거나 너무 큰 파일입니다.", 413);
    const name = String(b.name || "파일")
      .replace(/[\x00-\x1f/\\]/g, "_")
      .slice(0, 180);
    const ext = path.extname(name).toLowerCase();
    let mime = "text/plain";
    if (
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      mime = "image/png";
    else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
      mime = "image/jpeg";
    else if (
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    )
      mime = "image/webp";
    else if (bytes.toString("ascii", 0, 5) === "%PDF-")
      mime = "application/pdf";
    else if (ext === ".docx" && bytes.toString("ascii", 0, 2) === "PK")
      mime =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    else if (
      !/\.(txt|md|csv|json|xml|html?|css|js|mjs|ts|tsx|jsx|vue|java|py|sql|ya?ml|log)$/i.test(
        name,
      )
    )
      throw problem("PNG·JPG·WebP·PDF·DOCX·텍스트 파일을 첨부해 주세요.");
    let text = "";
    if (!mime.startsWith("image/")) {
      if (mime === "text/plain") {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (text.includes("\0"))
          throw problem("텍스트 파일 형식을 확인하세요.");
      } else text = await extract(bytes, mime);
      if (!text.trim())
        throw problem(
          "추출할 텍스트가 없습니다. 스캔 문서는 페이지를 이미지로 첨부해 주세요.",
        );
      if (text.length > LIMITS.attachmentTextChars)
        throw problem(
          "문서가 너무 깁니다. 160,000자 이하로 나누어 첨부해 주세요.",
          413,
        );
    }
    const a = {
      id: randomUUID(),
      userId: uid,
      workspaceId: b.workspaceId,
      name,
      mime,
      size: bytes.length,
      text,
      at: new Date().toISOString(),
    };
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(root, a.id), bytes, {
      mode: 0o600,
      flag: "wx",
    });
    store.db.chatAttachments.push(a);
    await store.persist();
    return describe(a);
  }
  async function context(uid, wid, ids = []) {
    if (!Array.isArray(ids) || ids.length > LIMITS.attachmentCount)
      throw problem(
        `첨부 파일은 한 번에 ${LIMITS.attachmentCount}개까지 선택할 수 있습니다.`,
      );
    const items = ids.map((id) => get(uid, wid, id));
    let total = 0;
    const images = [];
    for (const a of items)
      if (a.mime.startsWith("image/")) {
        total += a.size;
        if (total > LIMITS.attachmentBytes)
          throw problem(
            `한 요청의 이미지 합계는 ${LIMITS.attachmentBytes / (1024 * 1024)} MB 이하이어야 합니다.`,
            413,
          );
        images.push({
          name: a.name,
          mime: a.mime,
          data: (await fs.readFile(path.join(root, a.id))).toString("base64"),
        });
      }
    return {
      metadata: items.map(describe),
      images,
      text: items
        .filter((a) => a.text)
        .map((a) => `첨부 문서 ${a.name} (${a.id})\n${a.text}`)
        .join("\n\n"),
    };
  }
  return {
    upload,
    context,
    get,
    describe,
    async read(uid, wid, id) {
      const a = get(uid, wid, id);
      return {
        metadata: describe(a),
        bytes: await fs.readFile(path.join(root, a.id)),
      };
    },
  };
}
function extract(bytes, mime) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./document-reader.mjs", import.meta.url),
      {
        workerData: { bytes, mime },
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      },
    );
    let settled = false;
    const finish = (error, text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      error
        ? reject(
            problem(
              "문서를 읽지 못했습니다. 암호·손상 여부나 파일 크기를 확인하세요.",
              422,
            ),
          )
        : resolve(text);
    };
    const timer = setTimeout(
      () => finish(new Error("timeout")),
      runtime.documentReadTimeoutMs,
    );
    worker.once("message", (message) => finish(message.error, message.text));
    worker.once("error", (e) => finish(e));
    worker.once("exit", (code) => {
      if (!settled) finish(new Error("exit " + code));
    });
  });
}
