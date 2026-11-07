// Clone Source panel and the source state shared by cloning and healing tools.
import type { Editor } from '../../editor';
import { installClonePanel } from './panel';

export function installCloneSource(e: Editor) {
  installClonePanel(e);
}
