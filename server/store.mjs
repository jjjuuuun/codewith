import { LIMITS } from "../shared/config.mjs";
import {
  defaultPlanSkill,
  defaultPlanUISkill,
  defaultPlanReviewSkill,
  defaultPlanFlowSkill,
} from "./default-skills.mjs";
import {
  planReadyForApproval,
  planTargetScore,
} from "../shared/plan-workflow.mjs";
import { sourceSummary } from "./project-source.mjs";
import { requirementContract, specStatus } from "../shared/completion.mjs";
import {
  planBasisData,
  validatePlanHTML,
  securePlanHTML,
} from "../shared/plans.mjs";
import { connectStorage, validateState } from "./database.mjs";
import { openPersistence } from "./persistence.mjs";
import { syncSkillFiles } from "./skill-files.mjs";
import { specFromProposal } from "../shared/spec-proposal.mjs";
import { migrateChatThreads } from "./chat-threads.mjs";
import fs from "node:fs";
import path from "node:path";
import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  SCHEMA,
  copy,
  validateDocument,
  semantic,
  changes,
  problem,
  blankSpec,
  validateFilePath,
} from "../shared/schema.mjs";
export const stamp = () => new Date().toISOString();
export const id = (prefix) => prefix + "_" + randomBytes(12).toString("hex");
export const hash = (x) => createHash("sha256").update(x).digest("hex");
export function passwordHash(p, salt = randomBytes(16).toString("hex")) {
  return salt + ":" + scryptSync(p, salt, 64).toString("hex");
}
export function passwordMatch(p, stored) {
  const [salt] = stored.split(":");
  const a = Buffer.from(passwordHash(p, salt)),
    b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}
