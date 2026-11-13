const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;

test('named ARIA references and viewport resizing survive accessibility scans',async({page})=>{
 await page.setContent('<!doctype html><html lang="en"><head><title>ARIA references</title></head><body><main><span id="label">Save study</span><button aria-labelledby="label"></button></main></body></html>');
 await expect(page.getByRole('button',{name:'Save study',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.querySelector('button').ariaLabelledByElements?.[0]?.id)).toBe('label');
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
 await page.getByRole('button',{name:'Save study',exact:true}).click();
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});await expect.poll(()=>page.evaluate(()=>[innerWidth,innerHeight])).toEqual([width,844]);}
});
