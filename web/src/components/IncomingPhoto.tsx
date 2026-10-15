import { useEffect, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import { prepareImage } from '../lib/image';
import { createFoodScanDraft, type FoodScanDraft } from '../lib/foodScans';
import { database, notifyFoodScanDraftsChanged, readFoodScanDraft } from '../lib/local';
import { writeIncomingPhotoDraft } from '../lib/incomingPhotoDraft';
import { discardIncomingImage, incomingImageAvailable, listenForIncomingImage, peekIncomingImage, readIncomingImage, type IncomingImage } from '../lib/nativeIncomingImage';
import { Button } from './ui/Button';
import { CardFeedback } from './ui/CardFeedback';
import { DatePicker } from './ui/DatePicker';
import { Modal } from './ui/Modal';
import { SegmentedControl } from './ui/SegmentedControl';

export function IncomingPhoto({ accountId, displayName, initialDate, blocked, onAttached }: {
  accountId: string; displayName: string; initialDate: string; blocked: boolean; onAttached: (date: string) => void;
}) {
  const [image, setImage] = useState<IncomingImage | null>(null);
  const [date, setDate] = useState(initialDate);
  const [mode, setMode] = useState<'photo' | 'label'>('photo');
  const [existing, setExisting] = useState<FoodScanDraft>();
  const [checked, setChecked] = useState(false);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = useRef(true);
  useEffect(() => {
    current.current = true;
    if (!incomingImageAvailable()) return;
    const read = () => { void peekIncomingImage().then(value => {
      if (current.current) { setImage(value); if (value) setOpen(true); }
    }).catch(() => { if (current.current) setError('The shared photo could not be checked. Return to the app to retry.'); }); };
    read();
    const incoming = listenForIncomingImage(read);
    const resumed = App.addListener('appStateChange', ({ isActive }) => { if (isActive) read(); });
    return () => { current.current = false; void incoming.then(handle => handle.remove()); void resumed.then(handle => handle.remove()); };
  }, [accountId]);
  useEffect(() => {
    let active = true;
    setChecked(false);
    setError('');
    void readFoodScanDraft(accountId, date).then(value => {
      if (active) { setExisting(value); setChecked(true); }
    }).catch(() => { if (active) setError('The existing draft could not be checked. Your shared image is still waiting.'); });
    return () => { active = false; };
  }, [accountId, date, image?.id]);
  useEffect(() => {
    if (!image) return;
    const timer = window.setTimeout(() => {
      void peekIncomingImage().then(value => { if (current.current) setImage(value); }).catch(() => undefined);
    }, Math.max(0, image.createdAt + 24 * 60 * 60 * 1000 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [image?.id, image?.createdAt]);
  if (!incomingImageAvailable()) return null;
  const discard = async () => {
    if (!image) return;
    setBusy(true);
    try { await discardIncomingImage(image.id); if (current.current) setImage(null); }
    catch { if (current.current) setError('The shared image could not be discarded. Try again.'); }
    finally { if (current.current) setBusy(false); }
  };
  const attach = async () => {
    if (!image || !checked || blocked) return;
    setBusy(true);
    setError('');
    try {
      const photo = await prepareImage(await readIncomingImage(image));
      if (!current.current) return;
      const draft = createFoodScanDraft({ date, mode, description: '', imageBase64: photo }, image.id);
      const attached = await writeIncomingPhotoDraft(await database(), accountId, draft, existing);
      if (!attached) {
        const latest = await readFoodScanDraft(accountId, date);
        if (current.current) { setExisting(latest); setError('This date’s draft changed. Review Keep existing or Replace again.'); }
        return;
      }
      notifyFoodScanDraftsChanged();
      await discardIncomingImage(image.id);
      if (current.current) { setImage(null); onAttached(date); }
    } catch (failure) {
      if (current.current) setError(failure instanceof Error ? failure.message : 'The shared image could not be attached. It is still on this device.');
    } finally { if (current.current) setBusy(false); }
  };
  if (!image) return error ? <CardFeedback title="Shared photo" message={error}/> : null;
  if (blocked || !open) return <CardFeedback tone="info" title="Shared photo waiting" message="Close the food editor to confirm its account, date and scan type."
    action={{ label: 'Review photo', disabled: blocked, onClick: () => setOpen(true) }}/>;
  return <Modal open={open} title="Attach shared photo" onClose={() => setOpen(false)} preventDismiss={busy} width="sm">
    <p>Destination account: <strong>{displayName}</strong></p>
    <DatePicker label="Diary date" value={date} onChange={setDate} disabled={busy}/>
    <SegmentedControl label="Use image as" value={mode} onChange={setMode}
      options={[{ value: 'photo', label: 'Meal photo', disabled: busy }, { value: 'label', label: 'Nutrition label', disabled: busy }]}/>
    <p>The image stays on this device until you request an estimate or label reading in the food editor.</p>
    {existing && existing.id !== image.id && <p>This date already has a saved scan draft. Replace it only if you no longer need it.</p>}
    {error && <CardFeedback title="Photo not attached" message={error}/>}
    <div className="actions">
      <Button variant="secondary" disabled={busy} onClick={() => void discard()}>{existing ? 'Keep existing' : 'Discard'}</Button>
      <Button variant="primary" disabled={busy || !checked} onClick={() => void attach()}>{busy ? 'Attaching…' : existing && existing.id !== image.id ? 'Replace draft' : 'Attach photo'}</Button>
    </div>
  </Modal>;
}
