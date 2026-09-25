import js from "@eslint/js";
import vue from "eslint-plugin-vue";
import globals from "globals";
export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      ".codewith/**",
      "data/**",
      "release/**",
      "public/text-editor.js",
      "public/auth-wait.js",
    ],
  },
  js.configs.recommended,
  ...vue.configs["flat/essential"],
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Existing action adapters deliberately accept unused callback arguments.
      "no-unused-vars": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "vue/no-mutating-props": "off", // Shared editor drafts are owned by useEditors.
    },
  },
  {
    files: [
      "server/chat-attachments.mjs",
      "server/claude-auth.mjs",
      "shared/source-policy.mjs",
    ],
    rules: { "no-control-regex": "off" },
  }, // These sanitizers intentionally match control bytes.
  { files: ["tests/**"], rules: { "require-yield": "off" } }, // Empty async iterators model streams with no files.
];
