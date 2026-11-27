import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadApi } from '../lib/download';
import { Button } from './ui/Button';
import { CardFeedback } from './ui/CardFeedback';
import { SettingRow } from './ui/SettingRow';
import { useAsyncAction } from './ui/useAsyncAction';

interface ExportRequest {
  path: string;
  filename: string;
  format: 'json' | 'csv';
}

/** Self-serve account export row inside Settings. */
export function DataExport() {
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [lastExport, setLastExport] = useState<ExportRequest>();
  const [activeFormat, setActiveFormat] = useState<'json' | 'csv' | null>(null);
  const { busy, run, pending } = useAsyncAction();

  const startDownload = async (request: ExportRequest) => {
    setLastExport(request);
    setActiveFormat(request.format);
    setError('');
    setStatus('');
    try {
      await run(() => downloadApi(request.path, request.filename));
      setStatus(request.format === 'json' ? 'Downloaded JSON export.' : 'Downloaded CSV ZIP export.');
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setActiveFormat(null);
    }
  };

  return <>
    <SettingRow
      id="data-export"
      label="Export your data"
      description={<>
        <span>Download a copy of every record in this account: diary entries, weigh-ins, body records, foods, and plans.</span>
        {status && !error && <span className="setting-row-status is-positive" role="status">{status}</span>}
      </>}
    >
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={() => void startDownload({ path: '/export', filename: 'nutrition-export.json', format: 'json' })}
      >
        <Download size={16} aria-hidden="true" />
        <span>{pending && activeFormat === 'json' ? 'Preparing…' : 'Download JSON'}</span>
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={() => void startDownload({ path: '/export/csv', filename: 'nutrition-export-csv.zip', format: 'csv' })}
      >
        <Download size={16} aria-hidden="true" />
        <span>{pending && activeFormat === 'csv' ? 'Preparing…' : 'Download CSV ZIP'}</span>
      </Button>
    </SettingRow>
    {error && <CardFeedback
      title="Export unavailable"
      message={error}
      action={lastExport ? { label: 'Try again', onClick: () => void startDownload(lastExport), disabled: busy } : undefined}
    />}
  </>;
}
