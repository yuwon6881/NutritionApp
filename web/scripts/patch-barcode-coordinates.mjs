import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The pinned adapter passes unrotated dimensions with upright ML Kit corner points.
// Keep this small compatibility patch until upstream supplies rotation in its event contract.
const file = resolve(
  import.meta.dirname,
  '../node_modules/@capacitor-mlkit/barcode-scanning/android/src/main/java/io/capawesome/capacitorjs/plugins/mlkit/barcodescanning/BarcodeScanner.java'
);
const original = 'Point imageSize = new Point(inputImage.getWidth(), inputImage.getHeight());';
const patched = `Point imageSize = imageProxy.getImageInfo().getRotationDegrees() % 180 == 0
            ? new Point(inputImage.getWidth(), inputImage.getHeight())
            : new Point(inputImage.getHeight(), inputImage.getWidth());`;
const source = readFileSync(file, 'utf8');
if (!source.includes(patched)) {
  if (!source.includes(original)) throw new Error('ML Kit coordinate adapter changed; review rotation before building.');
  writeFileSync(file, source.replace(original, patched));
}
