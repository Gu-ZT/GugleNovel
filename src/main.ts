import { createApp } from "vue";
import App from "./App.vue";
import {router} from "./router";

document.body.setAttribute("arco-theme", "dark");

const app = createApp(App);
app.use(router);
void router.isReady().then(() => app.mount("#app"));
