/** Shared dictionary/reading popup geometry. Never covers its word anchor. */
export function readingPopoverStyle(anchor:HTMLElement,width=320,preferAbove=false):string {
 const rect=anchor.getBoundingClientRect(),margin=12;
 const w=Math.min(width,Math.max(180,innerWidth-margin*2));
 const left=Math.min(Math.max(rect.left+rect.width/2-w/2,margin),innerWidth-w-margin);
 const above=rect.top-margin,below=innerHeight-rect.bottom-margin;
 const useAbove=preferAbove?above>=180||above>below:below<180&&above>below;
 return `left:${left}px;width:${w}px;max-height:${Math.max(80,useAbove?above:below)}px;${useAbove?`bottom:${innerHeight-rect.top}px`:`top:${rect.bottom}px`}`;
}
