import { render } from 'preact';
import { setBridge, type LibraryBridge } from './store';
import { LibraryApp } from './ui/LibraryApp';

let mounted = false;

/** Mount the Preact library screen into its container once, wiring it back to the host app. */
export function mountLibrary(root: HTMLElement, bridge: LibraryBridge): void {
  setBridge(bridge);
  if (mounted) return;
  mounted = true;
  render(<LibraryApp />, root);
}
