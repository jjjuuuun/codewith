<script setup>
import { computed, ref } from "vue";
import RichTextInput from "../RichTextInput.vue";
const props = defineProps({
  tag: { type: String, required: true },
  attrs: { type: Object, required: true },
  content: [Array, Object, String, Number, Boolean],
  editor: { type: Object, required: true },
});
const inputAttrs = computed(() => {
  const { value, checked, selected, ...attrs } = props.attrs;
  return attrs;
});
const name = computed(() => props.attrs.name || props.attrs.id);
const selectControl = ref();
// Keep menus inside the native dialog's top layer, outside field containment.
const menuProps = computed(() => ({
  attach: selectControl.value?.$el?.closest("dialog") || false,
}));
const value = computed({
  get: () => props.editor.values[name.value] ?? "",
  set: (value) => {
    props.editor.values[name.value] = value;
  },
});
const rich = computed(
  () =>
    props.tag === "textarea" &&
    !props.attrs["data-plain-text"] &&
    !String(props.attrs.class || "").includes("file-editor") &&
    !["json", "table", "values", "copy", "code"].includes(props.attrs.name) &&
    !("data-row-text" in props.attrs),
);
const items = computed(() =>
  (props.content || [])
    .flat(Infinity)
    .filter((x) => x?.type === "option")
    .map((x) => ({
      title: [x.children || []].flat(Infinity).join(""),
      value: x.props?.value ?? "",
    })),
);
const checked = computed(() =>
  Array.isArray(value.value)
    ? value.value.includes(props.attrs.value)
    : !!value.value,
);
function changed(event) {
  if (props.attrs.type === "checkbox") {
    value.value = Array.isArray(value.value)
      ? event.target.checked
        ? [...value.value, props.attrs.value]
        : value.value.filter((x) => x !== props.attrs.value)
      : event.target.checked;
  } else if (props.attrs.type === "file")
    value.value = [...event.target.files].map((file) => [
      file.name,
      file.size,
      file.lastModified,
    ]);
  else value.value = event.target.value;
  const handler =
    props.editor.handlers[props.attrs.id] ||
    props.editor.handlers[props.attrs.name];
  if (handler)
    Promise.resolve(handler(event)).catch((e) => {
      props.editor.error = e.message;
    });
}
</script>
<template>
  <RichTextInput
    v-if="rich"
    v-bind="inputAttrs"
    v-model="value"
    :disabled="!!attrs.disabled || editor.busy"
  />
  <template v-else-if="tag === 'select'">
    <v-select
      ref="selectControl"
      :id="attrs.id"
      v-model="value"
      :items="items"
      :aria-label="attrs['aria-label'] || attrs.name"
      :disabled="!!attrs.disabled || editor.busy"
      :menu-props="menuProps"
      @update:model-value="changed({ target: { value: $event } })"
    />
    <input
      type="hidden"
      :name="attrs.name"
      :value="value"
    />
  </template>
  <textarea
    v-else-if="tag === 'textarea'"
    v-bind="inputAttrs"
    v-model="value"
    :disabled="!!attrs.disabled || editor.busy"
    @change="changed"
  />
  <input
    v-else-if="attrs.type === 'file'"
    v-bind="inputAttrs"
    :disabled="!!attrs.disabled || editor.busy"
    @change="changed"
  />
  <input
    v-else-if="attrs.type === 'checkbox' || attrs.type === 'radio'"
    v-bind="inputAttrs"
    :value="attrs.value || 'on'"
    :checked="checked"
    :disabled="!!attrs.disabled || editor.busy"
    @change="changed"
  />
  <input
    v-else
    v-bind="inputAttrs"
    v-model="value"
    :disabled="!!attrs.disabled || editor.busy"
    @change="changed"
  />
</template>

<style scoped>
input[type="checkbox"][role="switch"] {
  position: relative;
  display: inline-block;
  width: 44px;
  min-width: 44px;
  height: 26px;
  margin: 0;
  border: 0;
  border-radius: 999px;
  background: var(--muted);
}
input[type="checkbox"][role="switch"]::before {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 50%;
  background: #fff;
  opacity: 1;
  transform: none;
}
input[type="checkbox"][role="switch"]:checked {
  background: var(--green);
}
input[type="checkbox"][role="switch"]:checked::before {
  transform: translateX(18px);
}
</style>
