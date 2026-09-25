import test from "node:test";
import { EditorState, TextSelection } from "prosemirror-state";
import assert from "node:assert/strict";
import {
  clearHeadingAtStart,
  parseRichText,
  serializeRichText,
  richSchema,
  renderRichMarkdown,
} from "../src/rich-editor.js";
test("rich blocks retain headings, lists, links and code through stored text", () => {
  const source =
    '# 제목\n\n* 하나\n* 둘\n\n> 인용\n\n```java\nString s = "<tag>";\n```\n\n**굵게** *기울임* `inline` [문서](https://example.com)';
  const doc = parseRichText(source),
    roundTrip = parseRichText(serializeRichText(doc));
  assert(doc.eq(roundTrip));
  assert.equal(doc.firstChild.type.name, "heading");
  let code;
  doc.descendants((n) => {
    if (n.type.name === "code_block") code = n;
  });
  assert.equal(code.attrs.params, "java");
  assert.equal(code.textContent, 'String s = "<tag>";');
});
test("rich text imports do not turn HTML or unsafe links into executable content", () => {
  const doc = parseRichText(
    "<script>bad()</script>\n\n[click](javascript:alert(1))",
  );
  let unsafe = false;
  doc.descendants((n) => {
    if (
      n.marks.some(
        (m) => m.type.name === "link" && m.attrs.href.startsWith("javascript:"),
      )
    )
      unsafe = true;
  });
  assert.equal(unsafe, false);
  assert(doc.textContent.includes("<script>"));
  const spec = richSchema.marks.link.create({ href: "javascript:alert(1)" })
    .type.spec;
  assert.equal(
    spec.toDOM(richSchema.marks.link.create({ href: "javascript:alert(1)" }))[1]
      .href,
    undefined,
  );
});

test("saved blocks render with matching nested lists, heading sizes and dividers", () => {
  const html = renderRichMarkdown("# 제목\n\n* 상위\n  * 하위\n\n---");
  assert(html.includes("<h1>제목</h1>"));
  assert(html.includes("<li><p>상위</p><ul>"));
  assert(html.includes("<hr>"));
});

test("existing multiline prose keeps its line breaks when opened and saved", () => {
  const doc = parseRichText("첫 줄\n둘째 줄");
  assert.equal(doc.firstChild.child(1).type.name, "hard_break");
  assert(doc.eq(parseRichText(serializeRichText(doc))));
  assert(renderRichMarkdown("첫 줄\n둘째 줄").includes("첫 줄<br>둘째 줄"));
});

test("Backspace at a heading start clears formatting without deleting text", () => {
  for (const text of ["#", "## 제목", "### **강조**"]) {
    let state = EditorState.create({
      schema: richSchema,
      doc: parseRichText(text),
    });
    const original = state.doc.textContent;
    assert.equal(
      clearHeadingAtStart(state, (tr) => {
        state = state.apply(tr);
      }),
      true,
    );
    assert.equal(state.doc.firstChild.type.name, "paragraph");
    assert.equal(state.doc.textContent, original);
    assert.equal(clearHeadingAtStart(state), false);
  }
  let state = EditorState.create({
    schema: richSchema,
    doc: parseRichText("# 제목"),
  });
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 2)),
  );
  assert.equal(clearHeadingAtStart(state), false);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 1, 3)),
  );
  assert.equal(clearHeadingAtStart(state), false);
});
