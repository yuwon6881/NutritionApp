import '@fontsource-variable/inter/index.css';
import {createRoot} from 'react-dom/client';
import {registerAppServiceWorker} from './lib/registerAppServiceWorker';
import App from './App';
import {MobilePwaProvider} from './components/ui/MobilePwa';
import './index.css';
void registerAppServiceWorker().catch(()=>{});
createRoot(document.getElementById('root')!).render(<MobilePwaProvider><App/></MobilePwaProvider>);
