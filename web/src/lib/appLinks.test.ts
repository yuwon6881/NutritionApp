import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {APP_LINK_ROUTES,appLinkRoute} from './appLinks';

const origin='https://nutrition-diary-app.vercel.app';
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');

describe('Android App Links',()=>{
  it('maps only /open/ links on the app origin to in-app routes',()=>{
    expect(appLinkRoute(`${origin}/open`,origin)).toBe('/');
    expect(appLinkRoute(`${origin}/open/`,origin)).toBe('/');
    expect(appLinkRoute(`${origin}/open/coach?from=mail#top`,origin)).toBe('/coach');
    expect(appLinkRoute(`${origin}/open/settings/`,origin)).toBe('/settings');
  });

  it('rejects the browser sign-in and consent destinations, other hosts and unknown pages',()=>{
    for(const url of [`${origin}/`,`${origin}/settings`,`${origin}/coach`,`${origin}/api/auth/central/callback`,
      `${origin}/open/api`,`${origin}/openx`,`${origin}/open/coach/extra`,'http://nutrition-diary-app.vercel.app/open/coach',
      'https://other.test/open/coach','javascript:alert(1)','not a url'])
      expect(appLinkRoute(url,origin)).toBeNull();
    expect(appLinkRoute(undefined,origin)).toBeNull();
  });

  it('keeps the manifest, hosting redirects and asset links in agreement',()=>{
    const manifest=read('../../android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:autoVerify="true"');
    expect(manifest).toContain('android:host="nutrition-diary-app.vercel.app" android:path="/open"');
    expect(manifest).toContain('android:host="nutrition-diary-app.vercel.app" android:pathPrefix="/open/"');
    expect(manifest).not.toMatch(/android:path="\/(settings|coach)?"/);
    const routes=JSON.parse(read('../../vercel.json')).routes as {src:string;status?:number;headers?:Record<string,string>}[];
    for(const [link,route] of Object.entries(APP_LINK_ROUTES)){
      const redirect=routes.find(item=>item.status===308&&new RegExp(`^${item.src}$`).test(link));
      expect(redirect?.headers?.Location).toBe(route);
    }
    const [statement]=JSON.parse(read('../../public/.well-known/assetlinks.json'));
    expect(statement.relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(statement.target.package_name).toBe('com.nutritionapp.mobile');
    expect(statement.target.sha256_cert_fingerprints.length).toBeGreaterThan(0);
    for(const print of statement.target.sha256_cert_fingerprints)expect(print).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});
