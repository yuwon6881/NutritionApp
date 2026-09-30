import {describe,expect,it} from 'vitest';
import {Style} from '@capacitor/status-bar';
import {statusBarStyleForTheme} from './nativeApp';

describe('native status bar contrast',()=>{
  it('uses light icons against the dark theme',()=>{
    expect(statusBarStyleForTheme(true)).toBe(Style.Dark);
  });
  it('uses dark icons against the light theme',()=>{
    expect(statusBarStyleForTheme(false)).toBe(Style.Light);
  });
});
