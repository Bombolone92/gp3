// Puter.js calls the file features need beyond src/persistence/puter.ts
// (multiple selection, directory picker, folder writes).
// https://docs.puter.com/UI/showOpenFilePicker/ · /UI/showDirectoryPicker/ · /FS/write/
import { puter } from '../../persistence/puter';

export interface CloudItem {
  path: string;
  name: string;
  isDir?: boolean;
  read(): Promise<Blob>;
}
type ExtendedPuter = {
  fs: {
    write(path: string, data: Blob, options?: { overwrite?: boolean; dedupeName?: boolean; createMissingParents?: boolean }): Promise<CloudItem>;
    read(path: string): Promise<Blob>;
  };
  ui: {
    showOpenFilePicker(options: { accept?: string | string[]; multiple?: boolean }): Promise<CloudItem | CloudItem[]>;
    showSaveFilePicker(content: Blob, name: string): Promise<CloudItem>;
    showDirectoryPicker(options?: { multiple?: boolean }): Promise<CloudItem | CloudItem[]>;
  };
};
const api = () => puter() as unknown as ExtendedPuter;

export const openAccept = '.photo,.psd,.psb,.tif,.tiff,.bmp,.dib,.gif,.ico,.cur,.tga,.pbm,.pgm,.ppm,.pnm,.pam,.svg,image/*';

export async function pickCloudFiles(multiple: boolean, accept = openAccept): Promise<CloudItem[]> {
  const r = await api().ui.showOpenFilePicker({ accept, multiple });
  return Array.isArray(r) ? r : [r];
}
export async function pickCloudFolder(): Promise<CloudItem> {
  const r = await api().ui.showDirectoryPicker({ multiple: false });
  return Array.isArray(r) ? r[0] : r;
}
/** Save picker; the promise never settles when the user cancels (Puter behavior). */
export function cloudSaveAs(blob: Blob, name: string) {
  return api().ui.showSaveFilePicker(blob, name);
}
export function cloudWrite(path: string, blob: Blob, opts: { dedupeName?: boolean } = {}) {
  return api().fs.write(path, blob, { overwrite: !opts.dedupeName, dedupeName: !!opts.dedupeName, createMissingParents: true });
}
export function cloudRead(path: string) {
  return api().fs.read(path);
}
export function joinPath(dir: string, name: string) {
  return `${dir.replace(/\/+$/, '')}/${name}`;
}
