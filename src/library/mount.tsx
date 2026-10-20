import { render } from 'preact';
import { LibraryApp } from './ui/LibraryApp';

let mounted = false;

/** Mount the Preact library screen into its container once. The host wires the bridge/transport
 *  (see src/ui/shell.ts) before calling this. */
export function mountLibrary(root: HTMLElement): void {
  if (mounted) return;
  mounted = true;
  render(<LibraryApp />, root);
}
