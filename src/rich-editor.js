import { t as __t } from "./i18n/index.js";
import { Schema, Fragment, Slice } from "prosemirror-model";
import { EditorState, Plugin, TextSelection } from "prosemirror-state";
import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import {
  schema as markdownSchema,
  MarkdownParser,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from "prosemirror-markdown";
import {
  baseKeymap,
  toggleMark,
  setBlockType,
  wrapIn,
  chainCommands,
  exitCode,
  lift,
} from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import {
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
  InputRule,
  undoInputRule,
} from "prosemirror-inputrules";
import {
  wrapInList,
  splitListItem,
  liftListItem,
  sinkListItem,
} from "prosemirror-schema-list";

const safeURL = (value) => {
  try {
    const u = new URL(value);
    return ["http:", "https:", "mailto:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
};
const linkSpec = {
  ...markdownSchema.spec.marks.get("link"),
  toDOM(mark) {
    const href = safeURL(mark.attrs.href);
    return [
      "a",
      href ? { href, rel: "noopener noreferrer", target: "_blank" } : {},
      0,
    ];
  },
};
const imageSpec = {
  ...markdownSchema.spec.nodes.get("image"),
  toDOM(node) {
    return [
      "span",
      { class: "rich-image-reference" },
      node.attrs.alt || __t("첨부 이미지"),
    ];
  },
};
export const richSchema = new Schema({
  nodes: markdownSchema.spec.nodes.update("image", imageSpec),
  marks: markdownSchema.spec.marks.update("link", linkSpec),
});
const parser = new MarkdownParser(richSchema, defaultMarkdownParser.tokenizer, {
  ...defaultMarkdownParser.tokens,
  softbreak: { node: "hard_break" },
});
function cleanFragment(fragment) {
  const nodes = [];
  fragment.forEach((node) => {
    const marks = node.marks.filter(
      (m) => m.type.name !== "link" || safeURL(m.attrs.href),
    );
    nodes.push(
      node.isText
        ? node.mark(marks)
        : node.copy(cleanFragment(node.content)).mark(marks),
    );
  });
  return Fragment.from(nodes);
}
export function parseRichText(text) {
  const doc = parser.parse(String(text || ""));
  return doc.copy(cleanFragment(doc.content));
}
export const serializeRichText = (doc) =>
  defaultMarkdownSerializer.serialize(doc, { tightLists: true });
export function clearHeadingAtStart(state, dispatch) {
  const { empty, $from } = state.selection;
  if (
    !empty ||
    $from.parentOffset !== 0 ||
    $from.parent.type !== richSchema.nodes.heading
  )
    return false;
  return setBlockType(richSchema.nodes.paragraph)(state, dispatch);
}
const instances = new WeakMap();
export const richEditorFor = (area) => instances.get(area);
export function setRichText(area, value) {
  const editor = instances.get(area);
  if (editor) editor.setValue(value);
  else if (area) {
    area.value = value;
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
export function insertRichText(area, text) {
  const editor = instances.get(area);
  if (editor) {
    editor.view.dispatch(editor.view.state.tr.insertText(text));
    editor.view.focus();
  } else if (area) {
    area.value += text;
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
const blocks = [
  ["paragraph", __t("텍스트"), __t("일반 문단"), "T"],
  ["heading1", __t("제목 1"), __t("큰 제목"), "H1"],
  ["heading2", __t("제목 2"), __t("중간 제목"), "H2"],
  ["heading3", __t("제목 3"), __t("작은 제목"), "H3"],
  ["bullet", __t("글머리 목록"), __t("항목을 나열하기"), "•"],
  ["ordered", __t("번호 목록"), __t("순서를 정리하기"), "1."],
  ["quote", __t("인용"), __t("중요한 문장 강조"), "❝"],
  ["code", __t("코드 블록"), __t("코드를 그대로 작성"), "</>"],
  ["divider", __t("구분선"), __t("내용 구분하기"), "—"],
];
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function renderRichMarkdown(text, { highlight } = {}) {
  const render = (node) => {
    const children = () => {
      const result = [];
      node.forEach((child) => result.push(render(child)));
      return result.join("");
    };
    let html;
    if (node.isText) {
      html = esc(node.text);
      for (const mark of node.marks) {
        if (mark.type.name === "strong") html = "<strong>" + html + "</strong>";
        else if (mark.type.name === "em") html = "<em>" + html + "</em>";
        else if (mark.type.name === "code") html = "<code>" + html + "</code>";
        else if (mark.type.name === "link" && safeURL(mark.attrs.href))
          html =
            '<a href="' +
            esc(safeURL(mark.attrs.href)) +
            '" target="_blank" rel="noopener noreferrer">' +
            html +
            "</a>";
      }
      return html;
    }
    switch (node.type.name) {
      case "doc":
        return children();
      case "paragraph":
        return "<p>" + children() + "</p>";
      case "heading":
        return (
          "<h" +
          node.attrs.level +
          ">" +
          children() +
          "</h" +
          node.attrs.level +
          ">"
        );
      case "bullet_list":
        return "<ul>" + children() + "</ul>";
      case "ordered_list":
        return (
          "<ol" +
          (node.attrs.order !== 1
            ? ' start="' + Number(node.attrs.order) + '"'
            : "") +
          ">" +
          children() +
          "</ol>"
        );
      case "list_item":
        return "<li>" + children() + "</li>";
      case "blockquote":
        return "<blockquote>" + children() + "</blockquote>";
      case "horizontal_rule":
        return "<hr>";
      case "hard_break":
        return "<br>";
      case "code_block":
        return (
          '<div class="code-block"><header><span>' +
          esc(node.attrs.params || __t("코드")) +
          __t(
            '</span><button type="button" data-action="copy-code" class="small ghost">복사</button></header><pre><code>',
          ) +
          (highlight?.(node.textContent, node.attrs.params) ??
            esc(node.textContent)) +
          "</code></pre></div>"
        );
      case "image":
        return (
          '<span class="rich-image-reference">' +
          esc(node.attrs.alt || __t("첨부 이미지")) +
          "</span>"
        );
      default:
        return children();
    }
  };
  return render(parseRichText(text));
}
function markRule(pattern, type) {
  return new InputRule(pattern, (state, match, start, end) =>
    state.tr
      .replaceWith(start, end, state.schema.text(match[1], [type.create()]))
      .removeStoredMark(type),
  );
}

export function mountRichEditor(area, { onChatSend, getSkills = () => [] }) {
  const chat = area.id === "chat-input",
    required = area.required;
  const wrap = document.createElement("div");
  wrap.className = "rich-editor" + (chat ? " rich-chat" : "");
  wrap.dataset.field = area.name || area.id;
  wrap.innerHTML = __t(
    '<div class="rich-toolbar" role="group" aria-label="텍스트 서식"><button type="button" data-rich="blocks" class="rich-block-button" aria-label="블록 종류 선택" aria-expanded="false">텍스트 <span>⌄</span></button><span class="rich-toolbar-divider"></span><button type="button" data-rich="bold" aria-label="굵게" title="굵게 · Ctrl/Cmd+B"><b>B</b></button><button type="button" data-rich="italic" aria-label="기울임" title="기울임 · Ctrl/Cmd+I"><i>I</i></button><button type="button" data-rich="inline-code" aria-label="인라인 코드" title="인라인 코드">&lt;/&gt;</button><button type="button" data-rich="link" aria-label="링크" title="링크">↗</button><span class="rich-toolbar-spacer"></span><button type="button" data-rich="undo" aria-label="실행 취소" title="실행 취소">↶</button><button type="button" data-rich="redo" aria-label="다시 실행" title="다시 실행">↷</button></div><div class="rich-surface"><button type="button" class="rich-add" data-rich="blocks" aria-label="블록 추가">+</button><div class="rich-mount"></div></div><div class="rich-menu" role="listbox" aria-label="블록 선택" hidden></div><div class="rich-link-editor" hidden><label>링크 주소<input type="text" inputmode="url" placeholder="https://" aria-label="링크 주소"></label><div><button type="button" data-rich="save-link">적용</button><button type="button" data-rich="remove-link">링크 제거</button><button type="button" data-rich="cancel-link">취소</button></div></div><small class="rich-error" role="status" aria-live="polite"></small>',
    [],
  );
  area.before(wrap);
  wrap.append(area);
  area.hidden = true;
  area.required = false;
  area.setAttribute("aria-hidden", "true");
  area.tabIndex = -1;
  const menu = wrap.querySelector(".rich-menu"),
    error = wrap.querySelector(".rich-error"),
    linkPanel = wrap.querySelector(".rich-link-editor"),
    label = document.querySelector(`label[for="${area.id}"]`);
  let view,
    range = null,
    menuItems = blocks,
    menuIndex = 0,
    manualMenu = false,
    menuKind = "block",
    closedSlash = null,
    linkSelection = null,
    syncing = false;
  const closeMenu = () => {
    menu.hidden = true;
    range = null;
    manualMenu = false;
    view?.dom.removeAttribute("aria-activedescendant");
    view?.dom.setAttribute("aria-expanded", "false");
    wrap
      .querySelector("[data-rich=blocks]")
      .setAttribute("aria-expanded", "false");
  };
  const command = (cmd) => {
    closeMenu();
    cmd(view.state, view.dispatch, view);
    view.focus();
  };
  function blockCommand(id) {
    const n = richSchema.nodes;
    if (id === "bullet" || id === "ordered") {
      const type = n[id === "bullet" ? "bullet_list" : "ordered_list"];
      let inside = false;
      for (let d = view.state.selection.$from.depth; d > 0; d--)
        if (view.state.selection.$from.node(d).type === type) inside = true;
      if (inside) return liftListItem(n.list_item);
      return (state, dispatch, editor) => {
        if (state.selection.$from.parent.type !== n.paragraph)
          setBlockType(n.paragraph)(state, dispatch);
        return wrapInList(type)(editor.state, dispatch, editor);
      };
    }
    if (id === "quote") return wrapIn(n.blockquote);
    if (id === "code") return setBlockType(n.code_block);
    if (id.startsWith("heading"))
      return setBlockType(n.heading, { level: Number(id.slice(-1)) });
    if (id === "divider")
      return (state, dispatch) => {
        dispatch(
          state.tr
            .replaceSelectionWith(n.horizontal_rule.create())
            .scrollIntoView(),
        );
        return true;
      };
    return chainCommands(
      liftListItem(n.list_item),
      lift,
      setBlockType(n.paragraph),
    );
  }
  function choose(id) {
    if (menuKind === "skill") {
      const token = range,
        skill = getSkills().find((x) => x.enabled && x.id === id);
      if (!skill || !token) {
        closeMenu();
        return;
      }
      const tr = view.state.tr.insertText(
        token.prefix + skill.id + " ",
        token.from,
        token.to,
      );
      closeMenu();
      view.dispatch(tr);
      view.focus();
      return;
    }
    if (range) view.dispatch(view.state.tr.delete(range.from, range.to));
    command(blockCommand(id));
  }
  function selectOption(index) {
    menuIndex = index;
    menu.querySelectorAll("[role=option]").forEach((b, i) => {
      b.setAttribute("aria-selected", String(i === menuIndex));
      if (i === menuIndex) {
        view.dom.setAttribute("aria-activedescendant", b.id);
        b.scrollIntoView({ block: "nearest" });
      }
    });
  }
  function showSkills(filter, token) {
    menuKind = "skill";
    menuItems = getSkills()
      .filter(
        (x) =>
          x.enabled &&
          (x.id + " " + x.name).toLowerCase().includes(filter.toLowerCase()),
      )
      .map((x) => [x.id, x.name, x.description]);
    if (!menuItems.length) {
      closeMenu();
      return;
    }
    range = token;
    menuIndex = 0;
    menu.setAttribute("aria-label", __t("스킬 선택"));
    menu.innerHTML =
      __t(
        '<div class="rich-menu-heading">스킬 <small>↑↓ 선택 · Tab / Enter 삽입</small></div>',
      ) +
      menuItems
        .map(
          ([id, name, description], i) =>
            `<button type="button" role="option" aria-selected="${i === 0}" data-skill="${esc(id)}" id="rich-skill-${area.id}-${esc(id)}"><span>$</span><span><b>${esc(name)}</b><small>$${esc(id)}</small></span></button>`,
        )
        .join("");
    menu.hidden = false;
    view.dom.setAttribute("aria-expanded", "true");
    view.dom.setAttribute("aria-controls", menu.id);
    view.dom.setAttribute(
      "aria-activedescendant",
      menu.querySelector("[role=option]").id,
    );
  }

  function showMenu(filter = "", slash = null) {
    menuKind = "block";
    menu.setAttribute("aria-label", __t("블록 선택"));
    menuItems = blocks.filter(([id, name, desc]) =>
      (id + " " + name + " " + desc)
        .toLowerCase()
        .includes(filter.toLowerCase()),
    );
    if (!menuItems.length) {
      closeMenu();
      return;
    }
    range = slash;
    menuIndex = 0;
    menu.innerHTML = menuItems
      .map(
        ([id, name, description, symbol], i) =>
          `<button type="button" role="option" aria-selected="${i === 0}" data-block="${id}" id="rich-option-${area.id}-${id}"><span>${esc(symbol)}</span><span><b>${name}</b><small>${description}</small></span></button>`,
      )
      .join("");
    menu.hidden = false;
    wrap
      .querySelector("[data-rich=blocks]")
      .setAttribute("aria-expanded", "true");
  }
  function updateMenu() {
    const sel = view.state.selection,
      $from = sel.$from;
    if (
      view.composing ||
      !sel.empty ||
      $from.parent.type !== richSchema.nodes.paragraph ||
      $from.marks().some((m) => m.type === richSchema.marks.code)
    ) {
      if (!manualMenu) closeMenu();
      return;
    }
    const before = $from.parent.textBetween(0, $from.parentOffset);
    if (closedSlash === before) {
      closeMenu();
      return;
    }
    closedSlash = null;
    if (chat) {
      const block = before.match(/^\/([^\s/]*)$/);
      if (block) {
        showMenu(block[1], { from: $from.start(), to: sel.from });
        return;
      }
      const skill = before.match(/(?:^|\s)([$])([^\s/$]*)$/);
      if (skill) {
        const from = sel.from - skill[1].length - skill[2].length;
        showSkills(skill[2], { from, to: sel.from, prefix: skill[1] });
        return;
      }
    } else {
      const match = before.match(/^\/([^\s/]*)$/);
      if (match) {
        showMenu(match[1], { from: $from.start(), to: sel.from });
        return;
      }
    }
    if (!manualMenu) closeMenu();
  }
  function updateToolbar() {
    const { selection, storedMarks } = view.state;
    for (const [name, type] of [
      ["bold", "strong"],
      ["italic", "em"],
      ["inline-code", "code"],
    ]) {
      const active = selection.empty
        ? (storedMarks || selection.$from.marks()).some(
            (m) => m.type === richSchema.marks[type],
          )
        : view.state.doc.rangeHasMark(
            selection.from,
            selection.to,
            richSchema.marks[type],
          );
      wrap
        .querySelector(`[data-rich="${name}"]`)
        .setAttribute("aria-pressed", String(active));
    }
    const node = selection.$from.parent,
      name = node.type.name;
    wrap.querySelector(".rich-block-button").firstChild.textContent =
      name === "heading"
        ? __t("제목 ") + node.attrs.level + " "
        : name === "code_block"
          ? __t("코드 ")
          : selection.$from.depth > 1 &&
              selection.$from.node(selection.$from.depth - 1).type.name ===
                "list_item"
            ? __t("목록 ")
            : __t("텍스트 ");
    wrap.querySelectorAll("button").forEach((b) => {
      b.disabled = area.disabled;
    });
  }
  const placeholderPlugin = new Plugin({
    props: {
      decorations(state) {
        if (state.doc.childCount !== 1 || state.doc.firstChild.content.size)
          return null;
        return DecorationSet.create(state.doc, [
          Decoration.node(0, state.doc.firstChild.nodeSize, {
            "data-placeholder":
              area.placeholder || __t("내용을 입력하세요. / 로 블록 추가"),
            class: "rich-empty",
          }),
        ]);
      },
    },
  });
  const enter = chainCommands(
    newlineForCode,
    splitListItem(richSchema.nodes.list_item),
    baseKeymap.Enter,
  );
  function newlineForCode(state, dispatch) {
    if (state.selection.$from.parent.type !== richSchema.nodes.code_block)
      return false;
    dispatch(state.tr.insertText("\n"));
    return true;
  }
  const rules = inputRules({
    rules: [
      textblockTypeInputRule(/^(#{1,3})\s$/, richSchema.nodes.heading, (m) => ({
        level: m[1].length,
      })),
      wrappingInputRule(/^\s*([-+*])\s$/, richSchema.nodes.bullet_list),
      wrappingInputRule(/^(\d+)\.\s$/, richSchema.nodes.ordered_list, (m) => ({
        order: +m[1],
      })),
      wrappingInputRule(/^>\s$/, richSchema.nodes.blockquote),
      textblockTypeInputRule(
        /^```([a-zA-Z0-9_-]*)\s$/,
        richSchema.nodes.code_block,
        (m) => ({ params: m[1] }),
      ),
      markRule(/\*\*([^*]+)\*\*$/, richSchema.marks.strong),
      markRule(/`([^`]+)`$/, richSchema.marks.code),
    ],
  });
  const stateFor = (text) =>
    EditorState.create({
      schema: richSchema,
      doc: parseRichText(text),
      plugins: [
        placeholderPlugin,
        rules,
        history(),
        keymap({
          "Mod-k": () => {
            act("link");
            return true;
          },
          "Mod-Alt-1": setBlockType(richSchema.nodes.heading, { level: 1 }),
          "Mod-Alt-2": setBlockType(richSchema.nodes.heading, { level: 2 }),
          "Mod-Alt-3": setBlockType(richSchema.nodes.heading, { level: 3 }),
          "Mod-Alt-0": setBlockType(richSchema.nodes.paragraph),
          "Mod-Shift-7": wrapInList(richSchema.nodes.ordered_list),
          "Mod-Shift-8": wrapInList(richSchema.nodes.bullet_list),
          "Mod-z": undo,
          "Shift-Mod-z": redo,
          "Mod-y": redo,
          "Mod-b": toggleMark(richSchema.marks.strong),
          "Mod-i": toggleMark(richSchema.marks.em),
          "Mod-`": toggleMark(richSchema.marks.code),
          "Mod-Enter": exitCode,
          Tab: sinkListItem(richSchema.nodes.list_item),
          "Shift-Tab": liftListItem(richSchema.nodes.list_item),
          Backspace: chainCommands(
            undoInputRule,
            clearHeadingAtStart,
            baseKeymap.Backspace,
          ),
          Enter: enter,
          "Shift-Enter": chat
            ? enter
            : chainCommands(exitCode, (state, dispatch) => {
                dispatch(
                  state.tr
                    .replaceSelectionWith(richSchema.nodes.hard_break.create())
                    .scrollIntoView(),
                );
                return true;
              }),
        }),
        keymap(baseKeymap),
      ],
    });
  view = new EditorView(wrap.querySelector(".rich-mount"), {
    state: stateFor(area.value),
    editable: () => !area.disabled && !area.readOnly,
    attributes: {
      role: "textbox",
      "aria-multiline": "true",
      "aria-label":
        area.getAttribute("aria-label") || label?.textContent || __t("내용"),
      id: area.id + "-editor",
      spellcheck: "false",
    },
    transformPasted: (slice) =>
      new Slice(cleanFragment(slice.content), slice.openStart, slice.openEnd),
    handleClick(view, pos, event) {
      if (event.target.closest("a")) {
        event.preventDefault();
        return true;
      }
      return false;
    },
    handleKeyDown(view, event) {
      if (view.composing || event.isComposing || event.keyCode === 229)
        return false;
      if (!menu.hidden) {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          selectOption(
            (menuIndex +
              (event.key === "ArrowDown" ? 1 : -1) +
              menuItems.length) %
              menuItems.length,
          );
          return true;
        }
        if (
          (event.key === "Enter" &&
            !event.shiftKey &&
            !event.ctrlKey &&
            !event.metaKey) ||
          (menuKind === "skill" && event.key === "Tab" && !event.shiftKey)
        ) {
          event.preventDefault();
          choose(menuItems[menuIndex][0]);
          return true;
        }
        if (event.key === "Escape") {
          closedSlash = view.state.selection.$from.parent.textBetween(
            0,
            view.state.selection.$from.parentOffset,
          );
          event.preventDefault();
          closeMenu();
          return true;
        }
      }
      if (
        chat &&
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        if (!area.disabled) onChatSend?.();
        return true;
      }
      return false;
    },
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      if (
        tr.docChanged &&
        area.maxLength >= 0 &&
        serializeRichText(next.doc).length > area.maxLength
      ) {
        error.textContent = __t("최대 {0}자까지 작성할 수 있습니다.", [
          area.maxLength.toLocaleString(),
        ]);
        return;
      }
      view.updateState(next);
      if (tr.docChanged) {
        syncing = true;
        area.value = serializeRichText(next.doc);
        area.dispatchEvent(new Event("input", { bubbles: true }));
        syncing = false;
        error.textContent = "";
      }
      updateToolbar();
      updateMenu();
    },
  });
  function act(action) {
    if (area.disabled || area.readOnly) return;
    if (action === "skills" && chat) {
      view.focus();
      if (view.state.selection.$from.parent.type !== richSchema.nodes.paragraph)
        setBlockType(richSchema.nodes.paragraph)(view.state, view.dispatch);
      closedSlash = null;
      updateMenu();
      if (!menu.hidden && menuKind === "skill") return;
      const $from = view.state.selection.$from,
        before = $from.parent.textBetween(0, $from.parentOffset);
      showSkills("", {
        from: view.state.selection.from,
        to: view.state.selection.to,
        prefix: (before && !/\s$/.test(before) ? " " : "") + "$",
      });
      if (menu.hidden) {
        error.textContent = __t(
          "활성화된 스킬이 없습니다. 공통 설정 · 스킬에서 추가하세요.",
        );
      }
      return;
    }
    if (action === "blocks") {
      if (!menu.hidden) {
        closeMenu();
        return;
      }
      manualMenu = true;
      showMenu();
      return;
    }
    if (action === "bold" || action === "italic" || action === "inline-code")
      return command(
        toggleMark(
          richSchema.marks[
            { bold: "strong", italic: "em", "inline-code": "code" }[action]
          ],
        ),
      );
    if (action === "undo") return command(undo);
    if (action === "redo") return command(redo);
    if (action === "link") {
      linkSelection = view.state.selection;
      linkPanel.hidden = false;
      const link = view.state.selection.$from
        .marks()
        .find((m) => m.type === richSchema.marks.link);
      linkPanel.querySelector("input").value = link?.attrs.href || "";
      linkPanel.querySelector("input").focus();
      return;
    }
    if (action === "cancel-link") {
      linkPanel.hidden = true;
      view.focus();
      return;
    }
    if (action === "save-link" || action === "remove-link") {
      const href = safeURL(linkPanel.querySelector("input").value);
      if (action === "save-link" && !href) {
        error.textContent = __t(
          "http://, https:// 또는 mailto: 링크를 입력하세요.",
        );
        return;
      }
      const selection = linkSelection || view.state.selection;
      let tr = view.state.tr.setSelection(selection);
      if (action === "remove-link")
        tr = tr.removeMark(selection.from, selection.to, richSchema.marks.link);
      else if (selection.empty) {
        const from = selection.from;
        tr = tr
          .insertText(href)
          .addMark(
            from,
            from + href.length,
            richSchema.marks.link.create({ href }),
          );
      } else
        tr = tr.addMark(
          selection.from,
          selection.to,
          richSchema.marks.link.create({ href }),
        );
      view.dispatch(tr);
      linkPanel.hidden = true;
      view.focus();
    }
  }
  linkPanel.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      act("save-link");
    } else if (e.key === "Escape") {
      e.preventDefault();
      act("cancel-link");
    }
  });
  wrap.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });
  wrap.addEventListener("click", (e) => {
    const skill = e.target.closest("[data-skill]"),
      block = e.target.closest("[data-block]"),
      button = e.target.closest("[data-rich]");
    if (skill) choose(skill.dataset.skill);
    else if (block) choose(block.dataset.block);
    else if (button) act(button.dataset.rich);
  });
  const externalInput = () => {
    if (!syncing) {
      view.updateState(stateFor(area.value));
      updateToolbar();
      closeMenu();
    }
  };
  area.addEventListener("input", externalInput);
  const labelClick = (e) => {
    e.preventDefault();
    view.focus();
  };
  label?.addEventListener("click", labelClick);
  const api = {
    area,
    wrap,
    view,
    command: act,
    setValue(value) {
      area.value = value;
      view.updateState(stateFor(value));
      area.dispatchEvent(new Event("input", { bubbles: true }));
    },
    destroy() {
      view.destroy();
      label?.removeEventListener("click", labelClick);
      area.removeEventListener("input", externalInput);
      instances.delete(area);
    },
    validate() {
      if (required && !view.state.doc.textContent.trim()) {
        error.textContent = __t("내용을 입력하세요.");
        view.focus();
        return false;
      }
      return true;
    },
    closeMenu,
  };
  menu.id = "rich-menu-" + area.id;
  instances.set(area, api);
  updateToolbar();
  return api;
}
