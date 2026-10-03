import '@fontsource-variable/inter/index.css';
import {createRoot} from 'react-dom/client';
import {registerAppServiceWorker} from './lib/registerAppServiceWorker';
import {initializeNativeApp,isNativeApp} from './lib/nativeApp';
import {watchVirtualKeyboard} from './lib/virtualKeyboard';
import App from './App';
import {MobilePwaProvider} from './components/ui/MobilePwa';
import {applyTheme,initialTheme} from './lib/theme';
import './index.css';
import './touch.css';
import './logging.css';
import './check-in.css';
import './progress.css';
import './barcode.css';
import './accessibility.css';
import {measurePerformance} from './lib/performance';
import {ErrorBoundary} from './components/ui/ErrorBoundary';
import {migrateLegacyLocalStorage} from './lib/legacyStorage';
// Before anything reads the session, theme, or device keys under their current names.
try{migrateLegacyLocalStorage(localStorage);}catch{/* Storage can be unavailable; nothing to move. */}
const startupFinished=measurePerformance('startup.usable');
void registerAppServiceWorker().catch(()=>{});
void initializeNativeApp().catch(()=>{});
if(!isNativeApp())watchVirtualKeyboard();
applyTheme(initialTheme());
createRoot(document.getElementById('root')!).render(<ErrorBoundary><MobilePwaProvider><App onUsable={startupFinished}/></MobilePwaProvider></ErrorBoundary>);
