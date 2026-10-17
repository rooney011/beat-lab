import './styles/fonts.css';
import './styles/app.css';
import { App } from './app';
import { Shell } from './ui/shell';
import { byId } from './ui/dom';

function boot(): void {
  const root = byId('app');
  try {
    const app = new App({
      root,
      stage: byId<HTMLCanvasElement>('stage'),
      strip: byId<HTMLCanvasElement>('strip'),
      art: byId<HTMLCanvasElement>('art'),
      fileInput: byId<HTMLInputElement>('file'),
    });
    new Shell(app);
    app.start();
    // Debug handle for the console and end-to-end tests: dev builds, or any build with ?debug in the URL.
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug'))
      (window as unknown as { beatLab: App }).beatLab = app;
  } catch (err) {
    console.error(err);
    const msg = document.createElement('p');
    msg.className = 'fatal';
    msg.textContent = "BEAT LAB couldn't start in this browser. Try a recent Chrome, Edge, Firefox or Safari.";
    root.replaceChildren(msg);
  }
}

boot();
