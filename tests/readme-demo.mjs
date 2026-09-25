import fs from "node:fs";
import path from "node:path";
import { sample, saveAssessedPlan } from "./fixtures.mjs";
import { renderPlanHTML } from "../shared/plans.mjs";
import { renderMarkdown } from "../public/markdown.js";
// The only screenshot source is a newly-created temporary test store.
export async function captureReadme({
  ev,
  call,
  wait,
  assert,
  click,
  fill,
  submit,
  closeSaved,
  root,
  origin,
  store,
}) {
  await click('[data-action="access-create"]');
  await fill("accessName", "Demo contributor");
  await submit();
  await wait(`!!document.querySelector('.access-secret code')`);
  await submit();
  await closeSaved();
  const doc = sample();
  doc.project = "Atlas · Documentation platform";
  doc.projectSpec.purpose =
    "Ship documentation with clear acceptance criteria, reviewed changes, and reproducible verification.";
  doc.projectSpec.principles = [
    "Keep every decision close to its specification.",
    "Review the plan before implementation.",
  ];
  doc.projectSpec.constraints = [
    "Node.js 22+",
    "Accessible keyboard navigation",
  ];
  const spec = doc.specs[0];
  spec.title = "Reliable release publishing";
  spec.subtitle =
    "Build, verify and publish documentation from a reviewed release.";
  spec.requirements[0] = {
    ...spec.requirements[0],
    title: "Publish only a verified release",
    body: "When a maintainer creates a version tag, publish the documentation only after all required checks pass. Preserve the previous release if validation fails.",
    criteria: [
      {
        id: "AC-001",
        text: "A passing version tag produces one immutable release.",
      },
      {
        id: "AC-002",
        text: "A failed check prevents publication and reports the failing stage.",
      },
      {
        id: "AC-003",
        text: "Published artifacts include a version and checksum.",
      },
    ],
    resources: [],
  };
  spec.tasks = [
    {
      id: "TASK-001",
      text: "Validate release inputs and version agreement",
      req: "REG-001",
      done: false,
    },
    {
      id: "TASK-002",
      text: "Build and check artifacts before publication",
      req: "REG-001",
      done: false,
    },
  ];
  spec.questions = [
    {
      id: "Q-001",
      text: "How should failed releases be handled?",
      answer:
        "Keep the current release and preserve the failed run diagnostics.",
      resolved: true,
    },
  ];
  const wid = await ev(
    `(async()=>{const r=await fetch('/api/workspaces',{method:'POST',headers:{'Content-Type':'application/json','X-CodeWith':'1'},body:JSON.stringify({exchange:${JSON.stringify(doc)}})});if(!r.ok)throw Error('Demo workspace creation failed');return (await r.json()).id;})()`,
  );
  const w = store.db.workspaces.find((item) => item.id === wid);
  const html = renderPlanHTML(
    w.document.specs[0],
    [
      {
        path: "REG-001.html",
        content: JSON.stringify({
          implementation:
            "## A release that can be reviewed\n\nValidate the tag and package version, build the documentation, then publish only the verified artifacts. Keep the current release if any check fails.\n\n| Stage | Evidence |\n| --- | --- |\n| Validate | Tag matches package version |\n| Build | Reproducible output |\n| Verify | Tests and checksum pass |\n| Publish | Immutable release |",
          before: "No automated release pipeline exists yet.",
          after:
            "```yaml\nname: Publish documentation\non:\n  push:\n    tags: ['v*']\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n      - run: npm test\n      - run: npm run build\n```",
          ui: "Show the published version and last successful build on the documentation home page.",
          mockup: "",
          database: "No schema changes are required.",
          verification:
            "- [ ] A passing tag publishes once.\n- [ ] A failed check leaves the current release unchanged.\n- [ ] Downloaded artifacts match their checksums.",
        }),
      },
    ],
    renderMarkdown,
  );
  await saveAssessedPlan({ store }, store.view(w, w.ownerId), {
    html,
    title: "Verified release pipeline",
  });
  await ev(`localStorage.setItem('codewith.chatHidden','true')`);
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const base = origin + `/workspaces/${wid}/specs/${spec.id}`;
  await call("Page.navigate", { url: base + "/requirements" });
  await wait(`!!document.querySelector('[data-requirement-card="REG-001"]')`);
  const folder = path.join(root, "docs/images");
  fs.mkdirSync(folder, { recursive: true });
  async function shot(name) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const result = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(folder, name + ".png"),
      Buffer.from(result.data, "base64"),
    );
  }
  await shot("workspace");
  await click('[data-tab="design"]');
  await wait(`!!document.querySelector('.plan-version')`);
  await ev(`window.CodeWithTheme.set('dark')`);
  await shot("planning");
  assert(
    await ev(`document.documentElement.lang==='en'`),
    "Public screenshots use English and a temporary synthetic workspace",
  );
  console.log("Saved synthetic README screenshots.");
}