export class Store {
  static async open(dir, options = {}) {
    dir = path.resolve(dir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const persistence = await connectStorage(dir, options);
    try {
      const initialState = validateState(await persistence.read());
      for (const w of initialState.workspaces) {
        for (const s of w.document.specs)
          for (const r of s.requirements) r.recordId ??= id("requirement");
        w.document = validateDocument(w.document);
      }
      const store = new Store(dir, { ...options, persistence, initialState });
      await store.ready;
      for (const w of store.db.workspaces.filter((w) => !w.deletedAt)) {
        const doc = copy(w.document);
        let changed = false;
        for (const skill of [
          defaultPlanUISkill,
          defaultPlanReviewSkill,
          defaultPlanFlowSkill,
        ]) {
          if (
            !doc.projectSpec.skills.some((x) => x.id === skill.id) &&
            doc.projectSpec.skills.length < 100
          ) {
            doc.projectSpec.skills.push(copy(skill));
            changed = true;
          }
        }
        if (changed)
          await store.commit(
            w,
            w.ownerId,
            doc,
            "기본 계획 검증 스킬 보완",
            w.head,
          );
      }
      return store;
    } catch (e) {
      try {
        await persistence.close();
      } catch {}
      throw e;
    }
  }

  constructor(dir, options = {}) {
    this.dir = path.resolve(dir);
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.file = path.join(this.dir, "database.json");
    this.persistence =
      options.persistence || openPersistence(this.dir, options);
    try {
      this.db = options.initialState || this.persistence.read();
      migrateChatThreads(this.db);
      this.ready = this.persist();
    } catch (e) {
      this.persistence.close();
      throw e;
    }
  }
  assertHealthy() {
    if (this.failure)
      throw problem(
        "저장소 오류로 요청을 중단했습니다. 서버 로그를 확인하고 다시 시작하세요.",
        503,
      );
  }
  persist() {
    this.assertHealthy();
    try {
      const result = this.persistence.write(this.db);
      if (result?.then)
        return result
          .then(() => syncSkillFiles(this.dir, this.db.workspaces))
          .catch((e) => {
            this.failure = e;
            throw e;
          });
      syncSkillFiles(this.dir, this.db.workspaces);
      return result;
    } catch (e) {
      this.failure = e;
      throw e;
    }
  }
  close() {
    return this.persistence.close();
  }
  user(uid) {
    const u = this.db.users.find((x) => x.id === uid);
    if (!u) throw problem("로그인이 필요합니다.", 401);
    return u;
  }
  publicUser(u) {
    return {
      id: u.id,
      name: u.id === this.personalUserId ? "PERSONAL" : u.name,
      login: u.login,
      needsProfile: u.id !== this.personalUserId && !!u.needsProfile,
      aiIdentity: null,
      keyLogin: !!u.keyFingerprint,
      keyFingerprint: u.keyFingerprint || null,
      createdAt: u.createdAt,
    };
  }
  actor(uid, ai = null) {
    const u = this.publicUser(this.user(uid));
    return {
      id: u.id,
      name: u.name,
      localName: u.name,
      identity: "codewith",
      ...(ai ? { viaAI: ai } : {}),
    };
  }
  member(w, uid) {
    return w.members.find((m) => m.userId === uid);
  }
  workspace(wid, uid, edit = false, owner = false) {
    const w = this.db.workspaces.find((w) => w.id === wid && !w.deletedAt);
    if (!w) throw problem("작업 공간을 찾을 수 없습니다.", 404);
    const m = this.member(w, uid);
    if (!m) throw problem("이 작업 공간의 참여 승인이 필요합니다.", 403);
    if (owner && w.ownerId !== uid)
      throw problem("슈퍼관리자만 변경할 수 있습니다.", 403);
    if (edit && m.role === "viewer")
      throw problem("읽기 전용 참여자는 편집할 수 없습니다.", 403);
    return w;
  }
  summary(w, uid) {
    return {
      id: w.id,
      name: w.document.project,
      ownerId: w.ownerId,
      role: this.member(w, uid)?.role,
      visibility: w.visibility,
      head: w.head,
      updatedAt: w.updatedAt,
      specCount: w.document.specs.length,
      memberCount: w.members.length,
      pending:
        w.ownerId === uid
          ? w.requests.filter((r) => r.status === "pending").length
          : 0,
    };
  }
  list(uid) {
    return this.db.workspaces
      .filter((w) => !w.deletedAt && this.member(w, uid))
      .map((w) => this.summary(w, uid));
  }
  async create(uid, name, visibility = "private", document = null) {
    if (
      this.db.workspaces.filter((w) => !w.deletedAt && w.ownerId === uid)
        .length >= 40
    )
      throw problem("작업 공간은 사용자당 최대 40개입니다.");
    const doc = validateDocument(
      document || { schema: SCHEMA, project: name, specs: [], files: {} },
    );
    for (const skill of [
      defaultPlanSkill,
      defaultPlanUISkill,
      defaultPlanReviewSkill,
      defaultPlanFlowSkill,
    ])
      if (
        !doc.projectSpec.skills.some((x) => x.id === skill.id) &&
        doc.projectSpec.skills.length < 100
      )
        doc.projectSpec.skills.push(copy(skill));
    const w = {
      id: id("ws"),
      ownerId: uid,
      members: [{ userId: uid, role: "owner", joinedAt: stamp() }],
      visibility,
      inviteCode: randomBytes(18).toString("hex"),
      requests: [],
      head: null,
      document: doc,
      commits: [],
      createdAt: stamp(),
      updatedAt: stamp(),
    };
    this.db.workspaces.push(w);
    await this.commit(w, uid, doc, "작업 공간 생성", null, { initial: true });
    return w;
  }
  async remove(wid, uid, base) {
    const w = this.workspace(wid, uid, false, true);
    if (base !== w.head)
      throw problem(
        "워크스페이스가 변경되었습니다. 최신 내용을 확인하고 다시 삭제하세요.",
        409,
      );
    w.deletedAt = stamp();
    w.deletedBy = uid;
    w.inviteCode = null;
    await this.persist();
  }
  projectDir(wid) {
    return path.join(this.dir, "projects", wid);
  }
  async addSpecProposal(wid, uid, messageId, base) {
    const w = this.workspace(wid, uid, true);
    const message = this.db.chats.find(
      (m) =>
        m.id === messageId &&
        m.workspaceId === wid &&
        m.userId === uid &&
        m.role === "assistant",
    );
    if (!message?.specProposal)
      throw problem("명세 제안을 찾을 수 없습니다.", 404);
    if (
      this.db.chatThreads.some((t) => t.id === message.threadId && t.deletedAt)
    )
      throw problem("삭제된 대화입니다.", 404);
    if (message.addedSpecId) return w;
    if (base !== w.head)
      throw problem(
        "워크스페이스가 변경되었습니다. 최신 내용을 확인한 뒤 추가하세요.",
        409,
      );
    const doc = copy(w.document);
    const spec = specFromProposal(message.specProposal, id);
    doc.specs.push(spec);
    message.addedSpecId = spec.id;
    try {
      await this.commit(
        w,
        uid,
        doc,
        "AI 제안으로 명세 추가: " + spec.title,
        base,
      );
    } catch (error) {
      delete message.addedSpecId;
      throw error;
    }
    return w;
  }
  pathFor(wid, p) {
    validateFilePath(p);
    const root = this.projectDir(wid);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    let current = root;
    for (const part of p.split("/")) {
      current = path.join(current, part);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
        throw problem("심볼릭 링크를 경유하는 파일은 사용할 수 없습니다.");
    }
    return current;
  }
  syncFiles(w, document) {
    const before = w.document.files || {},
      after = document.files || {};
    const ops = [];
    for (const p of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[p] === after[p]) continue;
      const target = this.pathFor(w.id, p);
      if (fs.existsSync(target)) {
        if (!fs.statSync(target).isFile())
          throw problem("일반 파일만 수정할 수 있습니다.");
        const current = fs.readFileSync(target, "utf8");
        if (current !== before[p] && current !== after[p])
          throw problem(
            `${p}가 앱 밖에서 변경되었습니다. 코드 파일을 다시 가져와 주세요.`,
            409,
          );
      } else if (before[p] !== undefined)
        throw problem(`${p}가 앱 밖에서 삭제되었습니다.`, 409);
      ops.push({ target, content: after[p] });
    }
    for (const op of ops) {
      if (op.content === undefined) fs.unlinkSync(op.target);
      else {
        fs.mkdirSync(path.dirname(op.target), { recursive: true, mode: 0o700 });
        fs.writeFileSync(op.target + ".codewith-tmp", op.content, {
          mode: 0o600,
        });
        fs.renameSync(op.target + ".codewith-tmp", op.target);
      }
    }
  }
  async commit(
    w,
    uid,
    input,
    message,
    base,
    {
      initial = false,
      restoreOf = null,
      ai = null,
      planChange = false,
      completionChange = false,
    } = {},
  ) {
    if (!initial && w.deletedAt)
      throw problem("삭제된 워크스페이스입니다.", 404);
    if (!initial && input?.project !== w.document.project && uid !== w.ownerId)
      throw problem("슈퍼관리자만 이름을 변경할 수 있습니다.", 403);
    if (!initial && base !== w.head)
      throw problem(
        "다른 사람이 먼저 저장했습니다. 최신 버전을 불러온 뒤 다시 반영하세요.",
        409,
      );
    let doc = validateDocument(input, { checkLifecycle: false });
    const before = initial
      ? { schema: SCHEMA, project: "", specs: [], files: {} }
      : copy(w.document);
    if (!initial)
      for (const s of doc.specs) {
        const old = before.specs.find((x) => x.id === s.id);
        if (restoreOf && old) {
          const combined = new Map(old.plans.versions.map((v) => [v.id, v]));
          for (const v of s.plans.versions)
            if (!combined.has(v.id)) combined.set(v.id, v);
          s.plans.versions = [...combined.values()];
        } else if (
          !restoreOf &&
          !planChange &&
          JSON.stringify(s.plans) !==
            JSON.stringify(old?.plans || { versions: [], finalVersionId: null })
        )
          throw problem(
            "계획은 계획 저장 API로 새 버전을 추가하거나 최종 버전을 선택하세요.",
          );
      }
    const actor = this.actor(uid, ai);
    const projectChanged =
        !initial &&
        JSON.stringify(doc.projectSpec) !== JSON.stringify(before.projectSpec),
      filesChanged =
        !initial && JSON.stringify(doc.files) !== JSON.stringify(before.files);
    for (const s of doc.specs) {
      const old = before.specs.find((x) => x.id === s.id);
      s.createdBy = old?.createdBy || actor;
      if (!old || JSON.stringify(old) !== JSON.stringify(s)) {
        s.updatedBy = actor;
        s.updatedAt = stamp();
      } else {
        s.updatedBy = old.updatedBy;
        s.updatedAt = old.updatedAt;
      }
      s.version = old
        ? old.version +
          (semantic(s) !== semantic(old) ||
          projectChanged ||
          filesChanged ||
          restoreOf
            ? 1
            : 0)
        : 1;
      for (const r of s.requirements) {
        const prior = old?.requirements.find(
            (x) => x.id === r.id || (r.recordId && x.recordId === r.recordId),
          ),
          changed =
            prior &&
            JSON.stringify(requirementContract(r)) !==
              JSON.stringify(requirementContract(prior));
        r.createdBy = prior?.createdBy || actor;
        r.recordId = prior?.recordId || r.recordId || id("requirement");
        if (
          !initial &&
          !restoreOf &&
          !completionChange &&
          (r.status !== (prior?.status || "pending") ||
            JSON.stringify(r.completion) !==
              JSON.stringify(prior?.completion || null))
        )
          throw problem(
            "완료 상태는 요구사항의 구현 완료 기록으로 변경합니다.",
          );
        if (!initial) {
          r.version = prior
            ? prior.version + (changed || restoreOf ? 1 : 0)
            : 1;
          if (changed || restoreOf || !prior) {
            r.status = "pending";
            r.completion = null;
          }
        }
        r.updatedBy =
          JSON.stringify(prior) === JSON.stringify(r) ? prior.updatedBy : actor;
      }
      s.status = specStatus(s);
    }
    doc = validateDocument(doc);
    const diffs = changes(before, doc);
    if (!initial && !diffs.length) return w;
    this.syncFiles({ ...w, document: before }, doc);
    for (const s of doc.specs)
      for (const v of s.plans.versions) {
        const dir = path.join(this.dir, "plans", w.id);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const file = path.join(dir, v.id + ".html");
        if (!fs.existsSync(file))
          fs.writeFileSync(file, v.html, { mode: 0o600, flag: "wx" });
      }

    const at = stamp(),
      cid = hash(
        JSON.stringify({
          parent: w.head,
          doc,
          actor,
          at,
          nonce: randomBytes(8).toString("hex"),
        }),
      );
    const commit = {
      id: cid,
      parent: w.head,
      message: String(message || "명세 수정").slice(0, 300),
      author: actor,
      at,
      restoreOf,
      changes: diffs,
      snapshot: copy(doc),
    };
    w.document = doc;
    w.head = cid;
    w.updatedAt = at;
    w.commits.unshift(commit);
    await this.persist();
    return w;
  }
  async removeSpec(wid, uid, sid, base) {
    const w = this.workspace(wid, uid, true),
      s = w.document.specs.find((s) => s.id === sid);
    if (!s) throw problem("명세를 찾을 수 없습니다.", 404);
    const doc = copy(w.document);
    doc.specs = doc.specs.filter((s) => s.id !== sid);
    await this.commit(w, uid, doc, `명세 삭제: ${sid} · ${s.title}`, base);
    return this.view(w, uid);
  }
  async completeRequirement(wid, uid, rid, b) {
    const w = this.workspace(wid, uid, true),
      s = w.document.specs.find((s) =>
        s.requirements.some((r) => r.id === rid),
      ),
      r = s?.requirements.find((r) => r.id === rid);
    if (!r) throw problem("요구사항을 찾을 수 없습니다.", 404);
    if (
      typeof b.eventId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(b.eventId) ||
      !Number.isInteger(b.requirementVersion) ||
      b.requirementVersion < 1 ||
      typeof b.planVersionId !== "string"
    )
      throw problem(
        "완료 알림 ID, 요구사항 버전, 최종 계획 버전이 필요합니다.",
      );
    const summary = b.summary ?? "",
      codeRevision = b.codeRevision ?? "";
    if (
      typeof summary !== "string" ||
      summary.length > LIMITS.summaryChars ||
      typeof codeRevision !== "string" ||
      codeRevision.length > 200
    )
      throw problem("완료 설명 또는 코드 리비전을 확인하세요.");
    const c = r.completion;
    if (c?.eventId === b.eventId) {
      if (
        r.status === "completed" &&
        r.version === b.requirementVersion &&
        c.planVersionId === b.planVersionId &&
        c.summary === summary &&
        c.codeRevision === codeRevision &&
        c.by.id === uid
      )
        return { workspace: this.view(w, uid), alreadyCompleted: true };
      throw problem("같은 완료 알림 ID에 다른 내용이 전달되었습니다.", 409);
    }
    if (b.base !== w.head || r.version !== b.requirementVersion)
      throw problem(
        "요구사항이 변경되었습니다. 최신 요구사항과 계획을 확인하세요.",
        409,
      );
    const plan = s.plans.versions.find((v) => v.id === s.plans.finalVersionId);
    if (
      !plan ||
      plan.id !== b.planVersionId ||
      plan.basis !== this.planBasis(w, s)
    )
      throw problem(
        "현재 요구사항에 맞는 최종 계획으로 구현했는지 확인하세요.",
        409,
      );
    const doc = copy(w.document),
      target = doc.specs
        .find((x) => x.id === s.id)
        .requirements.find((x) => x.id === rid);
    target.status = "completed";
    target.completion = {
      eventId: b.eventId,
      requirementVersion: r.version,
      planVersionId: plan.id,
      at: stamp(),
      by: this.actor(uid),
      summary,
      codeRevision,
    };
    await this.commit(w, uid, doc, `요구사항 구현 완료: ${rid}`, b.base, {
      completionChange: true,
    });
    return { workspace: this.view(w, uid), alreadyCompleted: false };
  }
  planBasis(w, s) {
    return hash(JSON.stringify(planBasisData(w.document, s)));
  }
  async savePlan(
    wid,
    uid,
    sid,
    {
      base,
      parentVersionId = null,
      html,
      title = "구현 계획",
      source = "manual",
      provider = null,
      model = null,
      codeSource,
      evaluation = null,
      execution = null,
    },
  ) {
    const w = this.workspace(wid, uid, true),
      doc = copy(w.document),
      s = doc.specs.find((s) => s.id === sid);
    if (!s) throw problem("명세를 찾을 수 없습니다.", 404);
    if (!s.requirements.length) throw problem("요구사항을 먼저 작성하세요.");
    if (base !== w.head)
      throw problem(
        "계획 작성 중 워크스페이스가 변경되었습니다. 최신 내용을 확인한 뒤 다시 요청하세요.",
        409,
      );
    if (
      parentVersionId &&
      !s.plans.versions.some((v) => v.id === parentVersionId && !v.deletedAt)
    )
      throw problem("기준 계획 버전을 찾을 수 없습니다.", 404);
    if (
      s.plans.versions.filter((v) => !v.deletedAt).length >= 50 ||
      s.plans.versions.length >= 500
    )
      throw problem("명세당 계획서는 최대 50개입니다.");
    if (!codeSource && parentVersionId)
      codeSource = s.plans.versions.find(
        (v) => v.id === parentVersionId,
      )?.codeSource;
    html = securePlanHTML(html);
    if (typeof title !== "string" || !title.trim() || title.length > 160)
      throw problem("계획 제목은 1~160자로 입력하세요.");
    const v = {
      id: id("plan"),
      parentId: parentVersionId,
      title: title.trim(),
      html,
      basis: this.planBasis(w, s),
      baseHead: base,
      specVersion: s.version,
      createdAt: stamp(),
      author: this.actor(uid),
      source,
      provider,
      model,
      ...(codeSource ? { codeSource } : {}),
      ...(source === "ai" && evaluation ? { evaluation } : {}),
      ...(source === "ai" && execution ? { execution } : {}),
    };
    s.plans.versions.push(v);
    await this.commit(
      w,
      uid,
      doc,
      `계획 v${s.plans.versions.length}: ${v.title}`,
      base,
      { planChange: true, ai: source === "ai" ? provider : null },
    );
    return v;
  }
  async removePlan(wid, uid, sid, versionId, base) {
    const w = this.workspace(wid, uid, true),
      doc = copy(w.document);
    const spec = doc.specs.find((s) => s.id === sid);
    const version = spec?.plans.versions.find(
      (v) => v.id === versionId && !v.deletedAt,
    );
    if (!version) throw problem("계획을 찾을 수 없습니다.", 404);
    if (base !== w.head)
      throw problem("계획이 변경되었습니다. 최신 내용을 확인하세요.", 409);
    version.deletedAt = stamp();
    version.deletedBy = this.actor(uid);
    if (spec.plans.finalVersionId === versionId) {
      if ((spec.plans.approvals?.length || 0) >= 500)
        throw problem("계획 승인 이력 한도에 도달했습니다.");
      spec.plans.approvals ??= [];
      spec.plans.approvals.push({
        versionId: null,
        by: this.actor(uid),
        at: version.deletedAt,
      });
      spec.plans.finalVersionId = null;
      spec.plans.selectedBy = null;
      spec.plans.selectedAt = null;
    }
    await this.commit(
      w,
      uid,
      doc,
      `계획 v${spec.plans.versions.indexOf(version) + 1} 삭제: ${version.title}`,
      base,
      { planChange: true },
    );
    return this.view(w, uid);
  }
  async reviewPlanStep(wid, uid, sid, { base, versionId, step, approved }) {
    const w = this.workspace(wid, uid, true),
      doc = copy(w.document);
    const s = doc.specs.find((item) => item.id === sid);
    const v = s?.plans.versions.find((item) => item.id === versionId);
    if (!v || v.deletedAt) throw problem("계획을 찾을 수 없습니다.", 404);
    if (
      typeof step !== "string" ||
      !/^step-\d{1,4}$/.test(step) ||
      typeof approved !== "boolean"
    )
      throw problem("검토 단계를 확인하세요.");
    const count = (v.html.match(/class="plan-card"/g) || []).length || 1;
    if (Number(step.slice(5)) >= count)
      throw problem("검토 단계를 찾을 수 없습니다.", 404);
    v.stepApprovals ??= {};
    if (approved) v.stepApprovals[step] = { by: this.actor(uid), at: stamp() };
    else delete v.stepApprovals[step];
    await this.commit(
      w,
      uid,
      doc,
      `계획 단계 ${approved ? "승인" : "승인 해제"}: ${step}`,
      base,
      { planChange: true },
    );
    return w;
  }
  async selectPlan(wid, uid, sid, versionId, base) {
    const w = this.workspace(wid, uid, true),
      doc = copy(w.document),
      s = doc.specs.find((s) => s.id === sid),
      v = s?.plans.versions.find((v) => v.id === versionId);
    if (!s || (versionId !== null && (!v || v.deletedAt)))
      throw problem("계획 버전을 찾을 수 없습니다.", 404);
    if (v && this.sourceMatches(w, uid, v) === false)
      throw problem(
        "분석 기준 코드와 내 프로젝트 연결의 코드가 다릅니다. 코드를 갱신하고 계획을 다시 작성하세요.",
        409,
      );
    if (v && v.basis !== this.planBasis(w, s))
      throw problem(
        "요구사항이나 공통 설정이 변경되었습니다. 계획을 검토·수정하여 새 버전으로 저장하세요.",
        409,
      );
    if (v && !planReadyForApproval(v, s, doc.projectSpec))
      throw problem(
        `현재 명세의 필수 기준 충족·차단 문제 없음·목표 ${planTargetScore(v)}점 이상인 독립 평가가 필요합니다. 계획서에서 평가하거나 개선하세요.`,
        409,
      );
    s.plans.approvals ??= [];
    if (s.plans.approvals.length >= 500)
      throw problem("계획 승인 이력 한도에 도달했습니다.");
    s.plans.approvals.push({ versionId, at: stamp(), by: this.actor(uid) });
    s.plans.finalVersionId = versionId;
    s.plans.selectedBy = this.actor(uid);
    s.plans.selectedAt = stamp();
    await this.commit(
      w,
      uid,
      doc,
      versionId ? "최종 계획 승인" : "최종 계획 승인 해제",
      base,
      { planChange: true },
    );
    return w;
  }
  sourceMatches(w, uid, v) {
    if (!v.codeSource) return null;
    const s = this.user(uid).projectSources?.[w.id];
    return s ? s.digest === v.codeSource.digest : null;
  }
  view(w, uid) {
    return {
      ...this.summary(w, uid),
      projectSource: sourceSummary(this.user(uid).projectSources?.[w.id]),
      planCodeMatches: Object.fromEntries(
        w.document.specs.flatMap((s) =>
          s.plans.versions.map((v) => [v.id, this.sourceMatches(w, uid, v)]),
        ),
      ),
      planBases: Object.fromEntries(
        w.document.specs.map((s) => [s.id, this.planBasis(w, s)]),
      ),
      document: copy(w.document),
      members: w.members.map((m) => ({
        ...m,
        user: this.publicUser(this.user(m.userId)),
      })),
      requests:
        w.ownerId === uid
          ? w.requests.map((r) => ({
              ...r,
              user: this.publicUser(this.user(r.userId)),
            }))
          : [],
      inviteCode: w.ownerId === uid ? w.inviteCode : null,
      projectPath: w.ownerId === uid ? this.projectDir(w.id) : null,
      commits: w.commits.map(({ snapshot, ...c }) => ({
        ...c,
        changes: c.changes.map(({ path }) => ({ path })),
      })),
    };
  }
}
