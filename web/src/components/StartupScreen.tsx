import {Brand} from './ui/Brand';

/** The first frame while the saved account opens. scripts/boot-shell.ts also draws it into index.html. */
export function StartupScreen(){
  return <main className="startup"><Brand size={38}/></main>;
}
