import { defineComponent, h, isVNode, cloneVNode } from "vue";
import FormControl from "./FormControl.vue";
import CwButton from "../CwButton.vue";

// These are application-authored Vue VNodes, never HTML from a file or server.
export default defineComponent({
  name: "FormNodes",
  props: {
    nodes: [Array, Object, String, Number, Boolean],
    editor: Object,
  },
  setup(props) {
    function render(node) {
      if (Array.isArray(node)) return node.map(render);
      if (!isVNode(node)) return node;
      const original = node.props || {},
        key = original.id || original["data-action"];
      const attrs = { ...original, ...props.editor?.controls[key] };
      const children = props.editor?.overrides[key] ?? node.children;
      if (["input", "textarea", "select"].includes(node.type) && props.editor)
        return h(FormControl, {
          key: attrs.name || attrs.id,
          tag: node.type,
          attrs,
          content: children,
          editor: props.editor,
        });
      if (node.type === "button" && attrs["data-action"]) {
        return h(
          CwButton,
          {
            ...attrs,
            action: props.editor?.handlers[key]
              ? undefined
              : attrs["data-action"],
            onClick: props.editor?.handlers[key],
            disabled: attrs.disabled || props.editor?.busy,
          },
          { default: () => render(children) },
        );
      }
      if (typeof node.type === "string")
        return h(node.type, attrs, render(children));
      return cloneVNode(
        node,
        node.props?.formRows ? { editor: props.editor } : {},
      );
    }
    return () => render(props.nodes);
  },
});
