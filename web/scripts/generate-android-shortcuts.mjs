import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NUTRITION_SHORTCUTS } from '../src/lib/nutritionShortcuts.ts';

const resources = resolve(import.meta.dirname, '../android/app/src/main/res');
const xml = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
writeFileSync(resolve(resources, 'xml/shortcuts.xml'), `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated from nutritionShortcuts.ts; run generate-android-shortcuts.mjs. -->
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
${NUTRITION_SHORTCUTS.map(shortcut => `  <shortcut android:shortcutId="${shortcut.action}" android:enabled="true" android:icon="@mipmap/ic_launcher" android:shortcutShortLabel="@string/shortcut_${shortcut.action.replaceAll('-', '_')}">
    <intent android:action="com.nutritionapp.mobile.SHORTCUT" android:targetPackage="com.nutritionapp.mobile" android:targetClass="com.nutritionapp.mobile.MainActivity">
      <extra android:name="nutrition_action" android:value="${shortcut.action}" />
    </intent>
  </shortcut>`).join('\n')}
</shortcuts>
`);
writeFileSync(resolve(resources, 'values/shortcuts.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
${NUTRITION_SHORTCUTS.map(shortcut => `  <string name="shortcut_${shortcut.action.replaceAll('-', '_')}">${xml(shortcut.shortName)}</string>`).join('\n')}
</resources>
`);
