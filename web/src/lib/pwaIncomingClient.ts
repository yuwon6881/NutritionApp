import { database } from './local';
import {
  discardPwaIncomingImageFromDb,
  peekPwaIncomingImageFromDb,
  readPwaIncomingFileFromDb,
  type PwaIncomingSummary,
} from './pwaIncomingImage';

export const PWA_SHARE_READY_EVENT = 'nutrition-pwa-share-ready';

export async function peekPwaIncomingImage(): Promise<PwaIncomingSummary | null> {
  return peekPwaIncomingImageFromDb(await database());
}

export async function readPwaIncomingFile(id: string): Promise<File> {
  return readPwaIncomingFileFromDb(await database(), id);
}

export async function discardPwaIncomingImage(id?: string): Promise<void> {
  await discardPwaIncomingImageFromDb(await database(), id);
}
