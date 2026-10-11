import {expect,type Page} from '@playwright/test';

/**
 * Ensures all finite animations on the page have completed and frames settled.
 */
export async function waitSettled(page:Page){
  await page.evaluate(async()=>{
    const anims=document.getAnimations().filter(a=>{
      const t=a.effect?.getTiming();
      return !t||t.iterations!==Infinity;
    });
    await Promise.all(anims.map(a=>a.finished.catch(()=>{})));
  });
}

/**
 * Asserts document horizontal containment.
 * Preserves viewport width + 1 allowance for fractional subpixel rendering.
 */
export async function assertContained(page:Page){
  const width=page.viewportSize()!.width;
  await expect.poll(async()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
}

/**
 * Asserts regular visible modal bodies and dialog scroll surfaces fit their client width.
 */
export async function assertDialogScrollContained(page:Page){
  for(const body of await page.locator('.modal-body:visible').all()){
    expect(await body.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  }
}

/**
 * Asserts that a modal body is vertically scrollable when content exceeds viewport.
 */
export async function assertDialogBodyScroll(page:Page,dialogLocator=page.getByRole('dialog')){
  const modalBody=dialogLocator.locator('.modal-body:visible').first();
  await expect(modalBody).toBeVisible();
  const overflowY=await modalBody.evaluate(el=>getComputedStyle(el).overflowY);
  expect(['auto','scroll']).toContain(overflowY);
}

/**
 * Asserts an action element is in viewport, unobscured, and clickable at its center point.
 */
export async function assertActionClickable(elLocator:import('@playwright/test').Locator){
  await expect(elLocator).toBeVisible();
  await elLocator.evaluate(el=>el.scrollIntoView({block:'nearest'}));
  const unobscured=await elLocator.evaluate(el=>{
    const r=el.getBoundingClientRect();
    const topEl=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return el.contains(topEl)||topEl?.closest('button')===el;
  });
  expect(unobscured).toBe(true);
}

/**
 * Captures settled fullpage and viewport screenshots to artifacts/responsive-boundaries/.
 * Uses plain naming without emoji or special characters.
 */
export async function captureBoundary(page:Page,name:string){
  await page.evaluate(()=>document.fonts.ready);
  await assertContained(page);
  await assertDialogScrollContained(page);
  await waitSettled(page);
  await page.screenshot({path:`artifacts/responsive-boundaries/${name}.png`,fullPage:true,animations:'disabled'});
  await page.screenshot({path:`artifacts/responsive-boundaries/${name}-viewport.png`,animations:'disabled'});
}

/**
 * Verifies that visible regular panels, forms, and cards fit within the containing viewport,
 * while preserving intentional horizontally scrollable chart scrollers, date strips, and section tabs.
 */
export async function assertPanelsFitViewport(page:Page){
  const width=page.viewportSize()!.width;
  const panels=page.locator('.panel:visible, .card:visible, .form-grid:visible, .settings-section:visible');
  const count=await panels.count();
  for(let i=0;i<count;i++){
    const panel=panels.nth(i);
    const box=await panel.boundingBox();
    if(box&&box.width>0){
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x+box.width).toBeLessThanOrEqual(width+1);
    }
  }
}

/**
 * Verifies .macros container grid layout at medium 640-899px tier:
 * 3-column repeat grid, border-top, no border-left, and child elements contained without horizontal overflow.
 */
export async function assertMacroLayout(page:Page){
  const macros=page.locator('.daily-grid > .macros:visible').first();
  await expect(macros).toBeVisible();
  const styles=await macros.evaluate(el=>{
    const cs=getComputedStyle(el);
    const parentCs=el.parentElement?getComputedStyle(el.parentElement):null;
    const cols=cs.gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
    return {
      display:cs.display,
      colsCount:cols.length,
      gridTemplateColumns:cs.gridTemplateColumns,
      outerGridTemplateColumns:parentCs?parentCs.gridTemplateColumns:'none',
      borderTopWidth:parseFloat(cs.borderTopWidth)||0,
      borderLeftWidth:parseFloat(cs.borderLeftWidth)||0,
      scrollWidth:el.scrollWidth,
      clientWidth:el.clientWidth
    };
  });
  expect(styles.display,`macros display: ${styles.display}, outerGrid: ${styles.outerGridTemplateColumns}`).toBe('grid');
  expect(styles.colsCount,`macros colsCount: ${styles.colsCount}, gridTemplateColumns: ${styles.gridTemplateColumns}, outerGrid: ${styles.outerGridTemplateColumns}`).toBe(3);
  expect(styles.borderTopWidth,`macros borderTopWidth: ${styles.borderTopWidth}`).toBeGreaterThan(0);
  expect(styles.borderLeftWidth,`macros borderLeftWidth: ${styles.borderLeftWidth}`).toBe(0);
  expect(styles.scrollWidth,`macros scrollWidth (${styles.scrollWidth}) <= clientWidth+1 (${styles.clientWidth+1}), gridTemplate: ${styles.gridTemplateColumns}, outerGrid: ${styles.outerGridTemplateColumns}`).toBeLessThanOrEqual(styles.clientWidth+1);

  const macroItems=macros.locator('.macro:visible');
  const count=await macroItems.count();
  expect(count).toBe(3);
  for(let i=0;i<count;i++){
    const item=macroItems.nth(i);
    const itemDiag=await item.evaluate(el=>{
      const cs=getComputedStyle(el);
      const strong=el.querySelector('strong');
      const strongCs=strong?getComputedStyle(strong):null;
      return {
        fits:el.scrollWidth<=el.clientWidth+1,
        scrollWidth:el.scrollWidth,
        clientWidth:el.clientWidth,
        gridTemplateColumns:cs.gridTemplateColumns,
        textWrap:strongCs?strongCs.overflowWrap:''
      };
    });
    expect(itemDiag.fits,`macro[${i}] scrollWidth (${itemDiag.scrollWidth}) <= clientWidth+1 (${itemDiag.clientWidth+1}), gridTemplate: ${itemDiag.gridTemplateColumns}, textWrap: ${itemDiag.textWrap}`).toBe(true);
  }
}

/**
 * Asserts all 4 Progress section tab labels ('Weight', 'Energy', 'Body', 'Activity')
 * are visible, their textRange bounds are fully within their buttons, and their buttons
 * are visible and contained within the viewport (or document/viewport for non-scrolled tabs).
 */
export async function assertProgressTabsVisibility(page:Page){
  const tabsControl=page.locator('#progress-tabs:visible');
  await expect(tabsControl).toBeVisible();
  const labels=['Weight','Energy','Body','Activity'] as const;
  const viewportWidth=page.viewportSize()!.width;
  const isEnlarged=await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).fontSize)>20);

  for(const label of labels){
    const button=tabsControl.getByRole('button',{name:label,exact:true});
    await expect(button).toBeVisible();

    if(isEnlarged && viewportWidth>=640){
      await button.evaluate(btn=>btn.scrollIntoView({block:'nearest',inline:'nearest'}));
    }

    const check=await button.evaluate((btn,expectedLabel)=>{
      const rect=btn.getBoundingClientRect();
      // Verify button has standard control height >= 44px
      const heightOk=rect.height>=43.5;

      // Find the text node containing the label
      const iterator=document.createNodeIterator(btn,NodeFilter.SHOW_TEXT);
      let textNode:Node|null=null;
      while(textNode=iterator.nextNode()){
        if(textNode.textContent?.includes(expectedLabel)){
          break;
        }
      }
      if(!textNode){
        return {foundText:false,heightOk,insideButton:false,textRect:null,btnRect:rect};
      }

      const range=document.createRange();
      range.selectNodeContents(textNode);
      const textRect=range.getBoundingClientRect();

      // Check textRange bounds are within button bounds (with 1px subpixel tolerance)
      const insideButton=
        textRect.left>=rect.left-1 &&
        textRect.right<=rect.right+1 &&
        textRect.top>=rect.top-1 &&
        textRect.bottom<=rect.bottom+1;

      return {
        foundText:true,
        heightOk,
        insideButton,
        textRect:{
          left:textRect.left,
          right:textRect.right,
          top:textRect.top,
          bottom:textRect.bottom,
          width:textRect.width,
          height:textRect.height
        },
        btnRect:{
          left:rect.left,
          right:rect.right,
          top:rect.top,
          bottom:rect.bottom,
          width:rect.width,
          height:rect.height
        }
      };
    },label);

    expect(check.foundText).toBe(true);
    expect(check.heightOk).toBe(true);
    expect(
      check.insideButton,
      `Label "${label}" text outside button: text=[top:${check.textRect?.top}, bottom:${check.textRect?.bottom}, left:${check.textRect?.left}, right:${check.textRect?.right}] button=[top:${check.btnRect?.top}, bottom:${check.btnRect?.bottom}, left:${check.btnRect?.left}, right:${check.btnRect?.right}]`
    ).toBe(true);

    if(!isEnlarged && (viewportWidth===320 || viewportWidth===360)){
      expect(check.btnRect.left).toBeGreaterThanOrEqual(-1);
      expect(check.btnRect.right).toBeLessThanOrEqual(viewportWidth+1);
    }else if(!isEnlarged){
      expect(check.btnRect.left).toBeGreaterThanOrEqual(-1);
      expect(check.btnRect.right).toBeLessThanOrEqual(viewportWidth+1);
    }
  }
}

