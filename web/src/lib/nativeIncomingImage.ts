import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type IncomingImage = { id: string; mime: string; size: number; createdAt: number };
const native = registerPlugin<{
  getIncomingImage(): Promise<{ image: IncomingImage | null }>;
  readIncomingImage(options: { id: string }): Promise<{ base64: string }>;
  discardIncomingImage(options: { id: string }): Promise<void>;
  addListener(name: 'incomingPhotoReady', listener: () => void): Promise<PluginListenerHandle>;
}>('NutritionDevice');

export const incomingImageAvailable = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NutritionDevice');
export async function peekIncomingImage() { return (await native.getIncomingImage()).image; }
export async function readIncomingImage(image: IncomingImage): Promise<File> {
  const { base64 } = await native.readIncomingImage({ id: image.id });
  const decoded = atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  return new File([bytes], 'shared-image', { type: image.mime });
}
export async function discardIncomingImage(id: string) { await native.discardIncomingImage({ id }); }
export const listenForIncomingImage = (listener: () => void) => native.addListener('incomingPhotoReady', listener);
