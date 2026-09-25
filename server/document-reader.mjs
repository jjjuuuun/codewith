import { LIMITS } from "../shared/config.mjs";
import { parentPort, workerData } from "node:worker_threads";
try {
  const bytes = Buffer.from(workerData.bytes);
  let text = "";
  if (workerData.mime === "application/pdf") {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
    });
    const document = await loading.promise;
    try {
      if (document.numPages > 150) throw Error("too many pages");
      for (let i = 1; i <= document.numPages; i++) {
        const content = await (await document.getPage(i)).getTextContent();
        text +=
          `\n[페이지 ${i}]\n` +
          content.items
            .map((item) => item.str + (item.hasEOL ? "\n" : " "))
            .join("");
        if (text.length > LIMITS.attachmentTextChars) throw Error("too large");
      }
      if (!text.replace(/\[페이지 \d+\]/g, "").trim()) text = "";
    } finally {
      await loading.destroy();
    }
  } else {
    const mammoth = await import("mammoth");
    text = (
      await mammoth.default.extractRawText(
        { buffer: bytes },
        { externalFileAccess: false },
      )
    ).value;
  }
  parentPort.postMessage({ text });
} catch {
  parentPort.postMessage({ error: true });
}
