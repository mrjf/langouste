import { mount } from "svelte";
import App from "./App.svelte";
import LocalApp from "./LocalApp.svelte";
import "../client/app.css";
mount(import.meta.env.VITE_LOCAL_COURSE ? LocalApp : App, {target:document.getElementById("app")!});
