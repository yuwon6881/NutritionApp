import {test,expect} from '@playwright/test';
import {seedMobileUser} from './helpers/seed';

for(const width of [390,768,1440])for(const theme of ['light','dark']){
  test(`weigh-in confirmation and themed undo at ${width}px ${theme}`,async({page,context,request},testInfo)=>{
    const session=await seedMobileUser(request,`weight-delete-${width}-${theme}`,[]);
    await context.addCookies(session.cookies);
    await page.setViewportSize({width,height:900});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.addInitScript(value=>localStorage.setItem('nutrition-theme',value),theme);
    await page.goto('/');
    await page.getByRole('button',{name:'Progress',exact:true}).click();
    const rows=page.locator('.weigh-in-list .weigh-in-row');
    await expect(rows.first()).toBeVisible();
    const before=await rows.count();
    const trigger=rows.first().getByRole('button',{name:/^Delete weigh-in from /});
    const dialog=page.getByRole('dialog',{name:'Delete weigh-in?',exact:true});
    await trigger.click();
    await expect(dialog).toContainText('kg');
    await expect(dialog).toContainText('five seconds');
    await expect(rows).toHaveCount(before);
    await page.screenshot({path:testInfo.outputPath('weigh-in-confirmation.png')});
    await expect(dialog.getByRole('button',{name:'Close dialog',exact:true})).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button',{name:'Delete weigh-in',exact:true})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button',{name:'Close dialog',exact:true})).toBeFocused();
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    // Escape only targets the native modal after its opening frame moves focus inside.
    await expect(dialog.getByRole('button',{name:'Close dialog',exact:true})).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByRole('button',{name:'Delete weigh-in',exact:true}).click();
    await expect(dialog).toBeHidden();
    await expect(rows).toHaveCount(before-1);
    await expect(page.getByRole('heading',{name:'Progress',exact:true,level:1})).toBeFocused();
    const toast=page.locator('.undo-toast');
    await expect(toast).toBeVisible();
    const appearance=await toast.evaluate(element=>{
      const style=getComputedStyle(element);
      const root=getComputedStyle(document.documentElement);
      const button=element.querySelector('button')!;
      const rect=button.getBoundingClientRect();
      return {
        background:style.backgroundColor,
        card:root.getPropertyValue('--card').trim(),
        buttonHeight:rect.height,
        buttonWidth:rect.width,
        overflow:document.documentElement.scrollWidth>innerWidth,
        within:element.getBoundingClientRect().left>=0&&element.getBoundingClientRect().right<=innerWidth,
      };
    });
    // Normalize the token through the browser's color parser.
    const card=await page.evaluate(value=>{
      const probe=document.createElement('span');probe.style.color=value;document.body.append(probe);
      const color=getComputedStyle(probe).color;probe.remove();return color;
    },appearance.card);
    expect(appearance.background).toBe(card);
    expect(appearance.buttonHeight).toBeGreaterThanOrEqual(44);
    expect(appearance.buttonWidth).toBeGreaterThanOrEqual(44);
    expect(appearance.overflow).toBe(false);
    expect(appearance.within).toBe(true);
    await page.screenshot({path:testInfo.outputPath('themed-undo.png')});
    await toast.getByRole('button',{name:'Undo',exact:true}).click();
    await expect(rows).toHaveCount(before);
  });
}