/**
 * Asserts all mobile navigation items fit without ellipsis at normal text scale,
 * verifying scrollWidth <= clientWidth and Range text bounds within button bounds,
 * while allowing intentional 200% accessibility shortening.
 */
export async function assertMobileNavFit(page:Page){
  await page.evaluate(()=>document.fonts.ready);
  const nav=page.locator('.nav-mobile-items:visible');
  if(!await nav.count())return;
  const isEnlarged=await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).fontSize)>20);
  const items=nav.locator('.button');
  const count=await items.count();
  for(let i=0;i<count;i++){
    const btn=items.nth(i);
    const check=await btn.evaluate(el=>{
      const rect=el.getBoundingClientRect();
      const span=el.querySelector(':scope > span');
      const spanCs=span?getComputedStyle(span):null;
      const label=span?.textContent?.trim()||el.getAttribute('aria-label')||'';
      const spanWidth=span?.getBoundingClientRect().width??0;
      const spanClientWidth=span?.clientWidth??0;
      const spanScrollWidth=span?.scrollWidth??0;
      const spanFits=!span||spanScrollWidth<=spanClientWidth+1;
      let textInside=true;
      let textRect={left:0,right:0,top:0,bottom:0,width:0,height:0};
      if(span){
        const it=document.createNodeIterator(span,NodeFilter.SHOW_TEXT);
        const node=it.nextNode();
        if(node){
          const range=document.createRange();
          range.selectNodeContents(node);
          const tr=range.getBoundingClientRect();
          textRect={left:tr.left,right:tr.right,top:tr.top,bottom:tr.bottom,width:tr.width,height:tr.height};
          textInside=tr.left>=rect.left-1&&tr.right<=rect.right+1;
        }
      }
      return {
        heightOk:rect.height>=43.5,
        spanFits,
        textInside,
        label,
        spanWidth,
        spanClientWidth,
        spanScrollWidth,
        font:spanCs?spanCs.font:'',
        letterSpacing:spanCs?spanCs.letterSpacing:'',
        btnRect:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height},
        textRect
      };
    });
    expect(check.heightOk,`nav item "${check.label}" height ${check.btnRect.height} >= 43.5`).toBe(true);
    if(!isEnlarged){
      expect(
        check.spanFits,
        `nav item "${check.label}" scrollWidth (${check.spanScrollWidth}) <= clientWidth (${check.spanClientWidth}) [font: "${check.font}", letterSpacing: "${check.letterSpacing}", spanWidth: ${check.spanWidth}, btnWidth: ${check.btnRect.width}]`
      ).toBe(true);
      expect(
        check.textInside,
        `nav item "${check.label}" textRange outside button: text=[left:${check.textRect.left}, right:${check.textRect.right}] btn=[left:${check.btnRect.left}, right:${check.btnRect.right}]`
      ).toBe(true);
    }
  }
}

