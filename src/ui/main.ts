import './style.css';
import { App } from './app';
import { sound } from './sound';

sound.install();
const app = new App(document.getElementById('app')!);
// handle for poking at the running game from the browser console while developing
if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
