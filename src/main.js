import { locale, t } from "./i18n/index.js";
import { en, ko } from "vuetify/locale";
import { createApp } from "vue";
import { createVuetify } from "vuetify";
import { aliases, mdi } from "vuetify/iconsets/mdi-svg";
import { VApp, VBtn, VSelect, VProgressLinear } from "vuetify/components";
import "vuetify/styles";
import "./styles/style.css";
import "./styles/theme.css";
import "./styles/controls.css";
import "./styles/vuetify.css";
import "./styles/plan-status.css";
import App from "./App.vue";
import CwButton from "./components/CwButton.vue";
import CwIcon from "./components/CwIcon.vue";
import MarkdownContent from "./components/MarkdownContent.vue";
import PageHeading from "./components/PageHeading.vue";
document.title = "CodeWith · " + t("함께 생각하고, 직접 만들다");
const vuetify = createVuetify({
  locale: { locale, fallback: "en", messages: { en, ko } },
  components: { VApp, VBtn, VSelect, VProgressLinear },
  icons: { defaultSet: "mdi", aliases, sets: { mdi } },
  defaults: {
    VBtn: { variant: "outlined", elevation: 0, rounded: "lg" },
    VSelect: { variant: "outlined", density: "compact", hideDetails: true },
  },
  theme: {
    defaultTheme: window.CodeWithTheme.resolved,
    themes: {
      light: {
        colors: {
          primary: "#6260b4",
          background: "#f7f7fb",
          surface: "#ffffff",
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: "#b7b5f1",
          background: "#171721",
          surface: "#21212f",
        },
      },
    },
  },
});
createApp(App)
  .use(vuetify)
  .component("CwButton", CwButton)
  .component("CwIcon", CwIcon)
  .component("MarkdownContent", MarkdownContent)
  .component("PageHeading", PageHeading)
  .mount("#app");
