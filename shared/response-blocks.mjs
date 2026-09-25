// Find complete JSON values without repairing truncated strings or code.
function valueAt(text, start) {
  let quoted = false,
    escaped = false;
  const stack = [];
  const first = text[start];
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') {
        quoted = false;
        if (first === '"' && !stack.length) return parsed(i + 1);
      }
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") {
      if (!stack.length) return parsed(i);
      if (stack.pop() !== (c === "}" ? "{" : "[")) return null;
      if (!stack.length) return parsed(i + 1);
    } else if (!stack.length && /[\s,]/.test(c)) return parsed(i);
  }
  return null;
  function parsed(end) {
    try {
      return { value: JSON.parse(text.slice(start, end)), end };
    } catch {
      return null;
    }
  }
}

export function completedResponseFields(text) {
  const fields = {};
  let i = text.search(/\S/);
  if (text[i++] !== "{") return fields;
  const space = () => {
    while (/\s/.test(text[i] || "x")) i++;
  };
  while (i < text.length) {
    space();
    const key = valueAt(text, i);
    if (!key || typeof key.value !== "string") break;
    i = key.end;
    space();
    if (text[i++] !== ":") break;
    space();
    const value = valueAt(text, i);
    if (value) {
      fields[key.value] = value.value;
      i = value.end;
    } else {
      // Each file is a separate complete block, even while its siblings stream.
      if (key.value === "files" && text[i++] === "[") {
        fields.files = [];
        while (i < text.length) {
          space();
          const item = valueAt(text, i);
          if (!item) break;
          fields.files.push(item.value);
          i = item.end;
          space();
          if (text[i++] !== ",") break;
        }
      }
      break;
    }
    space();
    if (text[i++] !== ",") break;
  }
  return fields;
}

export function completedMarkdownBlocks(text) {
  let fence = null,
    offset = 0;
  for (const line of text.split(/(?<=\n)/)) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})([^\n]*)/);
    if (match) {
      if (!fence) fence = { marker: match[1], offset };
      else if (
        match[1][0] === fence.marker[0] &&
        match[1].length >= fence.marker.length &&
        !match[2].trim()
      )
        fence = null;
    }
    offset += line.length;
  }
  return fence ? text.slice(0, fence.offset) : text;
}

// Extract only the top-level message string from a partial structured answer.
// Never display the JSON envelope, proposal fields, or incomplete escape codes.
export function partialResponseMessage(raw) {
  function stringAt(start) {
    let value = "";
    for (let i = start + 1; i < raw.length; i++) {
      const char = raw[i];
      if (char === '"') return { value, end: i + 1, complete: true };
      if (char !== "\\") {
        value += char;
        continue;
      }
      const escaped = raw[++i];
      if (!escaped) break;
      if (escaped === "u") {
        const code = raw.slice(i + 1, i + 5);
        if (!/^[a-fA-F0-9]{4}$/.test(code)) break;
        value += String.fromCharCode(parseInt(code, 16));
        i += 4;
      } else {
        const escapes = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (!(escaped in escapes)) break;
        value += escapes[escaped];
      }
    }
    return {
      value: value.replace(/[\uD800-\uDBFF]$/, ""),
      end: raw.length,
      complete: false,
    };
  }
  let depth = 0;
  for (let i = raw.indexOf("{"); i >= 0 && i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") depth--;
    else if (raw[i] === '"') {
      const token = stringAt(i);
      if (depth === 1 && token.complete && token.value === "message") {
        const remainder = raw.slice(token.end).match(/^\s*:\s*"/);
        if (remainder)
          return stringAt(token.end + remainder[0].length - 1).value;
      }
      i = token.end - 1;
    }
  }
  return "";
}
